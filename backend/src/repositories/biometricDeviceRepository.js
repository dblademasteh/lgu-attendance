import { prisma } from '../lib/prisma.js';
import crypto from 'node:crypto';

const SELECT = {
  id: true, deviceId: true, name: true, model: true, ip: true, active: true, lastSeenAt: true, createdAt: true,
};

export const biometricDeviceRepository = {
  async list() {
    return prisma.biometricDevice.findMany({ orderBy: { createdAt: 'desc' }, select: SELECT });
  },
  async findById(id) {
    return prisma.biometricDevice.findUnique({ where: { id }, select: SELECT });
  },
  async findByDeviceId(deviceId) {
    return prisma.biometricDevice.findUnique({ where: { deviceId }, select: SELECT });
  },
  async findBySecretHash(secretHash) {
    return prisma.biometricDevice.findUnique({ where: { secretHash }, select: { id: true, deviceId: true, name: true, model: true, ip: true, active: true, lastSeenAt: true, createdAt: true } });
  },
  async create({ deviceId, name, token, model, ip }) {
    const secretHash = crypto.createHash('sha256').update(token).digest('hex');
    return prisma.biometricDevice.create({
      data: { deviceId, name, secretHash, model, ip },
      select: { ...SELECT, updatedAt: true },
    });
  },
  async update(id, { name, model, ip, active, token }) {
    const data = {};
    if (name !== undefined) data.name = name;
    if (model !== undefined) data.model = model;
    if (ip !== undefined) data.ip = ip;
    if (active !== undefined) data.active = active;
    if (token) data.secretHash = crypto.createHash('sha256').update(token).digest('hex');
    return prisma.biometricDevice.update({
      where: { id },
      data,
      select: { ...SELECT, updatedAt: true },
    });
  },
  async touchLastSeen(id) {
    return prisma.biometricDevice.update({ where: { id }, data: { lastSeenAt: new Date() }, select: SELECT });
  },
  async deactivate(id) {
    return prisma.biometricDevice.update({ where: { id }, data: { active: false }, select: SELECT });
  },
  async remove(id) {
    return prisma.biometricDevice.delete({ where: { id }, select: SELECT });
  },
};
