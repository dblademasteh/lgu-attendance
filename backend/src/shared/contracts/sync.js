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
    integrationId: z.string().uuid().optional(),
  }),
});

/** Manual roster pull for one integration (body.integrationId optional → primary). */
export const runIntegrationSyncSchema = z.object({
  body: z.object({
    integrationId: z.string().uuid().optional(),
  }),
});

/** Webhook receiver path segment — one per integration (legacy 'hrms' kept). */
export const webhookSlugSchema = z.object({
  params: z.object({
    slug: z.string().min(1).max(64),
  }),
});
