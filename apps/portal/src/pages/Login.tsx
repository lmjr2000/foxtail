import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ROLE_LABELS, ROLES, type Role } from '@foxtail/shared';
import { ApiError, apiFetch, apiPost, type SessionUser } from '../lib/api';
import { useAuth } from '../lib/auth';

declare global {
  interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } } }
}

/** Google button, shown only when the server has Google sign-in turned on. */
function GoogleButton({ clientId, onError }: { clientId: string; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { signIn } = useAuth();
  useEffect(() => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          try {
            const r = await apiPost<{ token: string; user: SessionUser }>('/auth/google', { credential: resp.credential });
            signIn(r.token, r.user);
          } catch (e) { onError(e instanceof Error ? e.message : 'Google sign-in failed'); }
        },
      });
      if (ref.current) window.google?.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320 });
    };
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, [clientId, signIn, onError]);
  return <div ref={ref} className="flex justify-center" />;
}

const DEMO_ROLE_DESCRIPTIONS: Record<Role, string> = {
  corporate_admin: 'Full access to all stores and settings',
  corporate_viewer: 'Read-only access to all stores',
  franchise_owner: 'Access to owned franchise stores only',
};

const isPreview = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export default function Login() {
  const { login, demoLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);

  useEffect(() => { apiFetch<{ googleClientId: string | null }>('/auth/providers').then(c => setGoogleId(c.googleClientId)).catch(() => {}); }, []);

  const handleDemo = async (role: Role) => {
    setDemoRole(role); setError(null);
    try {
      await demoLogin(role);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many demo requests. Please wait a few minutes and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Demo sign-in failed');
      }
    } finally { setDemoRole(null); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {isPreview && (
        <div className="bg-amber-500 text-black text-center py-2 px-4 text-sm font-semibold">
          ⚠️ PREVIEW — SAMPLE DATA ONLY — Not connected to live system
        </div>
      )}
      <div className="flex-1 grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand p-12 text-white border-r-4 border-accent">
        <img src="/foxtail-wordmark-white.png" alt="Foxtail Coffee Co." className="h-9 w-auto self-start" />
        <div>
          <p className="eyebrow !text-[#69c9cd] mb-3">Store performance</p>
          <h1 className="font-display text-4xl font-extrabold leading-tight text-white">Every store's rush, line and staffing — in numbers.</h1>
          <p className="mt-4 text-white/70 max-w-md">Customer traffic, wait times and counter coverage from the cameras already in every Foxtail Coffee Co. store, side by side with register sales.</p>
        </div>
        <p className="text-xs text-white/50">Counts only. No recordings are kept and no one is identified.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" aria-label="Sign in">
          <div className="lg:hidden mb-6"><img src="/foxtail-wordmark-black.png" alt="Foxtail Coffee Co." className="h-8 w-auto dark:invert" /></div>
          <div>
            <h2 className="text-xl font-bold text-ink">Sign in</h2>
            <p className="text-sm text-ink-3 mt-1">Use the email your Foxtail login was created with.</p>
          </div>
          {error && <div className="callout callout-bad" role="alert">{error}</div>}
          <label className="block"><span className="input-label">Email</span>
            <input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="block"><span className="input-label">Password</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {googleId && <><div className="text-center text-xs text-ink-4">or</div><GoogleButton clientId={googleId} onError={setError} /></>}
          <p className="text-xs text-ink-4">Forgot your password? Ask a Foxtail corporate admin to reset it.</p>
        </form>
        <div className="w-full max-w-sm mt-8 pt-6 border-t border-line">
          <h3 className="text-sm font-semibold text-ink mb-3">Try the demo</h3>
          <div className="space-y-2">
            {ROLES.map(role => (
              <button
                key={role}
                type="button"
                onClick={() => handleDemo(role)}
                disabled={!!demoRole}
                className="w-full text-left px-4 py-3 rounded-lg border border-line hover:border-accent hover:bg-accent-soft transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-sm text-ink">{ROLE_LABELS[role]}</div>
                <div className="text-xs text-ink-3">{DEMO_ROLE_DESCRIPTIONS[role]}</div>
                {demoRole === role && <div className="text-xs text-accent mt-1">Signing in…</div>}
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
