import bcrypt from 'bcryptjs';
import { isRole, type Role } from '@foxtail/shared';
import { q } from '../db/pool.js';
import { newId } from '../lib/ids.js';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  franchiseeId: string | null;
  mustChangePassword: boolean;
  disabled: boolean;
  tokenVersion: number;
  hasPassword: boolean;
  googleLinked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

type Row = Record<string, unknown>;

export function rowToUser(r: Row): User {
  const role = String(r.role);
  if (!isRole(role)) throw new Error(`Unknown role in database: ${role}`);
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ''),
    role,
    franchiseeId: (r.franchisee_id as string) ?? null,
    mustChangePassword: r.must_change_password === true,
    disabled: !!r.disabled_at,
    tokenVersion: Number(r.token_version ?? 0),
    hasPassword: !!r.password_hash,
    googleLinked: !!r.google_sub,
    lastLoginAt: r.last_login_at ? new Date(String(r.last_login_at)).toISOString() : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

export async function getUser(id: string): Promise<User | null> {
  const r = await q('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export async function getUserRowByEmail(email: string): Promise<Row | null> {
  const r = await q('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  return r.rows[0] ?? null;
}

const BCRYPT_ROUNDS = 11;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function checkPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

let dummy: Promise<string> | null = null;
/** Spend the same time on an unknown email as on a wrong password, so timing does not reveal which emails exist. */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummy ??= hashPassword('foxtail-timing-equalizer');
  await bcrypt.compare(plain, await dummy);
}

/** Reasons a new password is not acceptable, or null when it is. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number.';
  return null;
}

export async function createUser(input: { email: string; name: string; role: Role; franchiseeId: string | null; password: string; mustChangePassword: boolean }): Promise<User> {
  const id = newId('us');
  const r = await q(
    `INSERT INTO users (id, email, name, role, franchisee_id, password_hash, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, input.email.trim(), input.name.trim(), input.role, input.role === 'franchise_owner' ? input.franchiseeId : null, await hashPassword(input.password), input.mustChangePassword],
  );
  return rowToUser(r.rows[0]);
}

export async function setPassword(userId: string, plain: string, mustChange: boolean): Promise<void> {
  await q(
    'UPDATE users SET password_hash = $2, must_change_password = $3, token_version = token_version + 1, updated_at = NOW() WHERE id = $1',
    [userId, await hashPassword(plain), mustChange],
  );
}

export async function listUsers(): Promise<User[]> {
  const r = await q('SELECT * FROM users ORDER BY lower(name), lower(email)');
  return r.rows.map(rowToUser);
}
