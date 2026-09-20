import { syncRepository } from '../repositories/syncRepository.js';
import { employeeService } from './employeeService.js';
import { attendanceService } from './attendanceService.js';
import { fetchHrmsEmployees, hrmsConfig, isHrmsConfigured, postHrmsPunch, postHrmsBulk, testHrmsEndpoint, refreshHrmsConfig } from '../lib/hrms.js';
import { manilaDateKey } from '../lib/time.js';
import { encryptSecret } from '../lib/secrets.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { SYNC_EVENTS } from '../shared/constants.js';

let pollerTimer = null;

/** Human-readable one-liner for a failed HRMS ingest call. */
function describeHrmsFailure(result) {
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  return `status ${result.status}: ${body.slice(0, 160)}`;
}

/** HH:MM in Asia/Manila for HRMS bulk records. */
function manilaHm(dt) {
  if (!dt) return undefined;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(dt));
}

/**
 * Map a local punch event to HRMS single-punch bodies
 * {employeeNumber, punchType IN|OUT, at, deviceId?, source?}.
 */
function toHrmsPunches(event, payload = {}) {
  if (event === 'punch') {
    return [{
      employeeNumber: payload.employeeNumber,
      punchType: payload.direction === 'OUT' ? 'OUT' : 'IN',
      at: payload.eventTime,
      deviceId: payload.deviceRef ?? undefined,
      source: payload.source ?? 'PUNCH',
    }];
  }
  const raw = payload.punches ?? [];
  return raw.filter((p) => p?.employeeNumber).map((p) => ({
    employeeNumber: p.employeeNumber,
    punchType: p.direction === 'OUT' ? 'OUT' : 'IN',
    at: p.timestamp,
    deviceId: p.deviceId ?? payload.deviceId ?? undefined,
    source: 'DEVICE',
  }));
}

/**
 * Map a local correction/backfill to HRMS bulk records
 * {employeeNumber, date, timeIn?, timeOut?, hours?, remark?, source?}.
 */
function toHrmsBulkRecords(event, payload = {}) {
  if (event === 'correction') {
    const date = payload.date ? manilaDateKey(new Date(payload.date)) : undefined;
    return [{
      employeeNumber: payload.employeeNumber,
      date,
      timeIn: manilaHm(payload.timeIn),
      timeOut: manilaHm(payload.timeOut),
      source: 'MANUAL',
    }].filter((r) => r.employeeNumber && r.date);
  }
  if (event === 'mark_absent') {
    return (payload.employees ?? []).filter((e) => e?.employeeNumber).map((e) => ({
      employeeNumber: e.employeeNumber,
      date: payload.date,
      remark: e.status === 'ON_LEAVE' ? 'On leave' : 'Absent',
      source: 'MANUAL',
    }));
  }
  return [];
}

