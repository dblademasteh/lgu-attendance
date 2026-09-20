import { api } from './client.js';

// Biometric device registry — this app is the server of the terminals.
// ADMIN/HR_MANAGER only (requireRole SYNC_WRITE_ROLES on the backend).
export const list = () => api.get('/admin/biometric-devices').then((r) => r.data);
export const register = (d) => api.post('/admin/biometric-devices', d).then((r) => r.data);
export const update = (id, d) => api.patch(`/admin/biometric-devices/${id}`, d).then((r) => r.data);
export const remove = (id) => api.delete(`/admin/biometric-devices/${id}`).then((r) => r.data);

// Biometric credential enrollment (WebAuthn) — self-service, JWT required.
export const getCredentials = () => api.get('/biometric/credentials').then((r) => r.data);
export const enroll = (credentialId, publicKey, deviceName) => api.post('/biometric/enroll', { credentialId, publicKey, deviceName }).then((r) => r.data);
export const removeCredential = (credentialId) => api.delete(`/biometric/credentials/${credentialId}`).then((r) => r.data);
export const getWebauthnEnrollOptions = () => api.get('/biometric/webauthn/enroll/options').then((r) => r.data);
export const webauthnEnrollVerify = (credential) => api.post('/biometric/webauthn/enroll/verify', { credential }).then((r) => r.data);
export const getVerifyChallenge = (credentialId) => api.get(`/biometric/verify-challenge?credentialId=${encodeURIComponent(credentialId)}`).then((r) => r.data);
export const verifyAssertion = (credentialId, authenticatorResponse, punchType) => api.post('/biometric/verify-assertion', { credentialId, authenticatorResponse, punchType }).then((r) => r.data);