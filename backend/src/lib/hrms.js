import crypto from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';

/**
 * HRMS HTTP protocol (see lgu-hrms docs/ATTENDANCE_INTEGRATION.md). Pure
 * functions over explicit credentials — per-integration resolution lives in
 * lib/integrations.js. Auth is `x-api-key` (scopes: employees:read for pull,
 * attendance:ingest for push), never Bearer.
 */
export function normalizeBaseUrl(baseUrl) {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  // HRMS serves its API under /api/v1 — tolerate a bare host.
  try {
    if (new URL(b).pathname.replace(/\//g, '') === '') return `${b}/api/v1`;
  } catch {
    // leave as-is; downstream fetch fails with a clear upstream error
  }
  return b;
}

function withBase(baseUrl, path) {
  const b = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(String(path).replace(/^\//, ''), b).href;
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
 * GET {base}/integrations/employees — paginated roster pull.
 * HRMS shape: {items, total, page, limit} (bare arrays tolerated).
 */
export async function fetchHrmsEmployees({ baseUrl, apiKey, timeoutMs = 15000 }, { page = 1, limit = 100 } = {}) {
  if (!baseUrl || !apiKey) {
    throw new AppError('HRMS integration is not configured (base URL / API key)', 400, 'HRMS_NOT_CONFIGURED');
  }
  const url = new URL(withBase(baseUrl, 'integrations/employees'));
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(Math.min(limit, 200)));
  let res;
  try {
    res = await fetchWithTimeout(url, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    }, timeoutMs);
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
 * POST helper for the HRMS attendance ingestion API. Never throws — returns
 * { ok, status, body } so a downstream outage never rolls back local writes.
 */
async function postHrmsIngest(creds, kind, body) {
  const { baseUrl, apiKey, timeoutMs = 15000, ingestBase = '/integrations/attendance' } = creds;
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: 'HRMS not configured (base URL / API key)' };
  }
  const url = withBase(baseUrl, `${String(ingestBase).replace(/\/$/, '')}/${kind}`);
  const raw = JSON.stringify(body);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: raw,
    }, timeoutMs);
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
export function postHrmsPunch(creds, punch) {
  return postHrmsIngest(creds, 'punch', punch);
}

/** Bulk records: {records: [{employeeNumber, date YYYY-MM-DD, timeIn?, timeOut?, hours?, remark?, source?}]}. */
export function postHrmsBulk(creds, records) {
  return postHrmsIngest(creds, 'bulk', { records });
}

/** Connectivity probe against HRMS's own test endpoint. */
export function testHrmsEndpoint(creds) {
  return postHrmsIngest(creds, 'test', {});
}

/**
 * HMAC-SHA256 hex of the raw body — mirrors lgu-hrms webhook signing. The
 * signature arrives in the X-HRMS-Signature header; compare with
 * timingSafeEqual to avoid timing oracles.
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
