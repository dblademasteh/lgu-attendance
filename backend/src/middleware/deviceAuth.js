import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

/**
 * Device auth for biometric terminals: Bearer token (the raw token configured
 * at registration) is sha256-hashed and matched against BiometricDevice.
 * Sets req.device. Mirrors the API-key posture (token shown once, hashed at
 * rest). Devices never authenticate as app users.
 */
export function requireDeviceAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Device token required' } });
  const secretHash = crypto.createHash('sha256').update(token).digest('hex');
  prisma.biometricDevice
    .findUnique({ where: { secretHash } })
    .then((device) => {
      if (!device || !device.active) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive device' } });
      }
      req.device = device;
      return next();
    })
    .catch(next);
}
