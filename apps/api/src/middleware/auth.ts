/**
 * Sessions: a signed JWT ({ sub: userId, tv: tokenVersion }) sent as "Authorization: Bearer ...".
 *
 * Every request re-reads the user from Postgres, so disabling a login, changing its role or
 * franchisee, or changing its password takes effect on the very next request (the token version
 * is bumped on password change and disable, which kills older tokens).
 */
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { canManage, isCorporate } from '@foxtail/shared';
import { jwtSecret, SESSION_HOURS } from '../config.js';
import { forbidden, HttpError, unauthorized } from '../lib/http.js';
import { getUser, type User } from '../services/users.js';

export interface AuthContext {
  user: User;
  /** null = every store (corporate). Otherwise the franchisee whose stores this login may see. */
  franchiseeScope: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export function signSession(user: Pick<User, 'id' | 'tokenVersion'>): string {
  return jwt.sign({ sub: user.id, tv: user.tokenVersion }, jwtSecret(), { expiresIn: `${SESSION_HOURS}h` });
}

function readToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Resolves the session; does not yet insist that a forced password change has happened. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req);
  if (!token) throw unauthorized();
  let payload: { sub?: unknown; tv?: unknown };
  try {
    payload = jwt.verify(token, jwtSecret()) as { sub?: unknown; tv?: unknown };
  } catch {
    throw unauthorized('Your session has expired. Sign in again.');
  }
  const user = typeof payload.sub === 'string' ? await getUser(payload.sub) : null;
  if (!user || user.disabled || payload.tv !== user.tokenVersion) throw unauthorized('Your session has expired. Sign in again.');
  // A franchise owner always has a franchisee (database constraint); corporate roles see every store.
  req.auth = { user, franchiseeScope: isCorporate(user.role) ? null : user.franchiseeId };
  next();
}

/** Blocks everything except the auth routes until a temporary password has been replaced. */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.user.mustChangePassword) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password to continue.');
  next();
}

/** Corporate admin only: settings, stores, recorders, counting areas, logins, POS uploads. */
export function requireManager(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth || !canManage(req.auth.user.role)) throw forbidden();
  next();
}

/** Corporate roles only (admin or viewer): franchisee and login lists. */
export function requireCorporate(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth || !isCorporate(req.auth.user.role)) throw forbidden();
  next();
}
