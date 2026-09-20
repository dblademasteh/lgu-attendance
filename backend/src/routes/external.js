import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { externalAttendanceSchema, externalSummarySchema, externalEmployeeAttendanceSchema } from '../shared/contracts/apiKeys.js';
import * as externalController from '../controllers/externalController.js';

const router = Router();

// Read-only consumption endpoints for external systems (e.g. HRMS payroll).
// Bearer API key required — scope-checked per route; no JWT.
router.get('/attendance', requireApiKey('attendance:read'), validate(externalAttendanceSchema), externalController.attendance);
router.get('/attendance/:employeeNumber', requireApiKey('attendance:read'), validate(externalEmployeeAttendanceSchema), externalController.attendanceByEmployee);
router.get('/summary', requireApiKey('reports:read'), validate(externalSummarySchema), externalController.summary);

export default router;
