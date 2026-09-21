import { prisma } from '../lib/prisma.js';
import { attendanceRepository } from '../repositories/attendanceRepository.js';
import { employeeRepository } from '../repositories/employeeRepository.js';
import { AppError } from '../lib/errors.js';
import {
  manilaDateKey,
  dateKeyToUtc,
  endOfDateKeyExclusive,
  manilaMinutes,
  normalizeTimeField,
  todayKey,
} from '../lib/time.js';
import { ATTENDANCE_STATUSES, ATTENDANCE_SOURCES, NO_RECORD } from '../shared/constants.js';
import { assertWithinGeofence } from '../lib/geo.js';

async function activeRule() {
  const rule = (await prisma.attendanceRule.findFirst({ where: { active: true, isDefault: true } }))
    ?? (await prisma.attendanceRule.findFirst({ where: { active: true } }));
  // Mirrors lgu-hrms AttendanceRule defaults: 08:00-17:00, 12:00-13:00.
  return rule ?? { workStartMins: 480, workEndMins: 1020, lunchStartMins: 720, lunchEndMins: 780, graceMinutes: 15 };
}

/** Normalize an AttendanceRule row into the Settings geofence shape. */
function geofenceConfigFrom(rule) {
  const enabled = rule.officeLat != null && rule.officeLng != null;
  return {
    enabled,
    officeLat: rule.officeLat ?? null,
    officeLng: rule.officeLng ?? null,
    geofenceRadiusM: rule.geofenceRadiusM,
    maxAccuracyM: rule.maxAccuracyM,
  };
}

const LEAVE_TYPES = ['VACATION', 'SICK', 'EMERGENCY', 'MATERNITY', 'PATERNITY', 'SOLO_PARENT', 'OTHER'];
const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

/** Resolve the local employee for a leave webhook (employeeNumber first, then HRMS id). */
async function resolveLeaveEmployee(payload) {
  if (payload.employeeNumber) {
    const byNumber = await employeeRepository.findByEmployeeNumberAny(payload.employeeNumber);
    if (byNumber) return byNumber;
  }
  if (payload.employeeId) return employeeRepository.findByHrmsId(payload.employeeId);
  return null;
}

/** Map an HRMS leave-type string onto the LeaveType enum (unknown -> OTHER). */
function mapLeaveType(raw) {
  const v = String(raw ?? 'VACATION').toUpperCase().replace(/[\s-]+/g, '_');
  return LEAVE_TYPES.includes(v) ? v : 'OTHER';
}

/** Map an HRMS leave-status string onto the LeaveStatus enum (unknown -> PENDING). */
function mapLeaveStatus(raw) {
  const v = String(raw ?? 'PENDING').toUpperCase();
  return LEAVE_STATUSES.includes(v) ? v : 'PENDING';
}

/** Minutes of the worked window that overlap the lunch break (unpaid). */
function lunchOverlap(startMins, endMins, rule) {
  const overlapStart = Math.max(startMins, rule.lunchStartMins);
  const overlapEnd = Math.min(endMins, rule.lunchEndMins);
  return Math.max(0, overlapEnd - overlapStart);
}

/**
 * Compute status + late/undertime from punch times against the active rule.
 * Precedence: HALF_DAY (<4h worked) > LATE > UNDERTIME > PRESENT. Returns
 * status: null when there is no time-in (caller keeps the existing status).
 */
