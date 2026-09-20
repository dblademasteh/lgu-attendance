import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || 'admin123';

// One user per role — idempotent, never clobbers a changed password.
const USERS = [
  { username: 'admin', fullName: 'System Administrator', role: 'ADMIN' },
  { username: 'hr_manager', fullName: 'HR Manager', role: 'HR_MANAGER' },
  { username: 'dept_head', fullName: 'Department Head', role: 'DEPARTMENT_HEAD' },
  { username: 'auditor', fullName: 'Compliance Auditor', role: 'AUDITOR' },
  // 'viewer' is linked to a real employee so self-service punching works in the demo.
  { username: 'viewer', fullName: 'Report Viewer', role: 'VIEWER', externalId: '2024-002' },
];

// Mirrors lgu-hrms AttendanceRule defaults: 08:00-17:00, 12:00-13:00 lunch, 15m grace.
// Geofence is DISABLED (officeLat/officeLng null) until coordinates are set via
// OFFICE_LAT / OFFICE_LNG (required together) — optional GEOFENCE_RADIUS_M
// (default 200m) and MAX_ACCURACY_M (default 100m) tune the guard. This is only
// the provisioning default; admins override it at runtime in Settings > Attendance.
const RULE = {
  name: 'Standard 8-5',
  workStartMins: 480,
  workEndMins: 1020,
  lunchStartMins: 720,
  lunchEndMins: 780,
  graceMinutes: 15,
  officeLat: process.env.OFFICE_LAT ? Number(process.env.OFFICE_LAT) : null,
  officeLng: process.env.OFFICE_LNG ? Number(process.env.OFFICE_LNG) : null,
  geofenceRadiusM: process.env.GEOFENCE_RADIUS_M ? Number(process.env.GEOFENCE_RADIUS_M) : 200,
  maxAccuracyM: process.env.MAX_ACCURACY_M ? Number(process.env.MAX_ACCURACY_M) : 100,
  active: true,
  isDefault: true,
};

// Demo roster pool for testing (syncSource MANUAL — replaced by HRMS sync
// once webhooks/polling are configured; employee numbers follow the HRMS
// YYYY-NNN convention).
const EMPLOYEES = [
  { employeeNumber: '2024-001', firstName: 'Juan', lastName: 'Dela Cruz', department: "Mayor's Office", position: 'Executive Assistant', email: 'juan.delacruz@lgu.gov.ph' },
  { employeeNumber: '2024-002', firstName: 'Maria', lastName: 'Santos', department: 'Human Resources', position: 'HR Officer', email: 'maria.santos@lgu.gov.ph' },
  { employeeNumber: '2024-003', firstName: 'Pedro', lastName: 'Reyes', department: 'Accounting', position: 'Accountant III', email: 'pedro.reyes@lgu.gov.ph' },
  { employeeNumber: '2024-004', firstName: 'Ana', lastName: 'Lopez', department: 'Engineering', position: 'Engineer II', email: 'ana.lopez@lgu.gov.ph' },
  { employeeNumber: '2024-005', firstName: 'Jose', lastName: 'Garcia', department: 'Health Office', position: 'Nurse II', email: 'jose.garcia@lgu.gov.ph' },
  { employeeNumber: '2024-006', firstName: 'Liza', lastName: 'Mendoza', department: 'Treasury', position: 'Local Treasury Operations Officer', email: 'liza.mendoza@lgu.gov.ph' },
  { employeeNumber: '2024-007', firstName: 'Ramon', lastName: 'Villanueva', department: "Assessor's Office", position: 'Assessment Clerk', email: 'ramon.villanueva@lgu.gov.ph' },
  { employeeNumber: '2024-008', firstName: 'Grace', lastName: 'Torres', department: 'Social Welfare', position: 'SWO I', email: 'grace.torres@lgu.gov.ph' },
  { employeeNumber: '2024-009', firstName: 'Carlo', lastName: 'Bautista', department: 'Engineering', position: 'Engineering Aide', email: 'carlo.bautista@lgu.gov.ph' },
  { employeeNumber: '2024-010', firstName: 'Sofia', lastName: 'Navarro', department: 'Human Resources', position: 'HR Assistant', email: 'sofia.navarro@lgu.gov.ph' },
  { employeeNumber: '2024-011', firstName: 'Miguel', lastName: 'Castillo', department: 'Accounting', position: 'Bookkeeper', email: 'miguel.castillo@lgu.gov.ph' },
  { employeeNumber: '2024-012', firstName: 'Elena', lastName: 'Aquino', department: 'Health Office', position: 'Midwife', email: 'elena.aquino@lgu.gov.ph' },
];

