import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/rbac.js';
import { ROLES, ATTENDANCE_WRITE_ROLES, REPORT_ROLES } from '../shared/constants.js';
import {
  listAttendanceSchema,
  todaySchema,
  punchSchema,
  correctAttendanceSchema,
  markAbsentSchema,
  myHistorySchema,
  geofenceUpdateSchema,
} from '../shared/contracts/attendance.js';
import * as attendanceController from '../controllers/attendanceController.js';

const router = Router();

// Monitoring
// Broad reads (full roster / live board) are for oversight roles only — a
// regular employee (VIEWER) sees only their own record via /my below.
router.get('/', requireRole(...REPORT_ROLES), validate(listAttendanceSchema), attendanceController.list);
router.get('/today', requireRole(...REPORT_ROLES), validate(todaySchema), attendanceController.today);

// Self-service (JWT user's linked employee) — open to any authenticated, linked user.
router.get('/my', attendanceController.myToday);
router.get('/my/history', validate(myHistorySchema), attendanceController.myHistory);
router.post('/punch', validate(punchSchema), attendanceController.punchSelf);

// Punch for others / backfill / corrections (ADMIN/HR_MANAGER/DEPARTMENT_HEAD)
router.post('/punch-manual', requireRole(...ATTENDANCE_WRITE_ROLES), validate(punchSchema), attendanceController.punchManual);
router.post('/mark-absent', requireRole(ROLES.ADMIN, ROLES.HR_MANAGER), validate(markAbsentSchema), attendanceController.markAbsent);
router.patch('/:id', requireRole(...ATTENDANCE_WRITE_ROLES), validate(correctAttendanceSchema), attendanceController.correct);

// Punch geofence settings (runtime config — Settings > Attendance)
router.get('/rule/geofence', requireRole(ROLES.ADMIN, ROLES.HR_MANAGER), attendanceController.getGeofence);
router.patch('/rule/geofence', requireRole(ROLES.ADMIN, ROLES.HR_MANAGER), validate(geofenceUpdateSchema), attendanceController.updateGeofence);

export default router;