function computeDerivations(timeIn, timeOut, rule) {
  if (!timeIn) return { minutesLate: 0, undertimeMinutes: 0, status: null, hours: null };
  const inMins = manilaMinutes(timeIn);
  const minutesLate = Math.max(0, inMins - rule.workStartMins - rule.graceMinutes);
  if (!timeOut) {
    return { minutesLate, undertimeMinutes: 0, status: minutesLate > 0 ? ATTENDANCE_STATUSES.LATE : ATTENDANCE_STATUSES.PRESENT, hours: null };
  }
  const outMins = manilaMinutes(timeOut);
  const gross = outMins - inMins;
  if (gross < 0) throw new AppError('timeOut is before timeIn on the same Manila day', 400, 'VALIDATION_ERROR');
  const minutesLateFinal = Math.max(0, inMins - rule.workStartMins - rule.graceMinutes);
  const undertimeMinutes = Math.max(0, rule.workEndMins - outMins);
  let status = ATTENDANCE_STATUSES.PRESENT;
  if (minutesLateFinal > 0) status = ATTENDANCE_STATUSES.LATE;
  if (undertimeMinutes > 0) status = ATTENDANCE_STATUSES.UNDERTIME;
  const net = gross - lunchOverlap(inMins, outMins, rule);
  const hours = Math.round((net / 60) * 100) / 100;
  if (hours < 4) status = ATTENDANCE_STATUSES.HALF_DAY;
  return { minutesLate: minutesLateFinal, undertimeMinutes, status, hours };
}

