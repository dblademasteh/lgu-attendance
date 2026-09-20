import crypto from 'node:crypto';

/**
 * At-rest encryption for DB-stored integration secrets (HRMS API key, webhook
 * secret). AES-256-GCM with a server-side key: CONFIG_ENCRYPTION_KEY (32
 * bytes, hex or base64) when set, otherwise a SHA-256 derivation of
 * JWT_SECRET (dev-grade fallback — set an explicit key in production).
 * Format: base64(iv) + '.' + base64(ciphertext+tag).
 */
function encryptionKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (raw) {
    try {
      const buf = /^(?:[0-9a-fA-F]{64})$/.test(raw.trim())
        ? Buffer.from(raw.trim(), 'hex')
        : Buffer.from(raw.trim(), 'base64');
      if (buf.length === 32) return buf;
    } catch {
      // fall through to the derived key
    }
  }
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || 'lgu-attendance-dev-fallback').digest();
}

export function encryptSecret(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `${iv.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (payload == null) return null;
  const [ivB64, encB64] = String(payload).split('.');
  if (!ivB64 || !encB64) return null;
  const iv = Buffer.from(ivB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const tag = enc.subarray(enc.length - 16);
  const data = enc.subarray(0, enc.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Last-4 preview for UI placeholders — never expose a full secret. */
export function secretPreview(plaintext) {
  if (!plaintext) return null;
  const s = String(plaintext);
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}
