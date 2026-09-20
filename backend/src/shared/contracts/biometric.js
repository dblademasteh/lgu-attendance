import { z } from 'zod';

const DIRECTION = z.enum(['IN', 'OUT', 'AUTO']);

/**
 * Device-facing punch ingestion. Devices POST raw IN/OUT events to
 * /biometric/:deviceId/punches (Bearer token auth per registered device).
 */
export const devicePunchesSchema = z.object({
  params: z.object({ deviceId: z.string().min(1, 'deviceId is required') }),
  body: z.object({
    punches: z.array(z.object({
      employeeNumber: z.string().min(1, 'employeeNumber is required'),
      timestamp: z.string().min(1, 'timestamp is required'),
      direction: DIRECTION.optional(),
      deviceRef: z.string().optional(),
    })).min(1, 'At least one punch is required'),
  }),
});

/** Admin device registration (token shown once — sha256 hashed at rest). */
export const registerDeviceSchema = z.object({
  body: z.object({
    deviceId: z.string().trim().min(1, 'deviceId is required'),
    name: z.string().trim().min(1, 'Name is required').max(100),
    token: z.string().min(1, 'token is required').max(256),
    model: z.string().trim().optional(),
    ip: z.string().trim().optional(),
  }),
});

export const updateDeviceSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid device id') }),
  body: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().optional(),
    ip: z.string().trim().optional(),
    active: z.boolean().optional(),
    token: z.string().min(1).max(256).optional(),
  }).strict(),
});

export const deviceIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid device id') }),
});