export const syncService = {
  /**
   * Process a verified webhook payload. employee.created/updated upsert the
   * roster entry; employee.deleted soft-deletes it. Returns rows processed.
   */
  async processWebhook(payload) {
    switch (payload.event) {
      case SYNC_EVENTS.EMPLOYEE_CREATED:
      case SYNC_EVENTS.EMPLOYEE_UPDATED: {
        const employee = await employeeService.upsertFromHrms(payload, 'WEBHOOK');
        return { processed: 1, employeeId: employee.id };
      }
      case SYNC_EVENTS.EMPLOYEE_DELETED: {
        const employee = await employeeService.deactivateFromHrms(payload);
        return { processed: employee ? 1 : 0, employeeId: employee?.id ?? null };
      }
      case SYNC_EVENTS.LEAVE_CREATED:
      case SYNC_EVENTS.LEAVE_UPDATED: {
        const leave = await attendanceService.upsertLeaveFromHrms(payload);
        return { processed: 1, leaveId: leave.id };
      }
      case SYNC_EVENTS.LEAVE_DELETED: {
        const leave = await attendanceService.deleteLeaveFromHrms(payload);
        return { processed: leave ? 1 : 0, leaveId: leave?.id ?? null };
      }
      case SYNC_EVENTS.BIOMETRIC_PUNCH_BATCH: {
        const punches = payload.punches ?? [];
        let processed = 0;
        const perEmployee = {};
        const errors = [];
        // Group by employee so all of a employee's punches for the batch reach
        // ingestBiometricPunches together — pairing needs the full IN/OUT set,
        // not one punch at a time (which would clobber timeIn with an OUT time).
        const grouped = new Map();
        for (const p of punches) {
          const empNum = p.employeeNumber;
          if (!empNum) {
            errors.push('punch missing employeeNumber');
            continue;
          }
          if (!grouped.has(empNum)) grouped.set(empNum, []);
          grouped.get(empNum).push(p);
        }
        for (const [empNum, empPunches] of grouped) {
          try {
            const result = await attendanceService.ingestBiometricPunches({
              employeeNumber: empNum,
              punches: empPunches,
              deviceRef: empPunches[0]?.deviceId ?? null,
            });
            perEmployee[empNum] = (perEmployee[empNum] ?? 0) + result.processed;
            processed += result.processed;
          } catch (e) {
            errors.push(`${empNum}: ${e.message}`);
          }
        }
        await syncRepository.create({
          source: 'WEBHOOK',
          direction: 'INBOUND',
          event: payload.event,
          status: processed > 0 && errors.length === 0 ? 'SUCCESS' : (processed > 0 ? 'PARTIAL' : 'FAILED'),
          processed,
          message: errors.length
            ? errors.slice(0, 5).join(' | ')
            : `Ingested ${processed} biometric punch(es) via ${payload.event}`,
          payload: { event: payload.event, punchCount: punches.length },
        });
        if (processed > 0) {
          // No echo: these punches originated from HRMS, so forwarding them
          // back would loop (HRMS -> webhook -> forward -> HRMS ...).
        }
        return { processed, perEmployee, errors };
      }
      case SYNC_EVENTS.BIOMETRIC_PUNCH: {
        const single = payload.punch ?? (payload.punches?.[0] ?? null);
        if (!single?.employeeNumber) {
          throw new AppError('biometric.punch payload missing employeeNumber', 400, 'HRMS_PAYLOAD_INVALID');
        }
        const result = await attendanceService.ingestBiometricPunches({
          employeeNumber: single.employeeNumber,
          punches: [single],
          deviceRef: single.deviceId ?? null,
        });
        await syncRepository.create({
          source: 'WEBHOOK',
          direction: 'INBOUND',
          event: payload.event,
          status: result.processed > 0 ? 'SUCCESS' : 'FAILED',
          processed: result.processed,
          message: `Ingested ${result.processed} biometric punch(es) via ${payload.event} for ${single.employeeNumber}`,
          payload: { event: payload.event, employeeNumber: single.employeeNumber },
        });
        // No echo (see batch path above): HRMS is the origin of this punch.
        return { processed: result.processed, results: result.results };
      }
      default:
        return { processed: 0 };
    }
  },

  /**
   * Pull the roster from the HRMS API (scheduled fallback or manual run).
   * Pages through GET {base}/integrations/employees, upserts every entry,
   * and records a SUCCESS/PARTIAL/FAILED SyncLog.
   *
   * HRMS orders by lastName (non-unique), so OFFSET pages re-sorted per
   * request can duplicate a boundary row and skip another. To guarantee full
   * coverage, each run tracks ingested employeeNumbers and sweeps up to two
   * extra passes with different page sizes (different windows land the
   * skipped rows) until the roster total is covered or a pass adds nothing.
   */
  async runPoll({ triggeredBy = 'system' } = {}) {
    if (!(await isHrmsConfigured())) {
      await syncRepository.create({
        source: 'POLL',
        direction: 'PULL',
        status: 'FAILED',
        processed: 0,
        message: 'HRMS integration is not configured (HRMS_BASE_URL/HRMS_API_KEY)',
      });
      throw new AppError('HRMS integration is not configured (HRMS_BASE_URL/HRMS_API_KEY)', 400, 'HRMS_NOT_CONFIGURED');
    }
    let processed = 0;
    let failed = 0;
    let expectedTotal = null;
    const seen = new Set();
    const errors = [];
    for (const limit of [100, 73, 37]) {
      let addedThisPass = 0;
      let page = 1;
      for (;;) {
        let result;
        try {
          result = await fetchHrmsEmployees({ page, limit });
        } catch (e) {
          errors.push(`page ${page}: ${e.message}`);
          failed += 1;
          break;
        }
        if (expectedTotal === null) expectedTotal = result.total;
        for (const item of result.items) {
          const num = item.employeeNumber ?? item.employeeId ?? null;
          if (num && seen.has(num)) continue;
          try {
            await employeeService.upsertFromHrms(item, 'POLL');
            processed += 1;
            if (num) {
              seen.add(num);
              addedThisPass += 1;
            }
          } catch (e) {
            failed += 1;
            errors.push(`${num ?? 'unknown'}: ${e.message}`);
          }
        }
        if (result.items.length < limit || page * limit >= result.total) break;
        page += 1;
      }
      if (expectedTotal !== null && seen.size >= expectedTotal) break;
      if (addedThisPass === 0) break;
    }
    const status = failed === 0 ? 'SUCCESS' : (processed > 0 ? 'PARTIAL' : 'FAILED');
    await syncRepository.create({
      source: 'POLL',
      direction: 'PULL',
      status,
      processed,
      message: failed > 0
        ? errors.slice(0, 5).join(' | ')
        : `Pulled ${processed} employees from HRMS (triggered by ${triggeredBy})`,
    });
    return { status, processed, failed };
  },

  async listLogs(filters = {}) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = {};
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;
    if (filters.direction) where.direction = filters.direction;
    const [items, total] = await Promise.all([
      syncRepository.list({ skip: (page - 1) * limit, take: limit, where }),
      syncRepository.count(where),
    ]);
    return { items, total, page, limit };
  },

  /** Non-secret view of the integration state for GET /sync/status. */
  async status() {
    const config = await hrmsConfig();
    const [latest, counts] = await Promise.all([syncRepository.latest(), syncRepository.counts()]);
    return { configured: await isHrmsConfigured(), ...config, latestSync: latest, counts };
  },

  /** Saved in-app connection config (non-secret view) for GET /sync/config. */
  async getConfig() {
    return hrmsConfig();
  },

  /**
   * Persist the in-app connection config (ADMIN). Empty-string/undefined
   * secrets are kept, explicit null clears back to env. Applies immediately:
   * config cache refresh + poller restart, no backend restart needed.
   */
  async updateConfig(patch) {
    const existing = await prisma.integrationConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
    const keepSecret = (v, current) => (v === undefined || v === '' ? current ?? null : (v === null ? null : encryptSecret(v)));
    const data = {
      hrmsBaseUrl: patch.baseUrl === undefined ? (existing?.hrmsBaseUrl ?? null) : (patch.baseUrl || null),
      hrmsApiKeyEnc: keepSecret(patch.apiKey, existing?.hrmsApiKeyEnc),
      hrmsWebhookSecretEnc: keepSecret(patch.webhookSecret, existing?.hrmsWebhookSecretEnc),
      pollerEnabled: patch.pollerEnabled ?? existing?.pollerEnabled ?? false,
      intervalMin: patch.intervalMin ?? existing?.intervalMin ?? 15,
      timeoutMs: patch.timeoutMs ?? existing?.timeoutMs ?? 15000,
      ingestPath: patch.ingestPath ?? existing?.ingestPath ?? '/integrations/attendance',
      forwardingEnabled: patch.forwardingEnabled ?? existing?.forwardingEnabled ?? false,
    };
    if (existing) {
      await prisma.integrationConfig.update({ where: { id: 'default' }, data });
    } else {
      await prisma.integrationConfig.create({ data: { id: 'default', ...data } });
    }
    refreshHrmsConfig();
    await syncService.applyPollerConfig();
    return hrmsConfig();
  },

  /**
   * Probe HRMS with given (or saved) credentials — powers the Test button.
   * Hits HRMS's own connectivity endpoint first, then confirms the roster
   * pull. Never saves, never writes a SyncLog.
   */
  async testConnection({ baseUrl, apiKey } = {}) {
    const override = { baseUrl: baseUrl || undefined, apiKey: apiKey === undefined ? undefined : (apiKey || undefined) };
    try {
      const probe = await testHrmsEndpoint(override);
      if (!probe.ok) return { ok: false, message: `HRMS test endpoint: ${describeHrmsFailure(probe)}` };
      const { total } = await fetchHrmsEmployees({ page: 1, limit: 1 }, override);
      return { ok: true, total, message: `Connected — HRMS reachable, roster reports ${total} employee(s)` };
    } catch (e) {
      return { ok: false, message: e.message ?? 'Connection failed' };
    }
  },

  /** Scheduled roster poller — interval comes from the runtime config. */
  startPoller(intervalMin = 15) {
    if (pollerTimer) return;
    const safeMin = Math.max(1, Number(intervalMin || 15));
    const intervalMs = safeMin * 60 * 1000;
    console.log(`[sync] HRMS roster poller started (every ${safeMin} min)`);
    pollerTimer = setInterval(() => {
      syncService.runPoll({ triggeredBy: 'scheduler' }).catch((e) => console.error('[sync] poll failed:', e.message));
    }, intervalMs);
    // Initial pull shortly after boot.
    setTimeout(() => {
      syncService.runPoll({ triggeredBy: 'scheduler' }).catch((e) => console.error('[sync] initial poll failed:', e.message));
    }, 5000);
  },

  /** Reconcile the poller with the runtime config (called on boot + every save). */
  async applyPollerConfig() {
    const cfg = await hrmsConfig();
    if (cfg.pollerEnabled) {
      syncService.stopPoller();
      syncService.startPoller(cfg.intervalMin);
    } else {
      syncService.stopPoller();
    }
  },

  stopPoller() {
    if (!pollerTimer) return;
    clearInterval(pollerTimer);
    pollerTimer = null;
    console.log('[sync] HRMS roster poller stopped');
  },

  /**
   * Outbound delivery (choice B: this app collects punches, HRMS computes).
   * Routes each local event into HRMS's ingestion shapes (x-api-key,
   * scope attendance:ingest): single punches -> POST .../punch, corrections
   * and backfills -> POST .../bulk. Always resolves + logs a SyncLog
   * (OUTBOUND) — a forward failure never rolls back local writes.
   * HRMS-originated webhook punches are NEVER echoed back here (loop
   * prevention) — HRMS already holds them.
   */
  async forwardToHrms({ event, payload }) {
    const cfg = await hrmsConfig();
    if (!cfg.attendanceForwarding) return { skipped: true };
    try {
      let result;
      let processed;
      let label;
      if (event === 'correction' || event === 'mark_absent') {
        const records = toHrmsBulkRecords(event, payload);
        processed = records.length;
        label = `${processed} record(s) (${event})`;
        result = processed > 0 ? await postHrmsBulk(records) : { ok: true, status: 200, body: 'nothing to forward' };
      } else {
        const punches = toHrmsPunches(event, payload);
        processed = punches.length;
        label = `${processed} punch(es) (${event})`;
        const results = [];
        for (const punch of punches) results.push(await postHrmsPunch(punch));
        const failed = results.filter((r) => !r.ok);
        result = failed.length === 0
          ? { ok: true, status: 200, body: results.map((r) => r.body) }
          : { ok: false, status: failed[0].status, body: failed.map((r) => r.body) };
      }
      await syncRepository.create({
        source: 'WEBHOOK',
        direction: 'OUTBOUND',
        event,
        status: result.ok ? 'SUCCESS' : 'FAILED',
        processed,
        message: result.ok
          ? `Forwarded ${label} to HRMS`
          : `HRMS forward failed (${result.status}): ${String(typeof result.body === 'string' ? result.body : JSON.stringify(result.body)).slice(0, 200)}`,
        payload: { ok: result.ok, status: result.status },
      });
      return result;
    } catch (e) {
      await syncRepository.create({
        source: 'WEBHOOK',
        direction: 'OUTBOUND',
        event,
        status: 'FAILED',
        processed: (payload && payload.punches?.length) ?? 1,
        message: `HRMS forward error: ${e.message}`,
        payload: { error: e.code ?? e.message },
      });
      return { ok: false, status: 0, body: e.message };
    }
  },
};
