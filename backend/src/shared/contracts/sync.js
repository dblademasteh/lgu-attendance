import { z } from 'zod';

/**
 * HRMS webhook payload (mirrors lgu-hrms INTEGRATION_GUIDE.md §3.3).
 * Signature is verified against the RAW body before this contract parses —
 * Zod stripping/reordering unknown keys never affects verification.
 */
export const webhookSchema = z.object({
  body: z.object({
    event: z.enum(['employee.created', 'employee.updated', 'employee.deleted', 'biometric.punch', 'biometric.punch_batch', 'leave.created', 'leave.updated', 'leave.deleted']),
    tenantId: z.string().optional(),
    employeeId: z.string().optional(),
    employeeNumber: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    middleName: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    status: z.string().optional(),
    changedFields: z.array(z.string()).optional(),
    timestamp: z.string().optional(),
    actorUserId: z.string().optional(),
    punch: z.object({
      employeeNumber: z.string().optional(),
      timestamp: z.string().min(1, 'timestamp is required'),
      deviceId: z.string().optional(),
      direction: z.enum(['IN', 'OUT', 'AUTO']).optional(),
    }).optional(),
    punches: z.array(z.object({
      employeeNumber: z.string().optional(),
      timestamp: z.string().min(1, 'timestamp is required'),
      deviceId: z.string().optional(),
      direction: z.enum(['IN', 'OUT', 'AUTO']).optional(),
    })).optional(),
    // Leave lifecycle (HRMS-approved leaves drive ON_LEAVE in mark-absent).
    leaveId: z.string().optional(),
    leaveType: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
    leaveStatus: z.string().optional(),
    reason: z.string().optional().nullable(),
    approvedBy: z.string().optional().nullable(),
  }),
});

export const listSyncLogsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(['SUCCESS', 'PARTIAL', 'FAILED']).optional(),
    source: z.enum(['WEBHOOK', 'POLL']).optional(),
    direction: z.enum(['INBOUND', 'PULL', 'OUTBOUND']).optional(),
  }),
});

/**
 * In-app HRMS connection config (ADMIN only — secrets involved). Secrets:
 * undefined/'' keeps the saved value, explicit null clears back to env.
 * baseUrl: undefined keeps, ''/null clears back to env.
 */
export const updateSyncConfigSchema = z.object({
  body: z.object({
    baseUrl: z.string().trim().max(200).nullish().refine(
      (v) => v == null || v === '' || /^https?:\/\//.test(v),
      { message: 'Base URL must start with http:// or https://' },
    ),
    apiKey: z.string().max(500).nullish(),
    webhookSecret: z.string().max(500).nullish(),
    pollerEnabled: z.boolean().optional(),
    intervalMin: z.number().int().min(1).max(1440).optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
    ingestPath: z.string().trim().max(200).optional(),
    forwardingEnabled: z.boolean().optional(),
  }),
});

/** Probe credentials without saving (Test button). Blank = use saved values. */
export const testSyncConnectionSchema = z.object({
  body: z.object({
    baseUrl: z.string().trim().max(200).optional(),
    apiKey: z.string().max(500).optional(),
  }),
});
