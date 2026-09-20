import { prisma } from '../lib/prisma.js';
import { attendanceRepository } from '../repositories/attendanceRepository.js';
import { dateKeyToUtc, endOfDateKeyExclusive, todayKey } from '../lib/time.js';

function rangeWhere({ from, to, department }) {
  const where = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = dateKeyToUtc(from);
    if (to) where.date.lt = endOfDateKeyExclusive(to);
  }
  if (department) {
    where.employee = { department: { contains: department, mode: 'insensitive' } };
  }
  return where;
}

function sumCounts(grouped) {
  const counts = {};
  let hours = 0;
  for (const g of grouped) {
    counts[g.status] = (counts[g.status] ?? 0) + g._count._all;
    hours += g._sum.hours ?? 0;
  }
  return { counts, hours };
}

function buildDepartmentTable(perEmployee) {
  const byDept = new Map();
  for (const row of perEmployee) {
    const dept = row.employee.department ?? 'Unassigned';
    if (!byDept.has(dept)) {
      byDept.set(dept, {
        department: dept,
        employees: 0,
        PRESENT: 0,
        LATE: 0,
        UNDERTIME: 0,
        HALF_DAY: 0,
        ABSENT: 0,
        ON_LEAVE: 0,
        totalHours: 0,
      });
    }
    const bucket = byDept.get(dept);
    bucket.employees += 1;
    bucket.PRESENT += row.presentDays;
    bucket.LATE += row.lateDays;
    bucket.UNDERTIME += row.undertimeDays;
    bucket.HALF_DAY += row.halfDays;
    bucket.ABSENT += row.absentDays;
    bucket.ON_LEAVE += row.onLeaveDays;
    bucket.totalHours += row.totalHours;
  }
  return [...byDept.values()]
    .map((b) => ({ ...b, totalHours: Math.round(b.totalHours * 100) / 100 }))
    .sort((a, b) => a.department.localeCompare(b.department));
}

