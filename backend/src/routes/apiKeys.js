import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES } from '../shared/constants.js';
import { createApiKeySchema, apiKeyIdSchema } from '../shared/contracts/apiKeys.js';
import * as apiKeyController from '../controllers/apiKeyController.js';

const router = Router();

// Machine consumer keys for external systems (e.g. HRMS payroll pulling
// attendance reports): ADMIN only. The raw key is shown once at creation.
router.use('/', requireRole(ROLES.ADMIN));

router.get('/', apiKeyController.list);
router.post('/', validate(createApiKeySchema), apiKeyController.create);
router.delete('/:id', validate(apiKeyIdSchema), apiKeyController.remove);

export default router;
