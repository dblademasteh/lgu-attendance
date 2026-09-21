import { attendanceService } from '../services/attendanceService.js';
import { reportService } from '../services/reportService.js';
import { AppError } from '../lib/errors.js';

/**
 * Machine consumers (API keys, e.g. HRMS payroll): read-only attendance and
 * summary endpoints. Scope-checked by requireApiKey(); no JWT required.
 */
export async function attendance(req, res, next) {
  try {
    const result = await attendanceService.list(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

/**
 * Per-employee daily attendance for HRMS to consume (e.g. feed an employee's
 * biometric-derived time in/out back into HRMS payroll). Returns the same
 * computed record shape (status, hours, late, undertine, source, deviceRef).
 */
export async function attendanceByEmployee(req, res, next) {
  try {
    const result = await attendanceService.list({ employeeNumber: req.params.employeeNumber, ...req.query });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function summary(req, res, next) {
  try {
    const result = await reportService.summary(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
};

/**
 * Reverse-sync pull for HRMS's "Sync" button flow (POST /api/v1/attendance/punches).
 * Authenticated by a Bearer API key with the `attendance:read` scope (the key HRMS
 * stores on its ExternalSystem record). Returns HRMS's bulk-import record shape;
 * `since` defaults to 7 days ago to bound the payload, matching HRMS's syncFromExternal.
 */
export async function pull(req, res, next) {
  try {
    const since = req.body?.since ? new Date(req.body.since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (req.body?.since && Number.isNaN(since.getTime())) {
      throw new AppError('Invalid since (must be ISO-8601)', 400, 'VALIDATION_ERROR');
    }
    const records = await attendanceService.pullForExternal({ since });
    return res.json({ records });
  } catch (e) {
    return next(e);
  }
};
