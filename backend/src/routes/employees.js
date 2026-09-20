import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES, REPORT_ROLES } from '../shared/constants.js';
import {
  listEmployeesSchema,
  employeeIdSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
} from '../shared/contracts/employees.js';
import * as employeeController from '../controllers/employeeController.js';

const router = Router();

router.get('/', requireRole(...REPORT_ROLES), validate(listEmployeesSchema), employeeController.list);
router.get('/:id', requireRole(...REPORT_ROLES), validate(employeeIdSchema), employeeController.get);
// Writes: employees come from HRMS sync; manual create/patch is for edge
// cases only (ADMIN/HR_MANAGER).
router.post('/', requireRole(ROLES.ADMIN, ROLES.HR_MANAGER), validate(createEmployeeSchema), employeeController.create);
router.patch('/:id', requireRole(ROLES.ADMIN, ROLES.HR_MANAGER), validate(updateEmployeeSchema), employeeController.update);

export default router;
