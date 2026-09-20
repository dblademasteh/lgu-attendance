import { biometricRepository } from '../repositories/biometricRepository.js';
import { AppError } from '../lib/errors.js';

export const biometricService = {
  async enroll(employeeId, credentialId, publicKey, deviceName) {
    const existing = await biometricRepository.findByCredentialId(credentialId);
    if (existing) {
      throw new AppError('Credential already enrolled', 409, 'ALREADY_ENROLLED');
    }

    return biometricRepository.create({
      employeeId,
      credentialId,
      publicKey,
      deviceName: deviceName || null,
    });
  },

  async verify(credentialId, assertion) {
    const credential = await biometricRepository.findByCredentialId(credentialId);
    if (!credential) {
      throw new AppError('Credential not found', 404, 'NOT_FOUND');
    }

    await biometricRepository.updateCounter(credentialId, (credential.counter || 0) + 1);
    return {
      valid: true,
      employeeId: credential.employeeId,
      employeeNumber: credential.employee?.employeeNumber,
      employeeName: `${credential.employee?.firstName ?? ''} ${credential.employee?.lastName ?? ''}`.trim(),
    };
  },

  async listForEmployee(employeeId) {
    return biometricRepository.findByEmployee(employeeId);
  },

  async remove(credentialId) {
    const result = await biometricRepository.delete(credentialId);
    if (!result || result.count === 0) {
      throw new AppError('Credential not found', 404, 'NOT_FOUND');
    }
    return { message: 'Credential removed' };
  },
};