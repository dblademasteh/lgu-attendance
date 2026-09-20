import { prisma } from '../lib/prisma.js';

const publicSelect = {
  id: true,
  hrmsId: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  middleName: true,
  email: true,
  department: true,
  position: true,
  status: true,
  hiredDate: true,
  monthlySalary: true,
  syncSource: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
};

export const employeeRepository = {
  async list({ skip = 0, take = 20, where }) {
    return prisma.employee.findMany({
      where,
      skip,
      take,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: publicSelect,
    });
  },
  async count(where) {
    return prisma.employee.count({ where });
  },
  async findById(id) {
    return prisma.employee.findFirst({ where: { id, deletedAt: null }, select: publicSelect });
  },
  /** Active roster rows only (deletedAt filtered) — the join key path. */
  async findByEmployeeNumber(employeeNumber) {
    return prisma.employee.findFirst({ where: { employeeNumber, deletedAt: null } });
  },
  /** Any row including soft-deleted — used to revive rehired numbers. */
  async findByEmployeeNumberAny(employeeNumber) {
    return prisma.employee.findUnique({ where: { employeeNumber } });
  },
  async findByHrmsId(hrmsId) {
    return prisma.employee.findFirst({ where: { hrmsId, deletedAt: null } });
  },
  async create(data) {
    return prisma.employee.create({ data, select: publicSelect });
  },
  async updateById(id, data) {
    return prisma.employee.update({ where: { id }, data, select: publicSelect });
  },
  async listActive({ department } = {}) {
    const where = { status: 'ACTIVE', deletedAt: null };
    if (department) where.department = { contains: department, mode: 'insensitive' };
    return prisma.employee.findMany({
      where,
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        department: true,
        position: true,
        email: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  },
  async countActive(department) {
    const where = { status: 'ACTIVE', deletedAt: null };
    if (department) where.department = { contains: department, mode: 'insensitive' };
    return prisma.employee.count({ where });
  },
};
