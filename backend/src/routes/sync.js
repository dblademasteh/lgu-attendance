import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { SYNC_WRITE_ROLES } from '../shared/constants.js';
import { listSyncLogsSchema, runIntegrationSyncSchema } from '../shared/contracts/sync.js';
import * as syncController from '../controllers/syncController.js';

const router = Router();

// Aggregate integration state + sync history — restricted to integration
// admins (ADMIN/HR_MANAGER). Per-integration management lives under
// /integrations (ADMIN for secrets).
router.get('/status', requireRole(...SYNC_WRITE_ROLES), syncController.status);
router.get('/logs', requireRole(...SYNC_WRITE_ROLES), validate(listSyncLogsSchema), syncController.logs);

// Manual roster pull (body.integrationId optional → primary): ADMIN/HR_MANAGER.
router.post('/run', requireRole(...SYNC_WRITE_ROLES), validate(runIntegrationSyncSchema), syncController.run);

export default router;
