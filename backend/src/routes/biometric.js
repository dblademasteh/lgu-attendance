import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireDeviceAuth } from '../middleware/deviceAuth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireAuth } from '../middleware/auth.js';
import { SYNC_WRITE_ROLES } from '../shared/constants.js';
import {
  devicePunchesSchema,
  registerDeviceSchema,
  updateDeviceSchema,
  deviceIdParamSchema,
} from '../shared/contracts/biometric.js';
import { receivePunches, listDevices, registerDevice, updateDevice, deactivateDevice } from '../controllers/deviceController.js';
import { biometricController } from '../controllers/biometricController.js';
import { z } from 'zod';

// Device-facing: biometric terminals are clients of THIS app (the server).
// Bearer-token authenticated per registered device — no JWT. Mounted before
// requireAuth in index.js (public, like /external + /webhooks).
const deviceRouter = Router();
deviceRouter.post('/:deviceId/punches', requireDeviceAuth, validate(devicePunchesSchema), receivePunches);

// Admin device registry: register / configure / manage terminals.
const adminRouter = Router();
adminRouter.get('/', listDevices);
adminRouter.post('/', validate(registerDeviceSchema), registerDevice);
adminRouter.patch('/:id', validate(updateDeviceSchema), updateDevice);
adminRouter.delete('/:id', validate(deviceIdParamSchema), deactivateDevice);

// Biometric credential enrollment (WebAuthn) — JWT required.
const credentialsRouter = Router();
credentialsRouter.use(requireAuth);
credentialsRouter.post('/enroll', validate({ body: z.object({ credentialId: z.string().min(1), publicKey: z.string().min(1), deviceName: z.string().optional().nullable() }) }), biometricController.enroll);
credentialsRouter.get('/credentials', validate({ query: z.object({ employeeId: z.string().optional().nullable() }) }), biometricController.list);
credentialsRouter.delete('/credentials/:credentialId', biometricController.remove);
credentialsRouter.post('/verify', validate({ body: z.object({ credentialId: z.string().min(1), assertion: z.object({ clientDataJSON: z.string().min(1), authenticatorData: z.string().min(1), signature: z.string().min(1) }), punchType: z.enum(['IN', 'OUT']).optional() }) }), biometricController.verify);
credentialsRouter.get('/verify-challenge', validate({ query: z.object({ credentialId: z.string().min(1) }) }), biometricController.getVerifyChallenge);
credentialsRouter.post('/verify-assertion', validate({ body: z.object({ credentialId: z.string().min(1), authenticatorResponse: z.object({ clientDataJSON: z.string().min(1), authenticatorData: z.string().min(1), signature: z.string().min(1), challenge: z.string().min(1) }), punchType: z.enum(['IN', 'OUT']).optional() }) }), biometricController.verifyAssertion);
credentialsRouter.get('/webauthn/enroll/options', biometricController.webauthnEnrollOptions);
credentialsRouter.post('/webauthn/enroll/verify', validate({ body: z.object({ credential: z.object({ id: z.string().min(1), rawId: z.string().min(1), response: z.object({ clientDataJSON: z.string().min(1), attestationObject: z.string().min(1) }), type: z.literal('public-key') }) }) }), biometricController.webauthnEnrollVerify);

export { deviceRouter, adminRouter, credentialsRouter };