export const reportService = {
  /** Daily roll-up: counts per status, attendance rate, department breakdown. */
  async daily({ date, department } = {}) {
    const day = date ?? todayKey();
    const where = rangeWhere({ from: day, to: day, department });
    const records = await attendanceRepository.list({ skip: 0, take: 1000, where });
    const counts = {};
    for (const r of records) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const present = counts.PRESENT ?? 0;
    const late = counts.LATE ?? 0;
    const undertime = counts.UNDERTIME ?? 0;
    const halfDay = counts.HALF_DAY ?? 0;
    const absent = counts.ABSENT ?? 0;
    const onLeave = counts.ON_LEAVE ?? 0;
    const totalActive = await prisma.employee.count({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        ...(department ? { department: { contains: department, mode: 'insensitive' } } : {}),
      },
    });
    const byDepartment = new Map();
    for (const r of records) {
      const dept = r.employee?.department ?? 'Unassigned';
      if (!byDepartment.has(dept)) {
        byDepartment.set(dept, { department: dept, PRESENT: 0, LATE: 0, UNDERTIME: 0, HALF_DAY: 0, ABSENT: 0, ON_LEAVE: 0 });
      }
      const bucket = byDepartment.get(dept);
      bucket[r.status] = (bucket[r.status] ?? 0) + 1;
    }
    return {
      date: day,
      counts: { PRESENT: present, LATE: late, UNDERTIME: undertime, HALF_DAY: halfDay, ABSENT: absent, ON_LEAVE: onLeave },
      totalActive,
      // Attendance rate = physically showed up (present+late+undertime+half-day) / active roster.
      attendanceRate: totalActive > 0 ? Math.round(((present + late + undertime + halfDay) / totalActive) * 1000) / 10 : null,
      byDepartment: [...byDepartment.values()].sort((a, b) => a.department.localeCompare(b.department)),
      records,
    };
  },

  /** Range summary: per-employee aggregates + overall counts + department table. */
  async summary({ from, to, department } = {}) {
    const where = rangeWhere({ from, to, department });
    const grouped = await attendanceRepository.groupByEmployeeStatus(where);
    const employeeIds = [...new Set(grouped.map((g) => g.employeeId))];
    const employees = employeeIds.length
      ? await prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, employeeNumber: true, firstName: true, lastName: true, department: true },
      })
      : [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    const perEmployee = employees
      .map((e) => {
        const rows = grouped.filter((g) => g.employeeId === e.id);
        const byStatus = {};
        let hours = 0;
        let lateMins = 0;
        let undertimeMins = 0;
        let recordCount = 0;
        for (const g of rows) {
          byStatus[g.status] = g._count._all;
          hours += g._sum.hours ?? 0;
          lateMins += g._sum.minutesLate ?? 0;
          undertimeMins += g._sum.undertimeMinutes ?? 0;
          recordCount += g._count._all;
        }
        return {
          employee: e,
          records: recordCount,
          presentDays: byStatus.PRESENT ?? 0,
          lateDays: byStatus.LATE ?? 0,
          undertimeDays: byStatus.UNDERTIME ?? 0,
          halfDays: byStatus.HALF_DAY ?? 0,
          absentDays: byStatus.ABSENT ?? 0,
          onLeaveDays: byStatus.ON_LEAVE ?? 0,
          totalHours: Math.round(hours * 100) / 100,
          totalLateMinutes: lateMins,
          totalUndertimeMinutes: undertimeMins,
        };
      })
      .sort((a, b) => `${a.employee.lastName}`.localeCompare(`${b.employee.lastName}`));
    const { counts, hours } = sumCounts(grouped);
    return {
      range: { from: from ?? null, to: to ?? null },
      counts,
      totalHours: Math.round(hours * 100) / 100,
      employees: perEmployee,
      byDepartment: buildDepartmentTable(perEmployee),
    };
  },

  /** Per-employee timesheet: dated rows + totals. */
  async timesheet(employeeId, { from, to } = {}) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, employeeNumber: true, firstName: true, lastName: true, department: true, position: true },
    });
    if (!employee) return null;
    const where = { employeeId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = dateKeyToUtc(from);
      if (to) where.date.lt = endOfDateKeyExclusive(to);
    }
    const records = await attendanceRepository.list({ skip: 0, take: 366, where, orderBy: [{ date: 'asc' }] });
    const totals = records.reduce(
      (acc, r) => {
        acc.totalHours += r.hours ?? 0;
        acc.totalLateMinutes += r.minutesLate ?? 0;
        acc.totalUndertimeMinutes += r.undertimeMinutes ?? 0;
        acc.byStatus[r.status] = (acc.byStatus[r.status] ?? 0) + 1;
        return acc;
      },
      { totalHours: 0, totalLateMinutes: 0, totalUndertimeMinutes: 0, byStatus: {} },
    );
    totals.totalHours = Math.round(totals.totalHours * 100) / 100;
    return { employee, records, totals };
  },

  /** CSV export of attendance rows (Reports page download / external consumers). */
  async exportCsv({ from, to, department } = {}) {
    const where = rangeWhere({ from, to, department });
    const records = await attendanceRepository.list({ skip: 0, take: 5000, where });
    const rows = records.map((r) => ({
      employeeNumber: r.employee?.employeeNumber ?? '',
      name: [r.employee?.firstName, r.employee?.lastName].filter(Boolean).join(' '),
      department: r.employee?.department ?? '',
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date ?? ''),
      timeIn: r.timeIn ? r.timeIn.toISOString() : '',
      timeOut: r.timeOut ? r.timeOut.toISOString() : '',
      hours: r.hours ?? '',
      status: r.status,
      minutesLate: r.minutesLate ?? 0,
      undertimeMinutes: r.undertimeMinutes ?? 0,
      source: r.source ?? '',
      remarks: r.remarks ?? '',
    }));
    const columns = ['employeeNumber', 'name', 'department', 'date', 'timeIn', 'timeOut', 'hours', 'status', 'minutesLate', 'undertimeMinutes', 'source', 'remarks'];
    return toCsv(rows, columns);
  },
};

function toCsv(rows, columns) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(escape).join(',');
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(','));
  return [header, ...lines].join('\n');
}
