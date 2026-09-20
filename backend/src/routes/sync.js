import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES, SYNC_WRITE_ROLES } from '../shared/constants.js';
import { listSyncLogsSchema, updateSyncConfigSchema, testSyncConnectionSchema } from '../shared/contracts/sync.js';
import * as syncController from '../controllers/syncController.js';

const router = Router();

// Integration state + sync history expose HRMS base URL and whether the API key /
// webhook secret are configured — restricted to integration admins (ADMIN/HR_MANAGER).
router.get('/status', requireRole(...SYNC_WRITE_ROLES), syncController.status);
router.get('/logs', requireRole(...SYNC_WRITE_ROLES), validate(listSyncLogsSchema), syncController.logs);

// Manual roster pull (scheduled fallback runs automatically with
// HRMS_SYNC_POLLER=1): ADMIN/HR_MANAGER.
router.post('/run', requireRole(...SYNC_WRITE_ROLES), syncController.run);

// In-app connection config — ADMIN only (secrets involved). Secrets are
// encrypted at rest and never returned; the UI shows set-flags + previews.
router.get('/config', requireRole(ROLES.ADMIN), syncController.getConfig);
router.patch('/config', requireRole(ROLES.ADMIN), validate(updateSyncConfigSchema), syncController.updateConfig);
router.post('/test', requireRole(ROLES.ADMIN), validate(testSyncConnectionSchema), syncController.testConnection);

export default router;
