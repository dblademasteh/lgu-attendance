import { prisma } from '../lib/prisma.js';

export const syncRepository = {
  async create(data) {
    return prisma.syncLog.create({ data });
  },
  async list({ skip = 0, take = 20, where }) {
    return prisma.syncLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } });
  },
  /** Find the most recent SUCCESSFUL outbound forward for a given idempotency key. */
  async findSuccessfulByKey(idempotencyKey) {
    return prisma.syncLog.findFirst({
      where: { idempotencyKey, direction: 'OUTBOUND', status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
  },
  async count(where) {
    return prisma.syncLog.count({ where });
  },
  async latest() {
    return prisma.syncLog.findFirst({ orderBy: { createdAt: 'desc' } });
  },
  async counts() {
    const rows = await prisma.syncLog.groupBy({ by: ['status'], _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  },
};
