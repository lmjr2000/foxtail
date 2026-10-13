/**
 * Server settings from the environment. Production refuses to start without a real JWT secret.
 * See .env.example at the repo root for every variable.
 */
const DEV_SECRET = 'foxtail-dev-secret-not-for-production';

export const isProduction = process.env.NODE_ENV === 'production';

export function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (isProduction) throw new Error('JWT_SECRET (32+ characters) is required in production');
  return DEV_SECRET;
}

/** Key for sealing recorder passwords. Falls back to the JWT secret so one secret is enough to start. */
export function secretBoxKey(): string {
  return process.env.RECORDER_SECRET_KEY || jwtSecret();
}

export const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);

/**
 * Demo site: example stores with generated numbers and one-click, look-only logins on the sign-in
 * page. Only for a separate demo deployment with its own database — never point it at real stores.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}
