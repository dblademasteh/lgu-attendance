import { prisma } from './prisma.js';
import { normalizeBaseUrl } from './hrms.js';
import { decryptSecret, encryptSecret, secretPreview } from './secrets.js';

/**
 * Per-integration runtime resolution. Each Integration row owns its base URL,
 * key, secret, poller, and forwarding flags; the PRIMARY row additionally
 * falls back to env (provisioning default until the first save).
 */

const PROVIDERS = ['hrms', 'generic'];

export function normalizeProvider(raw) {
  const v = String(raw || 'hrms').toLowerCase();
  return PROVIDERS.includes(v) ? v : 'hrms';
}

/** URL-path slug from a name (webhook receiver segment). */
export function slugify(name, fallback = 'integration') {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

export async function listIntegrations() {
  return prisma.integration.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] });
}

export async function getIntegration(id) {
  return prisma.integration.findUnique({ where: { id } });
}

export async function getIntegrationBySlug(slug) {
  if (!slug) return null;
  return prisma.integration.findUnique({ where: { webhookSlug: slug } });
}

export async function getPrimaryIntegration() {
  return (await prisma.integration.findFirst({ where: { isPrimary: true } }))
    ?? (await prisma.integration.findFirst({ orderBy: { createdAt: 'asc' } }));
}

/** Decrypted runtime credentials for outbound calls (never exposed via API). */
export function integrationCreds(integration) {
  const baseUrl = normalizeBaseUrl(integration.baseUrl);
  return {
    baseUrl,
    apiKey: integration.apiKeyEnc ? decryptSecret(integration.apiKeyEnc) : null,
    webhookSecret: integration.webhookSecretEnc ? decryptSecret(integration.webhookSecretEnc) : null,
    timeoutMs: integration.timeoutMs,
    ingestBase: integration.ingestBase,
  };
}

/**
 * Merged runtime config for one integration: row wins per-field, env is the
 * fallback ONLY for the primary row (other integrations must be explicit).
 */
export function resolveIntegrationConfig(integration) {
  const creds = integrationCreds(integration);
  const useEnv = integration.isPrimary;
  const baseUrl = creds.baseUrl
    || (useEnv ? normalizeBaseUrl(process.env.HRMS_BASE_URL) : '')
    || '';
  return {
    baseUrl,
    apiKey: creds.apiKey
      || (useEnv ? (process.env.HRMS_API_KEY || '') : '')
      || '',
    webhookSecret: creds.webhookSecret
      || (useEnv ? (process.env.HRMS_WEBHOOK_SECRET || '') : '')
      || '',
    timeoutMs: integration.timeoutMs ?? Number(process.env.HRMS_TIMEOUT_MS || 15000),
    ingestBase: integration.ingestBase || process.env.HRMS_ATTENDANCE_INGEST_BASE || '/integrations/attendance',
    pollerEnabled: integration.pollerEnabled || (useEnv && process.env.HRMS_SYNC_POLLER === '1'),
    intervalMin: integration.intervalMin ?? Number(process.env.HRMS_SYNC_INTERVAL_MIN || 15),
    forwarding: integration.forwardingEnabled || (useEnv && process.env.HRMS_ATTENDANCE_FORWARD === '1'),
  };
}

/** Non-secret view for API responses (status cards, forms). */
export function integrationView(integration) {
  const cfg = resolveIntegrationConfig(integration);
  const baseUrl = cfg.baseUrl || null;
  const joinBase = (p) => {
    const b = baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) : null;
    return b ? new URL(String(p).replace(/^\//, ''), b).href : null;
  };
  return {
    id: integration.id,
    name: integration.name,
    provider: integration.provider,
    isPrimary: integration.isPrimary,
    isActive: integration.isActive,
    webhookSlug: integration.webhookSlug,
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
    managedByDb: Boolean(integration.baseUrl || integration.apiKeyEnc || integration.webhookSecretEnc),
  };
}

export async function isIntegrationConfigured(integration) {
  const cfg = resolveIntegrationConfig(integration);
  return Boolean(cfg.baseUrl && cfg.apiKey);
}

/** Persist secrets: undefined/'' keeps, explicit null clears. */
export function keepSecret(value, current) {
  if (value === undefined || value === '') return current ?? null;
  if (value === null) return null;
  return encryptSecret(value);
}

export async function uniqueSlug(base, excludeId = null) {
  let slug = slugify(base);
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const clash = await prisma.integration.findUnique({ where: { webhookSlug: candidate } });
    if (!clash || clash.id === excludeId) return candidate;
    n += 1;
  }
}
