import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditLog } from '../middleware/audit.js';
import { webhookLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { verifyHrmsSignature, isIntegrationIpAllowed, getHrmsConfig } from '../lib/hrms.js';
import { syncService } from '../services/syncService.js';
import { AppError } from '../lib/errors.js';
import { webhookSchema } from '../shared/contracts/sync.js';
import authRouter from './auth.js';
import employeesRouter from './employees.js';
import attendanceRouter from './attendance.js';
import reportsRouter from './reports.js';
import syncRouter from './sync.js';
import apiKeysRouter from './apiKeys.js';
import externalRouter from './external.js';
import { deviceRouter, adminRouter as deviceAdminRouter, credentialsRouter } from './biometric.js';
import { SYNC_WRITE_ROLES } from '../shared/constants.js';

const router = Router();

// Public: JWT auth (login/refresh) — rate-limited on credentials.
router.use('/auth', authRouter);

// Public webhook receiver — no JWT. Secured by HMAC-SHA256 signature in the
// X-HRMS-Signature header (computed over the raw body), optional IP
// allowlist (INTEGRATION_ALLOWED_IPS), 30 req/min/IP.
router.post('/webhooks/hrms', webhookLimiter, async (req, res, next) => {
  try {
    if (!isIntegrationIpAllowed(req)) {
      throw new AppError('Caller IP is not allowed', 403, 'IP_NOT_ALLOWED');
    }
    // Secret resolved per-request: hot-swappable via Settings > Integration.
    const secret = (await getHrmsConfig()).webhookSecret;
    const signature = req.headers['x-hrms-signature'];
    if (!verifyHrmsSignature(req.rawBody, signature, secret)) {
      throw new AppError('Invalid webhook signature', 401, 'INVALID_SIGNATURE');
    }
    return next();
  } catch (e) {
    return next(e);
  }
}, validate(webhookSchema), async (req, res, next) => {
  try {
    const result = await syncService.processWebhook(req.body);
    return res.json({ ok: true, ...result });
  } catch (e) {
    return next(e);
  }
});

// Machine consumers (Bearer API keys, e.g. HRMS payroll) — no JWT.
router.use('/external', externalRouter);
// Public device endpoint — devices are clients of this app (the server). Auth
// is per-device Bearer token in requireDeviceAuth; no JWT required.
router.use('/biometric', deviceRouter);
// Biometric credential enrollment (WebAuthn) — JWT required.
router.use('/biometric', credentialsRouter);

// Everything below requires a JWT session; mutating requests pass through
// the global audit mount exactly once.
router.use('/', requireAuth);
router.use('/', auditLog);
router.use('/employees', employeesRouter);
router.use('/attendance', attendanceRouter);
router.use('/reports', reportsRouter);
router.use('/sync', syncRouter);
router.use('/api-keys', apiKeysRouter);
// Device management (ADMIN/HR_MANAGER): register / configure / manage the
// biometric terminals this app serves as the server for.
router.use('/admin/biometric-devices', requireRole(...SYNC_WRITE_ROLES), deviceAdminRouter);

export default router;
