import { z } from 'zod';

/**
 * External integration CRUD (ADMIN for mutations; list/get mirror the
 * Integration page roles). Secrets: undefined/'' keeps the saved value,
 * explicit null clears. baseUrl: undefined keeps, ''/null clears to env
 * (primary row only — other rows must be explicit).
 */
const integrationFields = {
  name: z.string().trim().min(1).max(120),
  provider: z.enum(['hrms', 'generic']).optional(),
  baseUrl: z.string().trim().max(200).nullish().refine(
    (v) => v == null || v === '' || /^https?:\/\//.test(v),
    { message: 'Base URL must start with http:// or https://' },
  ),
  apiKey: z.string().max(500).nullish(),
  webhookSecret: z.string().max(500).nullish(),
  webhookSlug: z.string().trim().min(1).max(64).nullish(),
  pollerEnabled: z.boolean().optional(),
  intervalMin: z.number().int().min(1).max(1440).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  ingestBase: z.string().trim().max(200).optional(),
  forwardingEnabled: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
};

export const createIntegrationSchema = z.object({
  body: z.object({
    ...integrationFields,
    name: integrationFields.name,
  }),
});

export const updateIntegrationSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    provider: integrationFields.provider,
    baseUrl: integrationFields.baseUrl,
    apiKey: integrationFields.apiKey,
    webhookSecret: integrationFields.webhookSecret,
    webhookSlug: integrationFields.webhookSlug,
    pollerEnabled: integrationFields.pollerEnabled,
    intervalMin: integrationFields.intervalMin,
    timeoutMs: integrationFields.timeoutMs,
    ingestBase: integrationFields.ingestBase,
    forwardingEnabled: integrationFields.forwardingEnabled,
    isPrimary: integrationFields.isPrimary,
    isActive: integrationFields.isActive,
  }),
});

export const integrationIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

/** Probe an integration's credentials without saving (Test button). */
export const testIntegrationSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    baseUrl: z.string().trim().max(200).optional(),
    apiKey: z.string().max(500).optional(),
  }),
});

/** Manual roster pull for one integration (id optional → primary). */
export const runIntegrationSyncSchema = z.object({
  body: z.object({
    integrationId: z.string().uuid().optional(),
  }),
});
