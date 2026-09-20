import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { REPORT_ROLES } from '../shared/constants.js';
import {
  dailyReportSchema,
  summaryReportSchema,
  timesheetSchema,
  exportReportSchema,
} from '../shared/contracts/reports.js';
import * as reportController from '../controllers/reportController.js';

const router = Router();

// Role gating mirrors lgu-hrms /reports: ADMIN+HR_MANAGER+DEPARTMENT_HEAD+AUDITOR.
router.use('/', requireRole(...REPORT_ROLES));

router.get('/daily', validate(dailyReportSchema), reportController.daily);
router.get('/summary', validate(summaryReportSchema), reportController.summary);
router.get('/export', validate(exportReportSchema), reportController.exportCsv);
router.get('/timesheet/:employeeId', validate(timesheetSchema), reportController.timesheet);

export default router;
