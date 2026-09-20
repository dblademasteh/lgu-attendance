import { prisma } from '../lib/prisma.js';

export const biometricRepository = {
  async findByCredentialId(credentialId) {
    return prisma.biometricCredential.findFirst({
      where: { credentialId },
      include: { employee: true },
    });
  },

  async findByEmployee(employeeId) {
    return prisma.biometricCredential.findMany({
      where: { employeeId },
      orderBy: { enrolledAt: 'desc' },
    });
  },

  async create(data) {
    return prisma.biometricCredential.create({ data });
  },

  async updateCounter(credentialId, counter) {
    return prisma.biometricCredential.updateMany({
      where: { credentialId },
      data: { counter, lastUsedAt: new Date() },
    });
  },

  async delete(credentialId) {
    return prisma.biometricCredential.deleteMany({ where: { credentialId } });
  },
};