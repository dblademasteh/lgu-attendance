import { prisma } from '../lib/prisma.js';

const MAX_SNAPSHOT_BYTES = 64 * 1024;
const SENSITIVE_KEYS = new Set(['key', 'accessToken', 'refreshToken', 'passwordHash', 'password', 'apiKey', 'webhookSecret', 'secret', 'hrmsApiKeyEnc', 'hrmsWebhookSecretEnc']);

/** Redact secrets/tokens from snapshots — never log keys. */
function redact(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

function capSnapshot(value) {
  if (value == null) return null;
  try {
    let json = JSON.stringify(redact(value));
    if (json.length > MAX_SNAPSHOT_BYTES) json = JSON.stringify({ truncated: true });
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Append-only AuditLog on every mutating request (global mount only — no
 * per-route duplicates). `after` comes from the captured response body;
 * services may set res.locals.auditBefore for before/after pairs. Failed
 * attempts are logged with error: true; write failures go to stderr, never
 * swallowed.
 */
export function auditLog(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  let responseBody = null;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object') responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    try {
      const path = (req.originalUrl || req.url || '').split('?')[0];
      // /api/v1/<entity>/... -> segment index 3
      const entity = path.split('/')[3] || 'unknown';
      const failed = res.statusCode >= 400;
      prisma.auditLog.create({
        data: {
          userId: req.user?.id ?? null,
          action: `${req.method} ${path}`,
          entity,
          entityId: req.params?.id ?? 'n/a',
          before: capSnapshot(res.locals?.auditBefore),
          after: failed ? null : capSnapshot(responseBody),
          ip: req.ip ?? null,
          error: failed,
        },
      }).catch((e) => console.error('auditLog write failed:', e));
    } catch (e) {
      console.error('auditLog failed:', e);
    }
  });

  return next();
}
