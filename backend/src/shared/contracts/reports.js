import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dailyReportSchema = z.object({
  query: z.object({
    date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    department: z.string().trim().optional(),
  }),
});

export const summaryReportSchema = z.object({
  query: z.object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    department: z.string().trim().optional(),
  }),
});

export const timesheetSchema = z.object({
  params: z.object({ employeeId: z.string().min(1, 'Employee id is required') }),
  query: z.object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
  }),
});

export const exportReportSchema = z.object({
  query: z.object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    department: z.string().trim().optional(),
    format: z.enum(['csv']).default('csv'),
  }),
});
