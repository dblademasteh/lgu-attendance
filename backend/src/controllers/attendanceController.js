import { attendanceService } from '../services/attendanceService.js';
import { syncService } from '../services/syncService.js';
import { hrmsConfig } from '../lib/hrms.js';
import { AppError } from '../lib/errors.js';

// Choice B: forward collected punches to HRMS for its computation. Fire-and-
// forget — never delays/blocks the punch response. Failures are logged to the
// console plus a SyncLog (OUTBOUND) inside syncService.forwardToHrms, so a
// downstream HRMS outage never rolls back a locally-accepted punch.
function fireForwardToHrms(evt) {
  hrmsConfig()
    .then((cfg) => {
      if (!cfg.attendanceForwarding) return;
      syncService.forwardToHrms({ event: 'punch', payload: evt }).catch((e) => console.error('[attendance] HRMS forward failed:', e.message));
    })
    .catch((e) => console.error('[attendance] HRMS forward failed:', e.message));
}

export async function list(req, res, next) {
  try {
    const result = await attendanceService.list(req.query);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function today(req, res, next) {
  try {
    const board = await attendanceService.todayBoard({ department: req.query.department });
    return res.json(board);
  } catch (e) {
    return next(e);
  }
}

/** Self-service punch: the JWT user's linked employee (User.externalId = employeeNumber). */
export async function punchSelf(req, res, next) {
  try {
    const employeeNumber = req.user?.externalId;
    if (!employeeNumber) throw new AppError('No employee is linked to this account', 404, 'NOT_LINKED');
    // Strip any client-sent employeeNumber — self-service can only punch as
    // the linked employee; punching for others goes through /punch-manual.
    const { employeeNumber: _ignored, ...rest } = req.body;
    void _ignored;
    const result = await attendanceService.punch({ employeeNumber, ...rest, requireGeofence: true });
    fireForwardToHrms({ employeeNumber, eventTime: result.direction === 'IN' ? result.record.timeIn : result.record.timeOut, direction: result.direction, deviceRef: result.record.deviceRef, source: result.record.source, via: 'self' });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

/** Punch for another employee (ADMIN/HR_MANAGER/DEPARTMENT_HEAD). */
export async function punchManual(req, res, next) {
  try {
    if (!req.body.employeeNumber) {
      throw new AppError('employeeNumber is required for a manual punch', 400, 'VALIDATION_ERROR');
    }
    const result = await attendanceService.punch({ ...req.body, source: 'MANUAL', requireGeofence: false });
    fireForwardToHrms({ employeeNumber: req.body.employeeNumber, eventTime: result.direction === 'IN' ? result.record.timeIn : result.record.timeOut, direction: result.direction, deviceRef: result.record.deviceRef, source: result.record.source, via: 'manual' });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function markAbsent(req, res, next) {
  try {
    const result = await attendanceService.markAbsent(req.body);
    // Forward backfills too (only when rows were actually created) so the
    // HRMS-computed view stays converged with local corrections.
    if (!result.skipped && result.created > 0) {
      fireForwardToHrms({ event: 'mark_absent', date: req.body.date, created: result.created, employees: result.employees, via: 'backfill' });
    }
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function myToday(req, res, next) {
  try {
    const employeeNumber = req.user?.externalId;
    if (!employeeNumber) throw new AppError('No employee is linked to this account', 404, 'NOT_LINKED');
    const result = await attendanceService.myToday(employeeNumber);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function myHistory(req, res, next) {
  try {
    const employeeNumber = req.user?.externalId;
    if (!employeeNumber) throw new AppError('No employee is linked to this account', 404, 'NOT_LINKED');
    const result = await attendanceService.myHistory(employeeNumber, req.query.month);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
}

export async function correct(req, res, next) {
  try {
    // Before/after pair for the audit middleware.
    res.locals.auditBefore = await attendanceService.getById(req.params.id);
    const record = await attendanceService.correct(req.params.id, req.body);
    fireForwardToHrms({
      event: 'correction',
      employeeNumber: record.employee?.employeeNumber ?? null,
      recordId: record.id,
      date: record.date,
      timeIn: record.timeIn,
      timeOut: record.timeOut,
      status: record.status,
      via: 'correction',
    });
    return res.json(record);
  } catch (e) {
    return next(e);
  }
}

export async function getGeofence(req, res, next) {
  try {
    const config = await attendanceService.getGeofenceConfig();
    return res.json(config);
  } catch (e) {
    return next(e);
  }
}

export async function updateGeofence(req, res, next) {
  try {
    // Before/after pair for the audit middleware.
    res.locals.auditBefore = await attendanceService.getGeofenceConfig();
    const config = await attendanceService.updateGeofenceConfig(req.body);
    return res.json(config);
  } catch (e) {
    return next(e);
  }
}
