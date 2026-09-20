import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../constants.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const STATUS_VALUES = Object.values(ATTENDANCE_STATUSES);

export const listAttendanceSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    employeeId: z.string().min(1).optional(),
    department: z.string().trim().optional(),
    status: z.enum(STATUS_VALUES).optional(),
  }),
});

export const todaySchema = z.object({
  query: z.object({
    department: z.string().trim().optional(),
  }),
});

export const punchSchema = z.object({
  body: z.object({
    employeeNumber: z.string().trim().min(1, 'Employee number is required').optional(),
    direction: z.enum(['IN', 'OUT', 'AUTO']).optional(),
    at: z.string().regex(TIME_RE, 'Use HH:MM(:ss)').optional(),
    deviceRef: z.string().trim().max(100).optional(),
    remarks: z.string().trim().max(500).optional(),
    geo: z
      .object({
        lat: z.number().finite(),
        lng: z.number().finite(),
        accuracy: z.number().finite().positive(),
      })
      .optional()
      .nullable(),
  }),
});

export const correctAttendanceSchema = z.object({
  params: z.object({ id: z.string().min(1, 'Record id is required') }),
  body: z.object({
    timeIn: z.string().regex(TIME_RE, 'Use HH:MM(:ss)').optional().nullable(),
    timeOut: z.string().regex(TIME_RE, 'Use HH:MM(:ss)').optional().nullable(),
    status: z.enum(STATUS_VALUES).optional(),
    remarks: z.string().trim().max(500).optional().nullable(),
  }),
});

export const markAbsentSchema = z.object({
  body: z.object({
    date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
  }),
});

export const myHistorySchema = z.object({
  query: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
  }),
});

export const geofenceUpdateSchema = z.object({
  body: z
    .object({
      enabled: z.boolean(),
      // `nullish` so a client can send explicit null to clear a coordinate.
      officeLat: z.number().finite().min(-90).max(90).nullish(),
      officeLng: z.number().finite().min(-180).max(180).nullish(),
      geofenceRadiusM: z.number().finite().positive().max(10000).nullish(),
      maxAccuracyM: z.number().finite().positive().max(5000).nullish(),
    })
    .refine((v) => !v.enabled || (v.officeLat != null && v.officeLng != null), {
      message: 'Office coordinates (latitude and longitude) are required to enable the geofence',
    }),
});
