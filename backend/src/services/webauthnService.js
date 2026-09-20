import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const RP_NAME = 'LGU Attendance';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5174';

// One-shot enrollment challenges, keyed by employeeId. WebAuthn requires the
// exact challenge handed to the browser to be echoed on verification; an
// in-memory store (5 min TTL) ties the two requests together without adding a
// session layer. In-flight enrollments vanish on server restart — acceptable
// for a single-node on-prem deployment.
const ENROLL_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const enrollChallenges = new Map();

function storeEnrollChallenge(employeeId, challenge) {
  enrollChallenges.set(employeeId, {
    challenge,
    expiresAt: Date.now() + ENROLL_CHALLENGE_TTL_MS,
  });
}

function takeEnrollChallenge(employeeId) {
  const entry = enrollChallenges.get(employeeId);
  enrollChallenges.delete(employeeId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

export const webauthnEnv = { rpId: RP_ID, origin: ORIGIN };

export const webauthnService = {
  async generateEnrollmentOptions(employeeId) {
    const existing = await prisma.biometricCredential.findFirst({
      where: { employeeId },
    });

    const options = generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: `employee-${employeeId}`,
      userDisplayName: `Employee ${employeeId}`,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      challenge: crypto.randomBytes(32).toString('base64url'),
      excludeCredentials: existing
        ? [
            {
              id: existing.credentialId,
              type: 'public-key',
              transports: ['internal'],
            },
          ]
        : [],
    });

    storeEnrollChallenge(employeeId, options.challenge);
    return options;
  },

  takeEnrollmentChallenge(employeeId) {
    return takeEnrollChallenge(employeeId);
  },

  async verifyEnrollment(employeeId, credentialId, publicKey) {
    const existing = await prisma.biometricCredential.findFirst({
      where: { employeeId },
    });
    if (existing) {
      const err = new Error('Credential already enrolled');
      err.status = 409;
      err.code = 'ALREADY_ENROLLED';
      throw err;
    }

    return prisma.biometricCredential.create({
      data: {
        employeeId,
        credentialId,
        publicKey,
        counter: 0,
      },
    });
  },

  async generateAuthenticationOptions(credentialId) {
    const credential = await prisma.biometricCredential.findFirst({
      where: { credentialId },
      include: { employee: true },
    });
    if (!credential) {
      const err = new Error('Credential not found');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const options = generateAuthenticationOptions({
      rpID: RP_ID,
      challenge: crypto.randomBytes(32).toString('base64url'),
      userVerification: 'required',
      allowCredentials: [
        {
          id: credential.credentialId,
          type: 'public-key',
          transports: ['internal'],
        },
      ],
    });

    return { options, credentialId: credential.credentialId, employeeId: credential.employeeId };
  },

  async verifyAuthentication(credentialId, authenticatorResponse) {
    const credential = await prisma.biometricCredential.findFirst({
      where: { credentialId },
      include: { employee: true },
    });
    if (!credential) {
      const err = new Error('Credential not found');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    let verification;
    try {
      verification = verifyAuthenticationResponse({
        response: {
          id: credential.credentialId,
          rawId: credential.credentialId,
          response: {
            clientDataJSON: authenticatorResponse.clientDataJSON,
            authenticatorData: authenticatorResponse.authenticatorData,
            signature: authenticatorResponse.signature,
          },
          clientExtensionResults: {},
          type: 'public-key',
        },
        expectedChallenge: authenticatorResponse.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.counter || 0,
          transports: ['internal'],
        },
      });
    } catch (e) {
      const err = new Error('Biometric verification failed');
      err.status = 401;
      err.code = 'BIOMETRIC_FAILED';
      throw err;
    }

    if (!verification.verified) {
      const err = new Error('Biometric verification failed');
      err.status = 401;
      err.code = 'BIOMETRIC_FAILED';
      throw err;
    }

    await prisma.biometricCredential.update({
      where: { credentialId },
      data: { counter: (credential.counter || 0) + 1, lastUsedAt: new Date() },
    });

    return {
      valid: true,
      employeeId: credential.employeeId,
      employeeNumber: credential.employee?.employeeNumber,
      employeeName: `${credential.employee?.firstName ?? ''} ${credential.employee?.lastName ?? ''}`.trim(),
    };
  },
};