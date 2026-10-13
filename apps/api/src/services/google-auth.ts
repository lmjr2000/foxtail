/**
 * Google sign-in (carried over from Eye of Omni): verify a Google Identity Services ID token via Google's
 * tokeninfo endpoint. Off unless GOOGLE_CLIENT_ID is set. Only signs in logins that already exist.
 */
export interface GoogleIdentity { email: string; name?: string; sub: string }

const TOKENINFO_URL = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';

export function googleClientId(): string | null {
  const id = (process.env.GOOGLE_CLIENT_ID || '').trim();
  return id.length > 10 ? id : null;
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const clientId = googleClientId();
  if (!clientId) throw new Error('Google sign-in is not configured');
  if (!credential || credential.length < 20 || credential.length > 4096) throw new Error('Invalid Google credential');
  const res = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw new Error('Google rejected the sign-in token');
  const info = (await res.json()) as Record<string, string>;
  if (info.aud !== clientId) throw new Error('Google token was issued for a different app');
  if (info.iss !== 'https://accounts.google.com' && info.iss !== 'accounts.google.com') throw new Error('Google token issuer mismatch');
  if (info.exp && Number(info.exp) * 1000 < Date.now()) throw new Error('Google token expired');
  if (!info.email || info.email_verified !== 'true') throw new Error('Google account email is not verified');
  return { email: info.email.toLowerCase(), name: info.name, sub: info.sub };
}
