/** Prospect links: https://<host>/d/<token>. Token = base64url, 16-100 chars. */
const RE = /^\/d\/([A-Za-z0-9_-]{16,100})\/?$/;
export function inviteTokenFromPath(pathname: string): string | null {
  const m = RE.exec(pathname || '');
  return m ? m[1] : null;
}
/** True for any /d/... path (valid or not), so a malformed link still lands on the link screen. */
export function isInvitePath(pathname: string): boolean { return /^\/d(\/|$)/.test(pathname || ''); }
