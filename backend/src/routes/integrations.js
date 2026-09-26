import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES, SYNC_WRITE_ROLES } from '../shared/constants.js';
import {
  createIntegrationSchema,
  updateIntegrationSchema,
  integrationIdSchema,
  testIntegrationSchema,
} from '../shared/contracts/integrations.js';
import * as integrationController from '../controllers/integrationController.js';

const router = Router();

// Masked list/detail mirror the Integration page roles (secrets never leave
// the server — set-flags + last-4 previews only).
router.get('/', requireRole(...SYNC_WRITE_ROLES), integrationController.list);
router.get('/:id', requireRole(...SYNC_WRITE_ROLES), validate(integrationIdSchema), integrationController.get);

// Mutations + probes are ADMIN-only (secrets involved).
router.post('/', requireRole(ROLES.ADMIN), validate(createIntegrationSchema), integrationController.create);
router.patch('/:id', requireRole(ROLES.ADMIN), validate(updateIntegrationSchema), integrationController.update);
router.delete('/:id', requireRole(ROLES.ADMIN), validate(integrationIdSchema), integrationController.remove);
router.post('/:id/test', requireRole(ROLES.ADMIN), validate(testIntegrationSchema), integrationController.test);
router.post('/:id/run', requireRole(...SYNC_WRITE_ROLES), validate(integrationIdSchema), integrationController.run);

export default router;
