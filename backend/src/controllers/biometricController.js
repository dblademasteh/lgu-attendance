import { biometricService } from '../services/biometricService.js';
import { prisma } from '../lib/prisma.js';
import { webauthnService, webauthnEnv } from '../services/webauthnService.js';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { requireRole } from '../middleware/rbac.js';
import { ROLES } from '../shared/constants.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const enrollSchema = z.object({
  credentialId: z.string().min(1),
  publicKey: z.string().min(1),
  deviceName: z.string().optional().nullable(),
});

const verifySchema = z.object({
  credentialId: z.string().min(1),
  assertion: z.object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
  }),
  punchType: z.enum(['IN', 'OUT']).optional(),
});

const listSchema = z.object({
  employeeId: z.string().optional().nullable(),
});

export const biometricController = {
  async enroll(req, res, next) {
    try {
      const parsed = enrollSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      }
      const { credentialId, publicKey, deviceName } = parsed.data;
      const employeeNumber = req.user?.externalId;
      if (!employeeNumber) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No employee is linked to this account' } });
      }
      const employee = await prisma.employee.findUnique({ where: { employeeNumber } });
      if (!employee) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const record = await biometricService.enroll(employee.id, credentialId, publicKey, deviceName);
      return res.status(201).json({ credential: record });
    } catch (e) {
      return next(e);
    }
  },

  async webauthnEnrollOptions(req, res, next) {
    try {
      const employeeNumber = req.user?.externalId;
      if (!employeeNumber) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No employee is linked to this account' } });
      }
      const employee = await prisma.employee.findUnique({ where: { employeeNumber } });
      if (!employee) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const options = await webauthnService.generateEnrollmentOptions(employee.id);
      return res.json({ options });
    } catch (e) {
      return next(e);
    }
  },

  async webauthnEnrollVerify(req, res, next) {
    try {
      const parsed = z
        .object({
          credential: z.object({
            id: z.string().min(1),
            rawId: z.string().min(1),
            response: z.object({
              clientDataJSON: z.string().min(1),
              attestationObject: z.string().min(1),
            }),
            type: z.literal('public-key'),
          }),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      }

      const employeeNumber = req.user?.externalId;
      if (!employeeNumber) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No employee is linked to this account' } });
      }
      const employee = await prisma.employee.findUnique({ where: { employeeNumber } });
      if (!employee) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const expectedChallenge = webauthnService.takeEnrollmentChallenge(employee.id);
      if (!expectedChallenge) {
        const err = new Error('Enrollment session expired — start again');
        err.status = 400;
        err.code = 'ENROLLMENT_EXPIRED';
        throw err;
      }

      const { credential } = parsed.data;
      let verification;
      try {
        verification = verifyRegistrationResponse({
          response: {
            id: credential.id,
            rawId: credential.rawId,
            response: {
              clientDataJSON: credential.response.clientDataJSON,
              attestationObject: credential.response.attestationObject,
            },
            clientExtensionResults: {},
            type: credential.type,
          },
          expectedChallenge,
          expectedOrigin: webauthnEnv.origin,
          expectedRPID: webauthnEnv.rpId,
        });
      } catch (e) {
        const err = new Error('Biometric enrollment verification failed');
        err.status = 400;
        err.code = 'ENROLLMENT_FAILED';
        throw err;
      }

      if (!verification.verified) {
        const err = new Error('Biometric enrollment verification failed');
        err.status = 400;
        err.code = 'ENROLLMENT_FAILED';
        throw err;
      }

      const credentialId = verification.credential.id;
      const publicKey = Buffer.from(verification.credential.publicKey).toString('base64url');

      const record = await webauthnService.verifyEnrollment(employee.id, credentialId, publicKey);
      return res.status(201).json({ credential: record });
    } catch (e) {
      return next(e);
    }
  },

  async verify(req, res, next) {
    try {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      }
      const { credentialId, assertion, punchType } = parsed.data;
      const result = await biometricService.verify(credentialId, assertion);
      return res.json({ ...result, verified: true });
    } catch (e) {
      return next(e);
    }
  },

  async getVerifyChallenge(req, res, next) {
    try {
      const { credentialId } = req.query || {};
      if (!credentialId) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'credentialId is required' } });
      }
      const { options, credentialId: normalizedCredentialId, employeeId } = await webauthnService.generateAuthenticationOptions(credentialId);
      return res.json({ options, credentialId: normalizedCredentialId, employeeId });
    } catch (e) {
      return next(e);
    }
  },

  async verifyAssertion(req, res, next) {
    try {
      const parsed = z
        .object({
          credentialId: z.string().min(1),
          authenticatorResponse: z.object({
            clientDataJSON: z.string().min(1),
            authenticatorData: z.string().min(1),
            signature: z.string().min(1),
            challenge: z.string().min(1),
          }),
          punchType: z.enum(['IN', 'OUT']).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      }
      const { credentialId, authenticatorResponse } = parsed.data;
      const result = await webauthnService.verifyAuthentication(credentialId, authenticatorResponse);
      return res.json({ ...result, verified: true });
    } catch (e) {
      return next(e);
    }
  },

  async list(req, res, next) {
    try {
      const { employeeId } = req.query || {};
      if (employeeId) {
        if (![ROLES.ADMIN, ROLES.HR_MANAGER].includes(req.user?.role)) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
        }
        const credentials = await biometricService.listForEmployee(employeeId);
        return res.json({ credentials, employeeId });
      }

      const employeeNumber = req.user?.externalId;
      if (!employeeNumber) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No employee is linked to this account' } });
      }
      const employee = await prisma.employee.findUnique({ where: { employeeNumber } });
      if (!employee) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }
      const credentials = await biometricService.listForEmployee(employee.id);
      return res.json({ credentials });
    } catch (e) {
      return next(e);
    }
  },

  async remove(req, res, next) {
    try {
      const { credentialId } = req.params;
      const result = await biometricService.remove(credentialId);
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
};