import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

function refreshSecret() {
  return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev-refresh-secret';
}

function signTokens(user) {
  const payload = { id: user.id, username: user.username, role: user.role, externalId: user.externalId ?? null };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ ...payload, typ: 'refresh' }, refreshSecret(), { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

function publicUser(user) {
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

export const authService = {
  async login({ username, password }) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    if (user.status !== 'ACTIVE') throw new AppError('Account is inactive', 403, 'INACTIVE');
    return { user: publicUser(user), ...signTokens(user) };
  },

  async refresh(refreshToken) {
    let payload;
    try {
      payload = jwt.verify(refreshToken, refreshSecret());
    } catch {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }
    if (payload.typ !== 'refresh') throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    // Re-read the user row so the new access token carries the live
    // role/status; inactive users fail closed.
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('Account is inactive', 403, 'INACTIVE');
    return { user: publicUser(user), ...signTokens(user) };
  },
};
