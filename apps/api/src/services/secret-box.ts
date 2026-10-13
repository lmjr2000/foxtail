/**
 * Reversible encryption for credentials the server itself must use later (recorder RTSP passwords).
 * AES-256-GCM with a key derived from RECORDER_SECRET_KEY (falls back to JWT_SECRET). Carried over
 * from Eye of Omni. User passwords are NOT stored this way; they stay bcrypt hashes.
 *
 * Format: v1:<iv base64url>:<tag base64url>:<ciphertext base64url>
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { secretBoxKey } from '../config.js';

function key(): Buffer {
  return createHash('sha256').update(secretBoxKey()).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

/** null when the value is missing, malformed, or was sealed with a different key. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, ivB, tagB, ctB] = sealed.split(':');
  if (v !== 'v1' || !ivB || !tagB || !ctB) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
