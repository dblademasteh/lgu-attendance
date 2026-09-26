import { attendanceService } from '../services/attendanceService.js';
import { syncService } from '../services/syncService.js';
import { biometricDeviceRepository } from '../repositories/biometricDeviceRepository.js';
import { AppError } from '../lib/errors.js';

/**
 * Device-facing punch ingestion. Devices are clients of this app (the server):
 * they POST raw IN/OUT punches authenticated by their registered Bearer token.
 * The :deviceId in the path must match the token-bound device to prevent a
 * misconfigured device writing another device's identity. Incoming punches
 * are grouped per employee and paired into AttendanceRecord (direction-aware
 * pairing), then the raw punches are forwarded to HRMS for computation.
 */
export async function receivePunches(req, res, next) {
  try {
    const pathDevice = req.params.deviceId;
    if (req.device.deviceId !== pathDevice) {
      throw new AppError('Device token does not match this deviceId', 403, 'FORBIDDEN');
    }
    await biometricDeviceRepository.touchLastSeen(req.device.id);

    const punches = req.body.punches;
    const grouped = new Map();
    for (const p of punches) {
      if (!grouped.has(p.employeeNumber)) grouped.set(p.employeeNumber, []);
      grouped.get(p.employeeNumber).push(p);
    }

    const results = [];
    for (const [empNum, empPunches] of grouped) {
      results.push(await attendanceService.ingestBiometricPunches({
        employeeNumber: empNum,
        punches: empPunches,
        deviceRef: req.device.deviceId,
        source: 'DEVICE',
      }));
    }
    const processed = results.reduce((n, r) => n + r.processed, 0);

    // Choice B: forward the raw punches to every forwarding-enabled
    // integration for computation.
    if (processed > 0) {
      syncService.forwardToIntegrations({
        event: 'biometric.punch_batch',
        payload: { deviceId: req.device.deviceId, punches },
      }).catch((e) => console.error('[device] forward failed:', e.message));
    }

    return res.status(200).json({
      ok: true,
      processed,
      perEmployee: Object.fromEntries(results.map((r) => [r.employeeNumber, r.processed])),
    });
  } catch (e) {
    return next(e);
  }
}

// --- Admin device registry: register / configure / manage terminals ---

export async function listDevices(req, res, next) {
  try {
    return res.json(await biometricDeviceRepository.list());
  } catch (e) {
    return next(e);
  }
}

export async function registerDevice(req, res, next) {
  try {
    const existing = await biometricDeviceRepository.findByDeviceId(req.body.deviceId);
    if (existing) throw new AppError('A device with that deviceId already exists', 409, 'DUPLICATE');
    const created = await biometricDeviceRepository.create({
      deviceId: req.body.deviceId,
      name: req.body.name,
      token: req.body.token,
      model: req.body.model,
      ip: req.body.ip,
    });
    // Raw token shown once (hashed with sha256 + stored as secretHash).
    return res.status(201).json({ ...created, token: req.body.token });
  } catch (e) {
    return next(e);
  }
}

export async function updateDevice(req, res, next) {
  try {
    const existing = await biometricDeviceRepository.findById(req.params.id);
    if (!existing) throw new AppError('Device not found', 404, 'NOT_FOUND');
    const updated = await biometricDeviceRepository.update(req.params.id, req.body);
    const resp = { ...updated };
    if (req.body.token) resp.token = req.body.token; // show new token once
    return res.json(resp);
  } catch (e) {
    return next(e);
  }
}

export async function deactivateDevice(req, res, next) {
  try {
    const existing = await biometricDeviceRepository.findById(req.params.id);
    if (!existing) throw new AppError('Device not found', 404, 'NOT_FOUND');
    await biometricDeviceRepository.deactivate(req.params.id);
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
}
