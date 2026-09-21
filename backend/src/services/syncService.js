import crypto from 'node:crypto';
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

/** Deterministic JSON stringification (stable key order) for idempotency keys. */
function stableStringify(obj) {
  if (obj == null) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/**
 * Deterministic idempotency key for an outbound HRMS forward: a hash of the
 * HRMS-shaped request body + the event's Manila day. Two forwards sharing a
 * key are the same logical delivery — a retry after a transient failure
 * deduplicates instead of double-sending (HRMS is the source of truth for its
 * own computed attendance).
 */
function deriveIdempotencyKey(event, hrmsBody) {
  const day = manilaDateKey(new Date());
  const raw = `${event}:${day}:${stableStringify(hrmsBody)}`;
  return `fwd-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
}

const TRANSIENT_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);
/** A failed post is retryable only on transient transport/HTTP errors. */
function isTransient(result) {
  if (!result || result.ok) return false;
  return TRANSIENT_STATUSES.has(result.status);
}

function backoffSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FORWARD_RETRIES = 3;
const FORWARD_BACKOFF_MS = [500, 1000, 2000];

/**
 * Send a single HRMS-shaped body with retry-on-transient and per-call
 * idempotency. Returns the last result; dedups against a prior SUCCESS SyncLog.
 */
async function sendOnceWithRetry(method, event, hrmsBody) {
  const key = deriveIdempotencyKey(event, hrmsBody);
  const already = await syncRepository.findSuccessfulByKey(key);
  if (already) {
    return { ok: true, status: 200, body: 'already forwarded', deduped: true, idempotencyKey: key, attempt: 0 };
  }
  let result;
  let lastAttempt = 0;
  for (let attempt = 0; attempt <= FORWARD_RETRIES; attempt += 1) {
    lastAttempt = attempt;
    result = await method(hrmsBody);
    if (result.ok || !isTransient(result) || attempt === FORWARD_RETRIES) break;
    await backoffSleep(FORWARD_BACKOFF_MS[attempt] ?? FORWARD_BACKOFF_MS[FORWARD_RETRIES]);
  }
  result.idempotencyKey = key;
  result.attempt = result.ok ? lastAttempt + 1 : FORWARD_RETRIES + 1;
  result.deduped = false;
  return result;
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
   * and backfills -> POST .../bulk.
   *
   * Idempotency: every outbound API call is keyed by a deterministic hash of the
   * HRMS-shaped body + Manila day. A retry (or a duplicate fireForwardToHrms)
   * whose key already has a SUCCESS SyncLog is skipped — HRMS never sees the
   * same punch/correction twice. Transient failures (network, 5xx, 429, 408)
   * are retried with exponential backoff; only a terminal, non-retryable error
   * (or exhaustion of retries) writes a FAILED log, which intentionally omits
   * the key so a later manual retry can still succeed.
   *
   * HRMS-originated webhook punches are NEVER echoed back here (loop
   * prevention) — HRMS already holds them.
   */
  async forwardToHrms({ event, payload }) {
    const cfg = await hrmsConfig();
    if (!cfg.attendanceForwarding) return { skipped: true };
    try {
      let calls;
      let label;
      if (event === 'correction' || event === 'mark_absent') {
        // Bulk ingestion: one HRMS call carrying all records.
        const records = toHrmsBulkRecords(event, payload);
         calls = records.length > 0
          ? [{ method: (b) => postHrmsBulk(b), hrmsBody: { records } }]
          : [{ method: () => Promise.resolve({ ok: true, status: 200, body: 'nothing to forward' }), hrmsBody: { records: [] } }];
        label = `${records.length} record(s) (${event})`;
      } else {
        // Per-punch ingestion: each punch is its own HRMS call so a deduped
        // or retried punch is isolated (no clobbering a sibling's success).
        const punches = toHrmsPunches(event, payload);
        calls = punches.map((punch) => ({ method: (b) => postHrmsPunch(b), hrmsBody: punch }));
        label = `${punches.length} punch(es) (${event})`;
      }

      const outcomes = await Promise.all(calls.map((c) => sendOnceWithRetry(c.method, event, c.hrmsBody)));
      const deduped = outcomes.filter((r) => r.deduped).length;
      const failed = outcomes.filter((r) => !r.ok);
      const result = failed.length === 0
        ? { ok: true, status: 200, body: outcomes.map((r) => r.body), deduped }
        : { ok: false, status: failed[0].status, body: failed.map((r) => r.body), deduped };

      // One SyncLog per HRMS API call so the idempotency key resolves to a
      // single SUCCESS row per logical forward (no PK/unique collisions).
      for (const out of outcomes) {
        const isSuccess = out.ok;
        const isDeduped = out.deduped;
        await syncRepository.create({
          source: 'WEBHOOK',
          direction: 'OUTBOUND',
          event,
          status: isSuccess ? 'SUCCESS' : 'FAILED',
          processed: out.deduped ? 0 : 1,
          message: isSuccess
            ? (isDeduped ? `Forwarded ${label} to HRMS (deduped — already sent)` : `Forwarded ${label} to HRMS`)
            : `HRMS forward failed (${out.status}) after ${out.attempt} attempt(s): ${String(typeof out.body === 'string' ? out.body : JSON.stringify(out.body)).slice(0, 200)}`,
          payload: { ok: out.ok, status: out.status, deduped: out.deduped, attempt: out.attempt },
          idempotencyKey: isSuccess ? out.idempotencyKey : null,
        });
      }
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