export const attendanceService = {
  /**
   * Punch state machine (mirrors the lgu-hrms kiosk): AUTO resolves IN when
   * today has no open row, OUT when the latest row is open; explicit
   * IN/OUT enforce the same guards. One record per employee per day.
   */
  async punch({ employeeNumber, employeeId, direction = 'AUTO', at, remarks, source = ATTENDANCE_SOURCES.PUNCH, deviceRef, geo = null, requireGeofence = false }) {
    const employee = employeeNumber
      ? await employeeRepository.findByEmployeeNumber(employeeNumber)
      : (employeeId ? await employeeRepository.findById(employeeId) : null);
    if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

    const rule = await activeRule();
    // Self-service punches are strict: a location fix (or the geofence itself)
    // is required. Manual/hr processes pass geo optionally for recording only.
    if (requireGeofence && !geo) {
      throw new AppError('Location access is required to punch. Enable GPS and allow location permission.', 400, 'LOCATION_REQUIRED');
    }
    if (geo) {
      assertWithinGeofence(geo, rule);
    }

    const dateKey = todayKey();
    const dayStart = dateKeyToUtc(dateKey);
    const dayEnd = endOfDateKeyExclusive(dateKey);
    const punchAt = normalizeTimeField(at) ?? new Date();

    const existing = await attendanceRepository.findByEmployeeAndDate(employee.id, dayStart, dayEnd);
    let dir = direction;
    if (dir === 'AUTO') {
      dir = !existing || !existing.timeIn ? 'IN' : (!existing.timeOut ? 'OUT' : null);
      if (!dir) throw new AppError('Already clocked in and out today', 409, 'ALREADY_CLOCKED');
    }

    if (dir === 'IN') {
      if (existing?.timeIn) throw new AppError('Already clocked in today', 409, 'ALREADY_CLOCKED_IN');
      const derivations = computeDerivations(punchAt, null, rule);
      const data = {
        timeIn: punchAt,
        minutesLate: derivations.minutesLate,
        undertimeMinutes: 0,
        hours: null,
        status: derivations.status ?? ATTENDANCE_STATUSES.PRESENT,
        source,
        deviceRef: deviceRef ?? null,
        geoIn: geo ?? existing?.geoIn ?? null,
        remarks: remarks ?? existing?.remarks ?? null,
      };
      const record = await attendanceRepository.upsertByEmployeeAndDate(employee.id, dayStart, data);
      return { direction: 'IN', record };
    }

    if (!existing || !existing.timeIn) throw new AppError('No clock-in found for today', 400, 'NO_CLOCK_IN');
    if (existing.timeOut) throw new AppError('Already clocked out today', 409, 'ALREADY_CLOCKED_OUT');
    const derivations = computeDerivations(existing.timeIn, punchAt, rule);
    const data = {
      timeOut: punchAt,
      minutesLate: derivations.minutesLate,
      undertimeMinutes: derivations.undertimeMinutes,
      hours: derivations.hours,
      status: derivations.status,
      source,
      deviceRef: deviceRef ?? existing.deviceRef,
      geoOut: geo ?? null,
      remarks: remarks ?? existing.remarks,
    };
    const record = await attendanceRepository.updateById(existing.id, data);
    return { direction: 'OUT', record };
  },

  /**
   * Backfill ABSENT/ON_LEAVE rows for every active employee without a
   * record on a Manila day. Holidays skip entirely; approved leaves mark
   * ON_LEAVE. Idempotent — rows only fill the gaps.
   */
  async markAbsent({ date }) {
    const dayStart = dateKeyToUtc(date);
    const dayEnd = endOfDateKeyExclusive(date);
    const holiday = await prisma.holiday.findUnique({ where: { date: dayStart } });
    if (holiday) return { skipped: true, reason: `Holiday: ${holiday.name}`, created: 0 };

    const activeEmployees = await employeeRepository.listActive();
    const existing = await prisma.attendanceRecord.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      select: { employeeId: true },
    });
    const haveSet = new Set(existing.map((r) => r.employeeId));
    const missing = activeEmployees.filter((e) => !haveSet.has(e.id));
    if (missing.length === 0) return { skipped: false, created: 0 };

    const leaves = await prisma.leaveRequest.findMany({
      where: { status: 'APPROVED', startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
      select: { employeeId: true },
    });
    const leaveSet = new Set(leaves.map((l) => l.employeeId));
    const rows = missing.map((e) => ({
      employeeId: e.id,
      date: dayStart,
      status: leaveSet.has(e.id) ? ATTENDANCE_STATUSES.ON_LEAVE : ATTENDANCE_STATUSES.ABSENT,
      source: ATTENDANCE_SOURCES.MANUAL,
    }));
    await attendanceRepository.createMany(rows);
    return {
      skipped: false,
      created: rows.length,
      employees: missing.map((e) => ({
        employeeNumber: e.employeeNumber,
        status: leaveSet.has(e.id) ? ATTENDANCE_STATUSES.ON_LEAVE : ATTENDANCE_STATUSES.ABSENT,
      })),
    };
  },

  /**
   * Upsert a leave from an HRMS leave.created/updated webhook. Join key is
   * the HRMS leave id (stored as LeaveRequest.hrmsId); without one we fall
   * back to employee + date-range matching. Approved rows drive ON_LEAVE in
   * markAbsent, so HRMS-approved leaves now flow through automatically.
   */
  async upsertLeaveFromHrms(payload) {
    const employee = await resolveLeaveEmployee(payload);
    if (!employee) throw new AppError('HRMS leave payload matches no employee (employeeNumber/employeeId)', 400, 'HRMS_PAYLOAD_INVALID');
    const startDate = payload.startDate ? dateKeyToUtc(payload.startDate) : null;
    const endDate = payload.endDate ? dateKeyToUtc(payload.endDate) : null;
    if (!startDate || !endDate) throw new AppError('HRMS leave payload missing startDate/endDate (YYYY-MM-DD)', 400, 'HRMS_PAYLOAD_INVALID');
    if (endDate < startDate) throw new AppError('HRMS leave endDate is before startDate', 400, 'HRMS_PAYLOAD_INVALID');
    const data = {
      employeeId: employee.id,
      type: mapLeaveType(payload.leaveType),
      startDate,
      endDate,
      status: mapLeaveStatus(payload.leaveStatus ?? payload.status),
      reason: payload.reason ?? null,
      approvedBy: payload.approvedBy ?? payload.actorUserId ?? null,
    };
    const hrmsId = payload.leaveId ?? null;
    let existing = null;
    if (hrmsId) existing = await prisma.leaveRequest.findUnique({ where: { hrmsId } });
    if (!existing) {
      existing = await prisma.leaveRequest.findFirst({
        where: { employeeId: employee.id, startDate, endDate },
      });
    }
    if (existing) return prisma.leaveRequest.update({ where: { id: existing.id }, data: { ...data, hrmsId: hrmsId ?? existing.hrmsId } });
    return prisma.leaveRequest.create({ data: { ...data, hrmsId } });
  },

  /** leave.deleted webhook: drop the mirrored leave row. */
  async deleteLeaveFromHrms(payload) {
    const employee = await resolveLeaveEmployee(payload);
    const hrmsId = payload.leaveId ?? null;
    let existing = null;
    if (hrmsId) {
      existing = await prisma.leaveRequest.findUnique({ where: { hrmsId } });
    } else if (employee && payload.startDate && payload.endDate) {
      existing = await prisma.leaveRequest.findFirst({
        where: { employeeId: employee.id, startDate: dateKeyToUtc(payload.startDate), endDate: dateKeyToUtc(payload.endDate) },
      });
    }
    if (!existing) return null;
    return prisma.leaveRequest.delete({ where: { id: existing.id } });
  },

  async getById(id) {
    return attendanceRepository.findById(id);
  },

  /** Runtime punch-geofence config exposed to Settings (ADMIN/HR_MANAGER). */
  async getGeofenceConfig() {
    const rule =
      (await prisma.attendanceRule.findFirst({ where: { active: true, isDefault: true } }))
      ?? (await prisma.attendanceRule.findFirst({ where: { active: true } }));
    if (!rule) {
      return { enabled: false, officeLat: null, officeLng: null, geofenceRadiusM: null, maxAccuracyM: null };
    }
    return geofenceConfigFrom(rule);
  },

  /** Persist geofence settings onto the active default rule. Disabling clears
   * the office anchor (radius/accuracy are kept so re-enabling is easy). */
  async updateGeofenceConfig(patch) {
    const rule =
      (await prisma.attendanceRule.findFirst({ where: { active: true, isDefault: true } }))
      ?? (await prisma.attendanceRule.findFirst({ where: { active: true } }));
    if (!rule) throw new AppError('No active attendance rule to configure', 404, 'NOT_FOUND');
    const data = {
      officeLat: patch.enabled ? (patch.officeLat ?? null) : null,
      officeLng: patch.enabled ? (patch.officeLng ?? null) : null,
      geofenceRadiusM: patch.enabled ? (patch.geofenceRadiusM ?? rule.geofenceRadiusM ?? 200) : rule.geofenceRadiusM,
      maxAccuracyM: patch.enabled ? (patch.maxAccuracyM ?? rule.maxAccuracyM ?? 100) : rule.maxAccuracyM,
    };
    const updated = await prisma.attendanceRule.update({ where: { id: rule.id }, data });
    return geofenceConfigFrom(updated);
  },

  /** Correction: recompute derivations from the patched times; explicit
   * status override wins. Throws VALIDATION_ERROR on out < in. */
  async correct(id, patch) {
    const record = await attendanceRepository.findById(id);
    if (!record) throw new AppError('Attendance record not found', 404, 'NOT_FOUND');
    const rule = await activeRule();
    const dateKey = manilaDateKey(record.date);
    const timeIn = patch.timeIn === undefined ? record.timeIn : normalizeTimeField(patch.timeIn, dateKey);
    const timeOut = patch.timeOut === undefined ? record.timeOut : normalizeTimeField(patch.timeOut, dateKey);
    const derivations = computeDerivations(timeIn, timeOut, rule);
    const data = {
      timeIn,
      timeOut,
      minutesLate: derivations.minutesLate,
      undertimeMinutes: derivations.undertimeMinutes,
      hours: derivations.hours,
      status: patch.status ?? derivations.status ?? record.status,
      remarks: patch.remarks === undefined ? record.remarks : patch.remarks,
    };
    return attendanceRepository.updateById(id, data);
  },

  async list(filters = {}) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where = {};
    if (filters.status) where.status = filters.status;
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.employeeNumber) {
      const employee = await employeeRepository.findByEmployeeNumber(filters.employeeNumber);
      if (!employee) return { items: [], total: 0, page, limit };
      where.employeeId = employee.id;
    }
    const employeeFilter = {};
    if (filters.department) employeeFilter.department = { contains: filters.department, mode: 'insensitive' };
    if (Object.keys(employeeFilter).length > 0) where.employee = employeeFilter;
    if (filters.from || filters.to) {
      where.date = {};
      if (filters.from) where.date.gte = dateKeyToUtc(filters.from);
      if (filters.to) where.date.lt = endOfDateKeyExclusive(filters.to);
    }
    const [items, total] = await Promise.all([
      attendanceRepository.list({ skip: (page - 1) * limit, take: limit, where }),
      attendanceRepository.count(where),
    ]);
    return { items, total, page, limit };
  },

  /** Live board: every active employee with today's row or a NO_RECORD
   * placeholder, plus per-status counts. */
  async todayBoard({ department } = {}) {
    const dateKey = todayKey();
    const dayStart = dateKeyToUtc(dateKey);
    const dayEnd = endOfDateKeyExclusive(dateKey);
    const employees = await employeeRepository.listActive({ department });
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
    });
    const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
    const rows = employees.map((e) => {
      const r = byEmployee.get(e.id);
      return {
        employee: e,
        status: r?.status ?? NO_RECORD,
        timeIn: r?.timeIn ?? null,
        timeOut: r?.timeOut ?? null,
        hours: r?.hours ?? null,
        minutesLate: r?.minutesLate ?? 0,
        undertimeMinutes: r?.undertimeMinutes ?? 0,
        source: r?.source ?? null,
        deviceRef: r?.deviceRef ?? null,
        recordId: r?.id ?? null,
      };
    });
    const counts = rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    return { date: dateKey, rows, counts };
  },

  async myToday(employeeNumber) {
    const employee = await employeeRepository.findByEmployeeNumber(employeeNumber);
    if (!employee) throw new AppError('No employee is linked to this account', 404, 'NOT_LINKED');
    const dateKey = todayKey();
    const record = await attendanceRepository.findByEmployeeAndDate(
      employee.id,
      dateKeyToUtc(dateKey),
      endOfDateKeyExclusive(dateKey),
    );
    return { date: dateKey, employee, record };
  },

  async myHistory(employeeNumber, month) {
    const employee = await employeeRepository.findByEmployeeNumber(employeeNumber);
    if (!employee) throw new AppError('No employee is linked to this account', 404, 'NOT_LINKED');

    const [year, mon] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year, mon - 1, 1));
    const monthEnd = new Date(Date.UTC(year, mon, 1));

    const records = await attendanceRepository.listByEmployeeAndDateRange(employee.id, monthStart, monthEnd);

    const summary = {
      totalDays: records.length,
      present: 0,
      late: 0,
      undertime: 0,
      halfDay: 0,
      absent: 0,
      onLeave: 0,
      totalHours: 0,
    };
    for (const r of records) {
      if (r.status === 'PRESENT') summary.present += 1;
      else if (r.status === 'LATE') summary.late += 1;
      else if (r.status === 'UNDERTIME') summary.undertime += 1;
      else if (r.status === 'HALF_DAY') summary.halfDay += 1;
      else if (r.status === 'ABSENT') summary.absent += 1;
      else if (r.status === 'ON_LEAVE') summary.onLeave += 1;
      summary.totalHours += r.hours || 0;
    }
    summary.totalHours = Math.round(summary.totalHours * 100) / 100;

    return { employee, month, records, summary };
  },

  /**
   * Reverse-sync export for HRMS's pull flow (POST /api/v1/attendance/punches).
   * Returns attendance rows newer than `since` (default: 7 days) in HRMS's
   * bulk-import shape ({employeeNumber, date, timeIn?, timeOut?, hours?,
   * remark?, source?}) so HRMS's bulkIngest can upsert them. Dates are
   * Manila-day keyed; times are ISO-8601 (HRMS normalizes both). Bounded to a
   * 1000-row page to stay within HRMS's bulk array cap.
   */
  async pullForExternal({ since }) {
    const where = since instanceof Date && !Number.isNaN(since.getTime())
      ? { updatedAt: { gte: since } }
      : {};
    const records = await attendanceRepository.list({
      skip: 0,
      take: 1000,
      where,
      orderBy: [{ updatedAt: 'desc' }],
    });
    return records.map((r) => ({
      employeeNumber: r.employee?.employeeNumber ?? null,
      date: r.date ? manilaDateKey(new Date(r.date)) : null,
      timeIn: r.timeIn ? r.timeIn.toISOString() : null,
      timeOut: r.timeOut ? r.timeOut.toISOString() : null,
      hours: r.hours ?? null,
      remark: r.remarks ?? null,
      source: r.source ?? ATTENDANCE_SOURCES.MANUAL,
    }));
  },

  /**
   * the biometric.punch / biometric.punch_batch webhook events). Punches are
   * grouped per employee per Manila day; the earliest becomes timeIn, the latest
   * timeOut (a single punch yields an open IN, no OUT). deriveLated from the
   * active AttendanceRule, and the daily AttendanceRecord is upserted with
   * source=DEVICE + deviceRef (device data is authoritative for the day). Every
   * raw punch is also persisted to BiometricPunch for audit.
   */
  async ingestBiometricPunches({ employeeNumber, punches, source = ATTENDANCE_SOURCES.DEVICE, deviceRef = null }) {
    const employee = await employeeRepository.findByEmployeeNumber(employeeNumber);
    if (!employee) throw new AppError(`Employee not found for biometric ingest: ${employeeNumber}`, 404, 'NOT_FOUND');
    const rule = await activeRule();

    const byDay = new Map();
    for (const p of punches) {
      const t = normalizeTimeField(p.timestamp);
      if (!t) throw new AppError(`Invalid biometric punch timestamp: ${p.timestamp}`, 400, 'HRMS_PAYLOAD_INVALID');
      const dateKey = manilaDateKey(t);
      const dayStart = dateKeyToUtc(dateKey);
      if (!byDay.has(dateKey)) byDay.set(dateKey, { dayStart, items: [] });
      byDay.get(dateKey).items.push({ t, direction: p.direction ?? 'AUTO', deviceRef: p.deviceRef ?? deviceRef ?? null });
    }

    const results = [];
    for (const [dateKey, { dayStart, items }] of byDay) {
      items.sort((a, b) => a.t - b.t);
      const existing = await attendanceRepository.findByEmployeeAndDate(
        employee.id,
        dayStart,
        endOfDateKeyExclusive(dateKey),
      );
      // Direction-aware pairing: explicit IN/OUT directions let us merge an
      // incremental single-direction punch (e.g. OUT only) without clobbering
      // the existing timeIn. A full IN+OUT batch is device-authoritative.
      const hasIn = items.some((i) => i.direction === 'IN');
      const hasOut = items.some((i) => i.direction === 'OUT');
      let timeIn;
      let timeOut;
      if (hasIn && hasOut) {
        timeIn = items[0].t; // earliest
        timeOut = items[items.length - 1].t; // latest
      } else if (hasIn) {
        timeIn = items[0].t;
        timeOut = existing?.timeOut ?? null; // keep any existing clock-out
      } else if (hasOut) {
        timeIn = existing?.timeIn ?? null; // keep any existing clock-in
        timeOut = items[items.length - 1].t;
      } else {
        // No directions: earliest in, latest out (single punch => open IN).
        timeIn = items[0].t;
        timeOut = items.length === 1 ? null : items[items.length - 1].t;
      }
      const derivations = computeDerivations(timeIn, timeOut, rule);
      const record = await attendanceRepository.upsertByEmployeeAndDate(employee.id, dayStart, {
        timeIn,
        timeOut,
        minutesLate: derivations.minutesLate,
        undertimeMinutes: derivations.undertimeMinutes ?? 0,
        hours: derivations.hours,
        status: derivations.status ?? ATTENDANCE_STATUSES.PRESENT,
        source,
        deviceRef: deviceRef ?? items[0].deviceRef ?? null,
        remarks: `Biometric ingest: ${items.length} punch(es) from ${source.toLowerCase()} device${items[0].deviceRef ? ` (${items[0].deviceRef})` : ''}`.trim(),
      });
      await prisma.biometricPunch.createMany({
        data: items.map((p) => ({
          employeeNumber,
          date: dayStart,
          eventTime: p.t,
          direction: p.direction ?? 'AUTO',
          deviceRef: p.deviceRef ?? deviceRef ?? null,
          source,
        })),
      });
      results.push({ employeeNumber, date: dateKey, punches: items.length, record });
    }
    return { processed: punches.length, results };
  },
};
