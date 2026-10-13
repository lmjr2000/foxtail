/**
 * POST /api/auth/login            { email, password } -> { token, user }
 * POST /api/auth/google           { credential } -> { token, user }   (only when GOOGLE_CLIENT_ID is set; existing logins only)
 * GET  /api/auth/config           what the sign-in page should offer
 * GET  /api/auth/me               the signed-in user (allowed while a password change is pending)
 * POST /api/auth/change-password  { currentPassword, newPassword } -> { token, user }
 */
import { Router, type Request } from 'express';
import { authenticate, signSession } from '../middleware/auth.js';
import { badRequest, HttpError, unauthorized } from '../lib/http.js';
import { q } from '../db/pool.js';
import { burnPasswordCheck, checkPassword, getUser, getUserRowByEmail, passwordProblem, rowToUser, setPassword, type User } from '../services/users.js';
import { googleClientId, verifyGoogleCredential } from '../services/google-auth.js';
import { audit } from '../services/audit.js';

const router = Router();

// Simple in-memory brake on password guessing: 10 failures per email+IP per 15 minutes.
const failures = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 15 * 60_000;
function failKey(req: Request, email: string) { return `${req.ip}|${email.toLowerCase()}`; }
function blocked(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() > f.until) { failures.delete(key); return false; }
  return f.n >= 10;
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() > f.until) failures.set(key, { n: 1, until: Date.now() + WINDOW_MS });
  else f.n++;
  if (failures.size > 10_000) failures.delete(failures.keys().next().value as string);
}
export function resetLoginLimits(): void { failures.clear(); }

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, franchiseeId: u.franchiseeId, mustChangePassword: u.mustChangePassword };
}

async function sessionFor(user: User) {
  await q('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  return { token: signSession(user), user: publicUser(user) };
}

const BAD_LOGIN = 'Email or password is incorrect.';

router.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) throw badRequest('Enter your email and password.');
  const key = failKey(req, email);
  if (blocked(key)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Wait 15 minutes and try again.');
  const row = await getUserRowByEmail(email);
  const ok = row ? await checkPassword(password, row.password_hash as string | null) : (await burnPasswordCheck(password), false);
  if (!row || !ok) { recordFailure(key); throw unauthorized(BAD_LOGIN); }
  const user = rowToUser(row);
  if (user.disabled) throw unauthorized('This login has been turned off. Contact Foxtail corporate.');
  failures.delete(key);
  res.json(await sessionFor(user));
});

router.get('/config', (_req, res) => {
  res.json({ googleClientId: googleClientId() });
});

router.post('/google', async (req, res) => {
  if (!googleClientId()) throw new HttpError(404, 'NOT_FOUND', 'Google sign-in is not turned on');
  let identity;
  try {
    identity = await verifyGoogleCredential(String(req.body?.credential || ''));
  } catch (err) {
    throw unauthorized(err instanceof Error ? err.message : 'Google sign-in failed');
  }
  // Google sign-in never creates logins: store access must be assigned by a corporate admin first.
  const row = await getUserRowByEmail(identity.email);
  if (!row) throw unauthorized('There is no Foxtail login for this Google account. Ask Foxtail corporate to add you.');
  const user = rowToUser(row);
  if (user.disabled) throw unauthorized('This login has been turned off. Contact Foxtail corporate.');
  if (row.google_sub && row.google_sub !== identity.sub) throw unauthorized('This login is linked to a different Google account.');
  if (!row.google_sub) await q('UPDATE users SET google_sub = $2 WHERE id = $1', [user.id, identity.sub]);
  res.json(await sessionFor(user));
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.auth!.user) });
});

router.post('/change-password', authenticate, async (req, res) => {
  const user = req.auth!.user;
  const row = await getUserRowByEmail(user.email);
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = req.body?.newPassword;
  if (!row || !(await checkPassword(current, row.password_hash as string | null))) throw badRequest('Your current password is not correct.');
  const problem = passwordProblem(next);
  if (problem) throw badRequest(problem);
  if (next === current) throw badRequest('Choose a password you have not used here before.');
  await setPassword(user.id, next as string, false);
  await audit(user.id, 'user.password_changed', null, {});
  const fresh = await getUser(user.id);
  res.json({ token: signSession(fresh!), user: publicUser(fresh!) });
});

export default router;
