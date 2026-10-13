/**
 * Error shape every route returns: { error: CODE, message }. Throw HttpError from a handler; the
 * error middleware in app.ts turns it into the response (Express 5 forwards async throws).
 */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, 'FORBIDDEN', message);
/** Same text for "does not exist" and "not yours", so a scoped login cannot tell the difference. */
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);

export function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
