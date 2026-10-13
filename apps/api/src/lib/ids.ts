import { randomBytes } from 'node:crypto';

/** Random, non-sequential id with a readable prefix (st_ store, us_ user, fr_ franchisee, ...). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** Readable one-time password for new logins and resets (no ambiguous characters). */
export function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(14);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 9)}-${out.slice(9, 14)}`;
}
