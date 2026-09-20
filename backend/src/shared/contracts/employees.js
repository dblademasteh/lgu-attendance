import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const listEmployeesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    q: z.string().trim().optional(),
    department: z.string().trim().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
});

export const employeeIdSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Employee id is required') }),
});

export const createEmployeeSchema = z.object({
  body: z.object({
    employeeNumber: z.string().trim().min(1, 'Employee number is required'),
    firstName: z.string().trim().min(1, 'First name is required'),
    lastName: z.string().trim().min(1, 'Last name is required'),
    middleName: z.string().trim().optional().nullable(),
    email: z.string().trim().email('Invalid email').optional().nullable(),
    department: z.string().trim().optional().nullable(),
    position: z.string().trim().optional().nullable(),
    hiredDate: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional().nullable(),
    monthlySalary: z.number().nonnegative().optional(),
  }),
});

export const updateEmployeeSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Employee id is required') }),
  body: z.object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    middleName: z.string().trim().optional().nullable(),
    email: z.string().trim().email('Invalid email').optional().nullable(),
    department: z.string().trim().optional().nullable(),
    position: z.string().trim().optional().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
});
