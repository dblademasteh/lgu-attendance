import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

/**
 * Machine consumer auth: Bearer API key, sha256-hashed at rest, scope-checked.
 * Usage: requireApiKey('attendance:read'). External consumers (e.g. HRMS
 * payroll pulling attendance reports) present the key; UI users use JWT
 * requireAuth instead.
 */
export function requireApiKey(...scopes) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const key = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!key) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } });
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    try {
      const record = await prisma.apiKey.findUnique({ where: { keyHash } });
      if (!record || !record.active) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
      }
      const granted = scopes.length === 0 || scopes.every((s) => record.scopes.includes(s));
      if (!granted) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `API key missing scope: ${scopes.join(', ')}` } });
      }
      req.apiKey = { id: record.id, name: record.name, scopes: record.scopes };
      prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch((e) => console.error('apiKey lastUsedAt:', e));
      return next();
    } catch (e) {
      return next(e);
    }
  };
}
