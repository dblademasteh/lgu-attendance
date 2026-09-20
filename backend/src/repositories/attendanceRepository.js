import { prisma } from '../lib/prisma.js';

const employeeInclude = {
  employee: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      department: true,
      position: true,
    },
  },
};

export const attendanceRepository = {
  async list({ skip = 0, take = 20, where, orderBy }) {
    return prisma.attendanceRecord.findMany({
      where,
      skip,
      take,
      orderBy: orderBy ?? [{ date: 'desc' }, { employee: { lastName: 'asc' } }],
      include: employeeInclude,
    });
  },
  async count(where) {
    return prisma.attendanceRecord.count({ where });
  },
  async findById(id) {
    return prisma.attendanceRecord.findUnique({ where: { id }, include: employeeInclude });
  },
  async findByEmployeeAndDate(employeeId, dateStart, dateEndExclusive) {
    return prisma.attendanceRecord.findFirst({
      where: { employeeId, date: { gte: dateStart, lt: dateEndExclusive } },
      include: employeeInclude,
    });
  },
  async upsertByEmployeeAndDate(employeeId, dateStart, data) {
    return prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: dateStart } },
      update: data,
      create: { employeeId, date: dateStart, ...data },
      include: employeeInclude,
    });
  },
  async updateById(id, data) {
    return prisma.attendanceRecord.update({ where: { id }, data, include: employeeInclude });
  },
  async createMany(rows) {
    return prisma.attendanceRecord.createMany({ data: rows });
  },
  /** (employeeId, status) aggregation for the summary report. */
  async groupByEmployeeStatus(where) {
    return prisma.attendanceRecord.groupBy({
      by: ['employeeId', 'status'],
      where,
      _count: { _all: true },
      _sum: { hours: true, minutesLate: true, undertimeMinutes: true },
    });
  },

  async listByEmployeeAndDateRange(employeeId, dateStart, dateEnd) {
    return prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: dateStart, lt: dateEnd } },
      orderBy: { date: 'asc' },
    });
  },
};