// Philippine regular holidays for seed-year context (idempotent upserts).
const HOLIDAYS = [
  { date: '2026-04-02', name: 'Maundy Thursday' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-09', name: 'Araw ng Kagitingan' },
  { date: '2026-05-01', name: 'Labor Day' },
  { date: '2026-06-12', name: 'Independence Day' },
  { date: '2026-08-21', name: 'Ninoy Aquino Day' },
  { date: '2026-11-30', name: 'Bonifacio Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-30', name: 'Rizal Day' },
];

/** Deterministic string hash for repeatable demo data. */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function mins(h, m) {
  return h * 60 + m;
}

async function main() {
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: { externalId: u.externalId ?? undefined },
      create: { ...u, passwordHash, status: 'ACTIVE' },
    });
  }

  await prisma.attendanceRule.upsert({
    where: { name: RULE.name },
    update: {
      officeLat: RULE.officeLat,
      officeLng: RULE.officeLng,
      geofenceRadiusM: RULE.geofenceRadiusM,
      maxAccuracyM: RULE.maxAccuracyM,
    },
    create: RULE,
  });

  for (const h of HOLIDAYS) {
    const day = new Date(`${h.date}T00:00:00.000Z`);
    await prisma.holiday.upsert({ where: { date: day }, update: { name: h.name }, create: { date: day, name: h.name } });
  }

  for (const e of EMPLOYEES) {
    await prisma.employee.upsert({
      where: { employeeNumber: e.employeeNumber },
      update: {
        firstName: e.firstName,
        lastName: e.lastName,
        department: e.department,
        position: e.position,
        email: e.email,
      },
      create: {
        ...e,
        hiredDate: new Date('2020-01-06T00:00:00.000Z'),
        monthlySalary: 32000,
        syncSource: 'MANUAL',
        status: 'ACTIVE',
      },
    });
  }

  // Demo attendance: last 14 days, weekdays only, deterministic mix of
  // present/late/undertime/absent so Dashboard/Reports have data immediately.
  const employees = await prisma.employee.findMany({
    where: { employeeNumber: { in: EMPLOYEES.map((e) => e.employeeNumber) } },
  });
  const shiftedNow = new Date(Date.now() + 8 * 60 * 60 * 1000); // Manila clock
  let created = 0;
  for (let d = 14; d >= 1; d--) {
    const day = new Date(shiftedNow.getTime() - d * 24 * 3600 * 1000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    const dateKey = day.toISOString().slice(0, 10);
    const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
    for (const emp of employees) {
      const seed = hash(`${emp.employeeNumber}:${dateKey}`) % 100;
      let timeIn = null;
      let timeOut = null;
      let minutesLate = 0;
      let undertimeMinutes = 0;
      let hours = null;
      let status = 'PRESENT';
      if (seed < 8) {
        status = 'ABSENT';
      } else {
        // time-in: on time (7:55-8:10) or late (8:16-8:45)
        const late = seed >= 8 && seed < 20;
        const inMins = late ? mins(8, 16 + (seed % 30)) : mins(7, 55 + (seed % 16));
        minutesLate = Math.max(0, inMins - 480 - 15);
        // time-out: normal (17:00-17:40) or undertime (16:05-16:50)
        const undertime = seed >= 20 && seed < 30;
        const outMins = undertime ? mins(16, 5 + (seed % 46)) : mins(17, 0 + (seed % 41));
        undertimeMinutes = Math.max(0, 1020 - outMins);
        hours = Math.round(((outMins - inMins - Math.max(0, Math.min(outMins, 780) - Math.max(inMins, 720))) / 60) * 100) / 100;
        timeIn = new Date(dayStart.getTime() - 8 * 3600 * 1000 + inMins * 60000);
        timeOut = new Date(dayStart.getTime() - 8 * 3600 * 1000 + outMins * 60000);
        if (minutesLate > 0) status = 'LATE';
        if (undertimeMinutes > 0) status = 'UNDERTIME';
      }
      const existing = await prisma.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId: emp.id, date: dayStart } },
      });
      if (existing) continue;
      await prisma.attendanceRecord.create({
        data: {
          employeeId: emp.id,
          date: dayStart,
          timeIn,
          timeOut,
          hours,
          status,
          minutesLate,
          undertimeMinutes,
          source: 'PUNCH',
          remarks: status === 'ABSENT' ? 'Seeded demo absence' : null,
        },
      });
      created += 1;
    }
  }

  console.log(`Seed complete: ${USERS.length} users (password: ${DEFAULT_PASSWORD}), ${employees.length} employees, ${created} attendance rows.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
