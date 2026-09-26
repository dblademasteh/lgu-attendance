import crypto from 'node:crypto';
import { syncRepository } from '../repositories/syncRepository.js';
import { employeeService } from './employeeService.js';
import { attendanceService } from './attendanceService.js';
import { fetchHrmsEmployees, postHrmsPunch, postHrmsBulk, testHrmsEndpoint } from '../lib/hrms.js';
import {
  listIntegrations as fetchIntegrations, getIntegration, getPrimaryIntegration, integrationCreds,
  resolveIntegrationConfig, integrationView, isIntegrationConfigured,
  normalizeProvider, uniqueSlug, keepSecret,
} from '../lib/integrations.js';
import { manilaDateKey } from '../lib/time.js';
import { encryptSecret } from '../lib/secrets.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { SYNC_EVENTS } from '../shared/constants.js';

let pollerTimer = null;
/** Last successful-or-attempted poll start per integration (ms epoch). */
const lastPollAt = {};

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
 * Deterministic idempotency key for an outbound forward: a hash of the
 * integration id + HRMS-shaped request body + the event's Manila day. Two
 * forwards sharing a key are the same logical delivery — a retry after a
 * transient failure deduplicates instead of double-sending (the remote system
 * is the source of truth for its own computed attendance).
 */
function deriveIdempotencyKey(integrationId, event, hrmsBody) {
  const day = manilaDateKey(new Date());
  const raw = `${integrationId}:${event}:${day}:${stableStringify(hrmsBody)}`;
  return `ifwd-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
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
 * idempotency (scoped to the integration). Returns the last result; dedups
 * against a prior SUCCESS SyncLog. `method` receives (creds, body).
 */
async function sendOnceWithRetry(integration, method, event, hrmsBody) {
  const key = deriveIdempotencyKey(integration.id, event, hrmsBody);
  const already = await syncRepository.findSuccessfulByKey(key);
  if (already) {
    return { ok: true, status: 200, body: 'already forwarded', deduped: true, idempotencyKey: key, attempt: 0 };
  }
  const creds = integrationCreds(integration);
  let result;
  let lastAttempt = 0;
  for (let attempt = 0; attempt <= FORWARD_RETRIES; attempt += 1) {
    lastAttempt = attempt;
    result = await method(creds, hrmsBody);
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
   * Process a verified webhook payload for one integration.
   * employee.created/updated upsert the roster entry; employee.deleted
   * soft-deletes it. Returns rows processed.
   */
  async processWebhook(payload, integration) {
    const integrationId = integration?.id ?? null;
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
          integrationId,
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
          integrationId,
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
   * Pull one integration's roster (scheduled fallback or manual run). Pages
   * through GET {base}/integrations/employees, upserts every entry, and
   * records a SUCCESS/PARTIAL/FAILED SyncLog tagged with the integration.
   *
   * HRMS orders by lastName (non-unique), so OFFSET pages re-sorted per
   * request can duplicate a boundary row and skip another. To guarantee full
   * coverage, each run tracks ingested employeeNumbers and sweeps up to two
   * extra passes with different page sizes (different windows land the
   * skipped rows) until the roster total is covered or a pass adds nothing.
   */
  async runPoll({ integrationId = null, triggeredBy = 'system' } = {}) {
    const integration = integrationId
      ? await getIntegration(integrationId)
      : await getPrimaryIntegration();
    if (!integration || !integration.isActive) {
      throw new AppError('Integration not found or inactive', 404, 'NOT_FOUND');
    }
    const cfg = resolveIntegrationConfig(integration);
    const creds = integrationCreds(integration);
    if (!(await isIntegrationConfigured(integration))) {
      await syncRepository.create({
        source: 'POLL',
        direction: 'PULL',
        integrationId: integration.id,
        status: 'FAILED',
        processed: 0,
        message: `Integration "${integration.name}" is not configured (base URL / API key)`,
      });
      throw new AppError(`Integration "${integration.name}" is not configured (base URL / API key)`, 400, 'HRMS_NOT_CONFIGURED');
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
          result = await fetchHrmsEmployees(creds, { page, limit });
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
      integrationId: integration.id,
      status,
      processed,
      message: failed > 0
        ? errors.slice(0, 5).join(' | ')
        : `Pulled ${processed} employees from ${integration.name} (triggered by ${triggeredBy})`,
    });
    return { status, processed, failed, integrationId: integration.id };
  },

  async listLogs(filters = {}) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = {};
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;
    if (filters.direction) where.direction = filters.direction;
    if (filters.integrationId) where.integrationId = filters.integrationId;
    const [items, total] = await Promise.all([
      syncRepository.list({ skip: (page - 1) * limit, take: limit, where }),
      syncRepository.count(where),
    ]);
    return { items, total, page, limit };
  },

  /** Aggregate integration state for GET /sync/status. */
  async status() {
    const integrations = await fetchIntegrations();
    const [latest, counts] = await Promise.all([syncRepository.latest(), syncRepository.counts()]);
    const rows = await Promise.all(integrations.map(async (integration) => {
      const view = integrationView(integration);
      const latestSync = await syncRepository.latestFor(integration.id);
      return { ...view, configured: await isIntegrationConfigured(integration), latestSync };
    }));
    return { integrations: rows, latestSync: latest, counts };
  },

  /** Enriched integration rows (masked views + status) for the manager UI. */
  async listIntegrations() {
    const integrations = await fetchIntegrations();
    return Promise.all(integrations.map(async (integration) => {
      const view = integrationView(integration);
      const latestSync = await syncRepository.latestFor(integration.id);
      return { ...view, configured: await isIntegrationConfigured(integration), latestSync };
    }));
  },

  /** Single masked integration view (throws NOT_FOUND when missing). */
  async getIntegrationView(id) {
    const integration = await getIntegration(id);
    if (!integration) throw new AppError('Integration not found', 404, 'NOT_FOUND');
    return integrationView(integration);
  },

  /** Create an integration (ADMIN). Slug auto-derives from the name. */
  async createIntegration(patch) {
    const data = {
      name: patch.name.trim(),
      provider: normalizeProvider(patch.provider),
      baseUrl: patch.baseUrl?.trim() || null,
      apiKeyEnc: patch.apiKey ? encryptSecret(patch.apiKey) : null,
      webhookSecretEnc: patch.webhookSecret ? encryptSecret(patch.webhookSecret) : null,
      pollerEnabled: patch.pollerEnabled ?? false,
      intervalMin: patch.intervalMin ?? 15,
      timeoutMs: patch.timeoutMs ?? 15000,
      ingestBase: patch.ingestBase?.trim() || '/integrations/attendance',
      forwardingEnabled: patch.forwardingEnabled ?? false,
      isPrimary: patch.isPrimary ?? false,
      isActive: patch.isActive ?? true,
    };
    data.webhookSlug = await uniqueSlug(patch.webhookSlug || data.name);
    if (data.isPrimary) {
      await prisma.integration.updateMany({ where: { isPrimary: true }, data: { isPrimary: false } });
    }
    const created = await prisma.integration.create({ data });
    await syncService.applyPollerConfig();
    return integrationView(created);
  },

  /**
   * Update an integration (ADMIN). Secrets: undefined/'' keeps, explicit
   * null clears. Applies immediately (poller restart), no restart needed.
   */
  async updateIntegration(id, patch) {
    const existing = await getIntegration(id);
    if (!existing) throw new AppError('Integration not found', 404, 'NOT_FOUND');
    const data = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.provider !== undefined) data.provider = normalizeProvider(patch.provider);
    if (patch.baseUrl !== undefined) data.baseUrl = patch.baseUrl?.trim() || null;
    if (patch.apiKey !== undefined) data.apiKeyEnc = keepSecret(patch.apiKey, existing.apiKeyEnc);
    if (patch.webhookSecret !== undefined) data.webhookSecretEnc = keepSecret(patch.webhookSecret, existing.webhookSecretEnc);
    if (patch.webhookSlug !== undefined) {
      data.webhookSlug = patch.webhookSlug?.trim()
        ? await uniqueSlug(patch.webhookSlug.trim(), id)
        : null;
    }
    if (patch.pollerEnabled !== undefined) data.pollerEnabled = patch.pollerEnabled;
    if (patch.intervalMin !== undefined) data.intervalMin = patch.intervalMin;
    if (patch.timeoutMs !== undefined) data.timeoutMs = patch.timeoutMs;
    if (patch.ingestBase !== undefined) data.ingestBase = patch.ingestBase?.trim() || '/integrations/attendance';
    if (patch.forwardingEnabled !== undefined) data.forwardingEnabled = patch.forwardingEnabled;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.isPrimary !== undefined) data.isPrimary = patch.isPrimary;
    if (data.isPrimary) {
      await prisma.integration.updateMany({ where: { isPrimary: true, NOT: { id } }, data: { isPrimary: false } });
    }
    const updated = await prisma.integration.update({ where: { id }, data });
    await syncService.applyPollerConfig();
    return integrationView(updated);
  },

  /** Delete an integration (ADMIN). SyncLog rows survive (integrationId nulls). */
  async deleteIntegration(id) {
    const existing = await getIntegration(id);
    if (!existing) throw new AppError('Integration not found', 404, 'NOT_FOUND');
    await prisma.integration.delete({ where: { id } });
    delete lastPollAt[id];
    await syncService.applyPollerConfig();
    return { deleted: true, id };
  },

  /**
   * Probe an integration with given (or saved) credentials — powers the Test
   * button. Hits the remote test endpoint first, then confirms the roster
   * pull. Never saves, never writes a SyncLog.
   */
  async testIntegration(id, { baseUrl, apiKey } = {}) {
    const integration = id ? await getIntegration(id) : null;
    const cfg = integration ? resolveIntegrationConfig(integration) : null;
    const creds = {
      baseUrl: baseUrl || cfg?.baseUrl || '',
      apiKey: apiKey === undefined ? (cfg?.apiKey ?? '') : (apiKey || ''),
      timeoutMs: cfg?.timeoutMs ?? 15000,
      ingestBase: cfg?.ingestBase ?? '/integrations/attendance',
    };
    try {
      const probe = await testHrmsEndpoint(creds);
      if (!probe.ok) return { ok: false, message: `Test endpoint: ${describeHrmsFailure(probe)}` };
      const { total } = await fetchHrmsEmployees(creds, { page: 1, limit: 1 });
      return { ok: true, total, message: `Connected — remote reachable, roster reports ${total} employee(s)` };
    } catch (e) {
      return { ok: false, message: e.message ?? 'Connection failed' };
    }
  },

  /**
   * Scheduled roster poller — one 1-minute tick fans out to every enabled
   * integration whose interval has elapsed. Tracks last-run per integration
   * so mixed intervals (e.g. 5m + 60m) coexist on the single timer.
   */
  startPoller() {
    if (pollerTimer) return;
    console.log('[sync] integration roster poller started (1m tick)');
    const tick = () => {
      fetchIntegrations()
        .then((rows) => {
          const now = Date.now();
          for (const row of rows) {
            if (!row.isActive) continue;
            const cfg = resolveIntegrationConfig(row);
            if (!cfg.pollerEnabled) continue;
            const intervalMs = Math.max(1, Number(cfg.intervalMin || 15)) * 60 * 1000;
            if (now - (lastPollAt[row.id] ?? 0) < intervalMs) continue;
            lastPollAt[row.id] = now;
            syncService.runPoll({ integrationId: row.id, triggeredBy: 'scheduler' })
              .catch((e) => console.error(`[sync] poll failed (${row.name}):`, e.message));
          }
        })
        .catch((e) => console.error('[sync] poller tick failed:', e.message));
    };
    pollerTimer = setInterval(tick, 60 * 1000);
    // Initial pulls shortly after boot, staggered to avoid thundering.
    setTimeout(() => {
      fetchIntegrations()
        .then((rows) => {
          const enabled = rows.filter((r) => {
            if (!r.isActive) return false;
            return resolveIntegrationConfig(r).pollerEnabled;
          });
          enabled.forEach((row, i) => {
            setTimeout(() => {
              lastPollAt[row.id] = Date.now();
              syncService.runPoll({ integrationId: row.id, triggeredBy: 'scheduler' })
                .catch((e) => console.error(`[sync] initial poll failed (${row.name}):`, e.message));
            }, 5000 + i * 5000);
          });
        })
        .catch((e) => console.error('[sync] initial poll failed:', e.message));
    }, 1000);
  },

  /** Reconcile the poller with the saved integrations (boot + every save). */
  async applyPollerConfig() {
    const rows = await fetchIntegrations().catch(() => []);
    const anyEnabled = rows.some((r) => r.isActive && resolveIntegrationConfig(r).pollerEnabled);
    if (anyEnabled) {
      syncService.startPoller();
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
   * Outbound delivery (choice B: this app collects punches, the remote system
   * computes). Fans out to every active integration with forwarding enabled,
   * routing each local event into HRMS ingestion shapes (x-api-key, scope
   * attendance:ingest): single punches -> POST .../punch, corrections and
   * backfills -> POST .../bulk.
   *
   * Idempotency: every outbound API call is keyed by integration + body hash
   * + Manila day (see deriveIdempotencyKey). A retry (or a duplicate forward)
   * whose key already has a SUCCESS SyncLog is skipped — the remote system
   * never sees the same punch/correction twice. Transient failures (network,
   * 5xx, 429, 408) are retried with exponential backoff; only a terminal,
   * non-retryable error (or exhaustion of retries) writes a FAILED log, which
   * intentionally omits the key so a later manual retry can still succeed.
   *
   * Remotely-originated webhook punches are NEVER echoed back (loop
   * prevention) — the origin already holds them.
   */
  async forwardToIntegrations({ event, payload }) {
    const integrations = (await fetchIntegrations()).filter((row) => {
      if (!row.isActive) return false;
      return resolveIntegrationConfig(row).forwarding;
    });
    if (integrations.length === 0) return { skipped: true, results: [] };
    const results = [];
    for (const integration of integrations) {
      results.push(await syncService.forwardToIntegration(integration, { event, payload }));
    }
    const ok = results.every((r) => r.ok);
    return { ok, results };
  },

  /** Forward one event to one integration (see forwardToIntegrations). */
  async forwardToIntegration(integration, { event, payload }) {
    try {
      let calls;
      let label;
      if (event === 'correction' || event === 'mark_absent') {
        // Bulk ingestion: one remote call carrying all records.
        const records = toHrmsBulkRecords(event, payload);
        calls = records.length > 0
          ? [{ method: (c, b) => postHrmsBulk(c, b), hrmsBody: { records } }]
          : [{ method: () => Promise.resolve({ ok: true, status: 200, body: 'nothing to forward' }), hrmsBody: { records: [] } }];
        label = `${records.length} record(s) (${event})`;
      } else {
        // Per-punch ingestion: each punch is its own remote call so a deduped
        // or retried punch is isolated (no clobbering a sibling's success).
        const punches = toHrmsPunches(event, payload);
        calls = punches.map((punch) => ({ method: (c, b) => postHrmsPunch(c, b), hrmsBody: punch }));
        label = `${punches.length} punch(es) (${event})`;
      }

      const outcomes = await Promise.all(calls.map((c) => sendOnceWithRetry(integration, c.method, event, c.hrmsBody)));
      const deduped = outcomes.filter((r) => r.deduped).length;
      const failed = outcomes.filter((r) => !r.ok);
      const result = failed.length === 0
        ? { ok: true, status: 200, body: outcomes.map((r) => r.body), deduped }
        : { ok: false, status: failed[0].status, body: failed.map((r) => r.body), deduped };

      // One SyncLog per remote API call so the idempotency key resolves to a
      // single SUCCESS row per logical forward (no PK/unique collisions).
      for (const out of outcomes) {
        const isSuccess = out.ok;
        const isDeduped = out.deduped;
        await syncRepository.create({
          source: 'WEBHOOK',
          direction: 'OUTBOUND',
          integrationId: integration.id,
          event,
          status: isSuccess ? 'SUCCESS' : 'FAILED',
          processed: out.deduped ? 0 : 1,
          message: isSuccess
            ? (isDeduped ? `Forwarded ${label} to ${integration.name} (deduped — already sent)` : `Forwarded ${label} to ${integration.name}`)
            : `Forward to ${integration.name} failed (${out.status}) after ${out.attempt} attempt(s): ${String(typeof out.body === 'string' ? out.body : JSON.stringify(out.body)).slice(0, 200)}`,
          payload: { ok: out.ok, status: out.status, deduped: out.deduped, attempt: out.attempt },
          idempotencyKey: isSuccess ? out.idempotencyKey : null,
        });
      }
      return { ...result, integrationId: integration.id };
    } catch (e) {
      await syncRepository.create({
        source: 'WEBHOOK',
        direction: 'OUTBOUND',
        integrationId: integration.id,
        event,
        status: 'FAILED',
        processed: (payload && payload.punches?.length) ?? 1,
        message: `Forward to ${integration.name} error: ${e.message}`,
        payload: { error: e.code ?? e.message },
      });
      return { ok: false, status: 0, body: e.message, integrationId: integration.id };
    }
  },
};

