import crypto from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { prisma } from './prisma.js';
import { decryptSecret, secretPreview } from './secrets.js';
import { AppError } from './errors.js';

const CONFIG_ID = 'default';

// Cached IntegrationConfig row: undefined = not loaded yet, null = no saved
// row (env rules), object = in-app config active. Cleared by
// refreshHrmsConfig() after every save — no restart needed.
let rowCache;

export function refreshHrmsConfig() {
  rowCache = undefined;
}

async function integrationRow() {
  if (rowCache === undefined) {
    try {
      rowCache = await prisma.integrationConfig.findUnique({ where: { id: CONFIG_ID } });
    } catch {
      rowCache = null;
    }
  }
  return rowCache;
}

/**
 * HRMS contract (see lgu-hrms docs/ATTENDANCE_INTEGRATION.md):
 * - Auth is `x-api-key: <key>` (scopes: employees:read for pull,
 *   attendance:ingest for push) — NOT Bearer.
 * - Roster: GET {base}/integrations/employees?page&limit&search
 * - Push: POST {base}/integrations/attendance/punch|bulk|test
 * `ingestBase` (default /integrations/attendance) is the push prefix and is
 * overridable per deployment.
 */
export async function getHrmsConfig() {
  const row = await integrationRow();
  let baseUrl = (row?.hrmsBaseUrl || process.env.HRMS_BASE_URL || '').trim().replace(/\/+$/, '');
  // HRMS serves its API under /api/v1 (per lgu-hrms docs/ATTENDANCE_INTEGRATION.md:
  // base URL http://localhost:4000/api/v1). Tolerate a bare host by appending it.
  if (baseUrl) {
    try {
      if (new URL(baseUrl).pathname.replace(/\//g, '') === '') baseUrl += '/api/v1';
    } catch {
      // leave as-is; downstream fetch fails with a clear upstream error
    }
  }
  const apiKey = (row?.hrmsApiKeyEnc ? decryptSecret(row.hrmsApiKeyEnc) : null)
    || process.env.HRMS_API_KEY || '';
  const webhookSecret = (row?.hrmsWebhookSecretEnc ? decryptSecret(row.hrmsWebhookSecretEnc) : null)
    || process.env.HRMS_WEBHOOK_SECRET || '';
  return {
    baseUrl,
    apiKey,
    webhookSecret,
    timeoutMs: row?.timeoutMs ?? Number(process.env.HRMS_TIMEOUT_MS || 15000),
    ingestBase: row?.ingestPath || process.env.HRMS_ATTENDANCE_INGEST_BASE || '/integrations/attendance',
    pollerEnabled: row ? row.pollerEnabled : process.env.HRMS_SYNC_POLLER === '1',
    intervalMin: row?.intervalMin ?? Number(process.env.HRMS_SYNC_INTERVAL_MIN || 15),
    forwarding: row ? row.forwardingEnabled : process.env.HRMS_ATTENDANCE_FORWARD === '1',
    managedByDb: Boolean(row),
  };
}

export async function isHrmsConfigured() {
  const cfg = await getHrmsConfig();
  return Boolean(cfg.baseUrl && cfg.apiKey);
}

/** Non-secret view of the integration config for GET /sync/status + /sync/config. */
export async function hrmsConfig() {
  const cfg = await getHrmsConfig();
  const baseUrl = cfg.baseUrl || null;
  const joinBase = (p) => {
    const b = baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) : null;
    return b ? new URL(p.replace(/^\//, ''), b).href : null;
  };
  return {
    baseUrl,
    apiKeySet: Boolean(cfg.apiKey),
    apiKeyPreview: secretPreview(cfg.apiKey),
    webhookSecretSet: Boolean(cfg.webhookSecret),
    pollerEnabled: cfg.pollerEnabled,
    intervalMin: cfg.intervalMin,
    timeoutMs: cfg.timeoutMs,
    attendanceIngestPath: cfg.ingestBase,
    ingestUrl: baseUrl ? joinBase(`${cfg.ingestBase}/punch`) : null,
    attendanceForwarding: cfg.forwarding,
    managedByDb: cfg.managedByDb,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET {base}/integrations/employees — paginated roster pull with the
 * tenant-scoped API key (x-api-key header, scope: employees:read).
 * HRMS shape: {items, total, page, limit} (also tolerates bare arrays).
 * `override` ({baseUrl, apiKey}) lets the connect UI probe credentials
 * before saving them.
 */
export async function fetchHrmsEmployees({ page = 1, limit = 100 } = {}, override = {}) {
  const cfg = await getHrmsConfig();
  const baseUrl = override.baseUrl || cfg.baseUrl;
  const apiKey = override.apiKey !== undefined ? override.apiKey : cfg.apiKey;
  if (!baseUrl || !apiKey) {
    throw new AppError('HRMS integration is not configured (base URL / API key)', 400, 'HRMS_NOT_CONFIGURED');
  }
  const url = new URL('integrations/employees', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(Math.min(limit, 200)));
  let res;
  try {
    res = await fetchWithTimeout(url, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    }, cfg.timeoutMs);
  } catch (e) {
    const reason = e?.name === 'AbortError' ? 'timed out' : 'unreachable';
    throw new AppError(`HRMS employees pull ${reason}`, 502, 'HRMS_UPSTREAM_ERROR');
  }
  if (!res.ok) {
    throw new AppError(`HRMS returned ${res.status} for employees pull`, 502, 'HRMS_UPSTREAM_ERROR');
  }
  const data = await res.json().catch(() => null);
  if (data == null) throw new AppError('HRMS returned an invalid employees payload', 502, 'HRMS_UPSTREAM_ERROR');
  const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);
  const total = Array.isArray(data) ? items.length : (data.total ?? items.length);
  return { items, total };
}

/**
 * HMAC-SHA256 hex of the raw body — mirrors lgu-hrms webhook signing. The
 * signature arrives in the X-HRMS-Signature header; compare with
 * timingSafeEqual to avoid timing oracles. Secret is resolved per-request
 * (hot-swappable via Settings > Integration).
 */
export function verifyHrmsSignature(rawBody, signature, secret = '') {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody ?? '').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature).trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Optional INTEGRATION_ALLOWED_IPS allowlist for inbound webhooks
 * (comma-separated IPs/CIDRs). Empty/unset = open (signature is the gate).
 */
export function isIntegrationIpAllowed(req) {
  const raw = process.env.INTEGRATION_ALLOWED_IPS;
  if (!raw) return true;
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return true;
  let ip;
  try {
    ip = ipaddr.parse(req.ip ?? '');
  } catch {
    return false;
  }
  return entries.some((entry) => {
    try {
      if (entry.includes('/')) {
        const [range, bits] = ipaddr.parseCIDR(entry);
        if (range.kind() !== ip.kind()) return false;
        return ip.match(range, bits);
      }
      return ip.toString() === ipaddr.parse(entry).toString();
    } catch {
      return false;
    }
  });
}

/**
 * POST helper for the HRMS attendance ingestion API (x-api-key auth, scope:
 * attendance:ingest). Never throws — returns { ok, status, body } so a
 * downstream HRMS outage never rolls back a locally-collected punch.
 */
async function postHrmsIngest(kind, body, override = {}) {
  const cfg = await getHrmsConfig();
  const baseUrl = override.baseUrl || cfg.baseUrl;
  const apiKey = override.apiKey !== undefined ? override.apiKey : cfg.apiKey;
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: 'HRMS not configured (base URL / API key)' };
  }
  const base = cfg.ingestBase.replace(/\/$/, '').replace(/^\//, '');
  const url = new URL(`${base}/${kind}`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const raw = JSON.stringify(body);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: raw,
    }, cfg.timeoutMs);
  } catch (e) {
    const reason = e?.name === 'AbortError' ? 'timed out' : 'unreachable';
    return { ok: false, status: 0, body: `HRMS attendance forward ${reason}` };
  }
  const text = await res.text().catch(() => '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Single punch: {employeeNumber, punchType IN|OUT, at ISO, deviceId?, source?}. */
export function postHrmsPunch(punch, override) {
  return postHrmsIngest('punch', punch, override);
}

/** Bulk records: {records: [{employeeNumber, date YYYY-MM-DD, timeIn?, timeOut?, hours?, remark?, source?}]}. */
export function postHrmsBulk(records, override) {
  return postHrmsIngest('bulk', { records }, override);
}

/** Connectivity probe against HRMS's own test endpoint. */
export function testHrmsEndpoint(override) {
  return postHrmsIngest('test', {}, override);
}
