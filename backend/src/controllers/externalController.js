import { attendanceService } from '../services/attendanceService.js';
import { reportService } from '../services/reportService.js';

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
}
