import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { API_KEY_SCOPES } from '../shared/constants.js';

export async function list(req, res, next) {
  try {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return res.json({ items: keys, total: keys.length });
  } catch (e) {
    return next(e);
  }
}

/** Creates a Bearer key for an external consumer (shown once — sha256 at rest). */
export async function create(req, res, next) {
  try {
    const raw = `ak_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
    const created = await prisma.apiKey.create({
      data: {
        name: req.body.name,
        prefix: raw.slice(0, 10),
        keyHash,
        scopes: req.body.scopes,
      },
      select: { id: true, name: true, prefix: true, scopes: true, active: true, createdAt: true },
    });
    return res.status(201).json({ ...created, key: raw });
  } catch (e) {
    return next(e);
  }
}

export async function remove(req, res, next) {
  try {
    const existing = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('API key not found', 404, 'NOT_FOUND');
    await prisma.apiKey.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
}
