import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const listApiKeysSchema = z.object({ query: z.object({}).optional() });

export const createApiKeySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    scopes: z.array(z.enum(['attendance:read', 'reports:read'])).min(1, 'At least one scope is required'),
  }),
});

export const apiKeyIdSchema = z.object({
  params: z.object({ id: z.string().min(1, 'API key id is required') }),
});

export const externalAttendanceSchema = z.object({
  query: z.object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    department: z.string().trim().optional(),
    employeeNumber: z.string().trim().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export const externalSummarySchema = z.object({
  query: z.object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    department: z.string().trim().optional(),
  }),
});

/** Per-employee daily attendance for HRMS consumption (attendance:read scope). */
export const externalEmployeeAttendanceSchema = z.object({
  params: z.object({ employeeNumber: z.string().min(1, 'employeeNumber is required') }),
  query: z.object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
  }),
});

/**
 * Reverse-sync pull: HRMS posts { since: ISO8601 } to POST /api/v1/attendance/punches
 * (Bearer API key, attendance:read scope) and receives { records: [...] } in the
 * HRMS bulk-import shape for incremental ingestion.
 */
export const pullPunchesSchema = z.object({
  body: z.object({
    since: z
      .string()
      .optional()
      .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), { message: 'since must be a valid ISO-8601 datetime' }),
  }),
});
