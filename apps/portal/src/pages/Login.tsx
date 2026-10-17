import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ROLE_LABELS, type Role } from '@foxtail/shared';
import { ApiError, apiFetch, apiPost, type SessionUser } from '../lib/api';
import { useAuth } from '../lib/auth';

declare global {
  interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } } }
}

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

const DEMO_ROLES: Array<{ role: Role; icon: string; description: string }> = [
  { role: 'corporate_admin', icon: '👔', description: 'Full access to all stores and settings' },
  { role: 'corporate_viewer', icon: '📊', description: 'Read-only access to all stores' },
  { role: 'franchise_owner', icon: '☕', description: 'Access to owned franchise stores only' },
];

const isPreview = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export default function Login() {
  const { login, demoLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

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
    <div className="min-h-screen flex flex-col bg-page">
      {isPreview && (
        <div className="bg-amber-500 text-black text-center py-2 px-4 text-sm font-semibold safe-top">
          ⚠️ PREVIEW — SAMPLE DATA ONLY
        </div>
      )}

      {/* Desktop: Two-column layout */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-2">
        {/* Left: Brand hero (desktop only) */}
        <div className="hidden lg:flex flex-col justify-between bg-brand p-12 text-white">
          <img src="/foxtail-wordmark-white.png" alt="Foxtail Coffee Co." className="h-10 w-auto self-start" />
          <div className="max-w-lg">
            <p className="text-accent-ink text-sm font-semibold uppercase tracking-wider mb-4">Store Performance</p>
            <h1 className="font-display text-5xl font-extrabold leading-[1.1] text-white mb-6">
              Every store's rush, line and staffing — in numbers.
            </h1>
            <p className="text-lg text-white/70 leading-relaxed">
              Customer traffic, wait times and counter coverage from the cameras already in every Foxtail Coffee Co. store, side by side with register sales.
            </p>
          </div>
          <p className="text-sm text-white/40">Counts only. No recordings are kept and no one is identified.</p>
        </div>

        {/* Right: Main content */}
        <div className="flex-1 flex flex-col safe-top safe-bottom">
          {/* Mobile header with logo */}
          <div className="lg:hidden px-6 pt-8 pb-4">
            <img src="/foxtail-wordmark-black.png" alt="Foxtail Coffee Co." className="h-10 w-auto mx-auto dark:invert" />
          </div>

          {/* Mobile hero text */}
          <div className="lg:hidden px-6 py-4 text-center">
            <h1 className="text-2xl font-bold text-ink mb-2">Store Performance</h1>
            <p className="text-sm text-ink-3">Customer traffic, wait times and staffing metrics at a glance</p>
          </div>

          {/* Main content area */}
          <div className="flex-1 flex flex-col justify-center px-6 py-8 lg:px-12 lg:py-12">
            <div className="w-full max-w-md mx-auto space-y-8">
              {error && <div className="callout callout-bad" role="alert">{error}</div>}

              {/* Demo section - Primary on mobile */}
              <div className="space-y-4">
                <div className="text-center lg:text-left">
                  <h2 className="text-xl font-bold text-ink">Try the demo</h2>
                  <p className="text-[11px] text-ink-4" data-testid="usage-notice-demo">Usage is recorded to improve the service.</p>
                  <p className="text-sm text-ink-3 mt-1">Tap a role to explore the dashboard</p>
                </div>
                <div className="space-y-3">
                  {DEMO_ROLES.map(({ role, icon, description }) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleDemo(role)}
                      disabled={!!demoRole}
                      className="demo-card w-full text-left px-5 py-4 rounded-xl border-2 border-line bg-surface hover:border-accent hover:shadow-card-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100"
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-3xl" role="img" aria-hidden="true">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-base text-ink">{ROLE_LABELS[role]}</div>
                          <div className="text-sm text-ink-3 mt-0.5">{description}</div>
                        </div>
                        {demoRole === role ? (
                          <div className="text-accent text-sm font-medium">Signing in…</div>
                        ) : (
                          <svg className="w-5 h-5 text-ink-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-line" /></div>
                <div className="relative flex justify-center">
                  <span className="px-4 text-sm text-ink-4 bg-page">or</span>
                </div>
              </div>

              {/* Sign in section - Collapsible on mobile */}
              {!showSignIn ? (
                <button
                  type="button"
                  onClick={() => setShowSignIn(true)}
                  className="w-full py-4 text-center text-sm font-medium text-ink-2 hover:text-ink border border-line rounded-xl hover:border-line-2 transition-colors lg:hidden"
                >
                  Sign in with email
                </button>
              ) : null}

              <form onSubmit={submit} className={`space-y-4 ${showSignIn ? '' : 'hidden lg:block'}`} aria-label="Sign in">
                <div className="lg:hidden text-center">
                  <h2 className="text-lg font-semibold text-ink">Sign in</h2>
                  <p className="text-sm text-ink-3 mt-1">Use your Foxtail login email</p>
                </div>
                <div className="hidden lg:block">
                  <h2 className="text-lg font-semibold text-ink">Sign in</h2>
                  <p className="text-sm text-ink-3 mt-1">Use the email your Foxtail login was created with</p>
                </div>
                <label className="block">
                  <span className="input-label">Email</span>
                  <input className="input h-12" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
                </label>
                <label className="block">
                  <span className="input-label">Password</span>
                  <input className="input h-12" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
                </label>
                <button className="btn-primary w-full h-12 text-base" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
                {googleId && (
                  <>
                    <div className="text-center text-xs text-ink-4">or continue with</div>
                    <GoogleButton clientId={googleId} onError={setError} />
                  </>
                )}
                <p className="text-xs text-ink-4 text-center">Forgot your password? Ask a Foxtail corporate admin to reset it.</p>
                <p className="text-[11px] text-ink-4 text-center" data-testid="usage-notice">Usage is recorded to improve the service.</p>
              </form>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 text-center text-xs text-ink-4 lg:hidden">
            Foxtail Coffee Co. · counts only, no recordings
          </div>
        </div>
      </div>
    </div>
  );
}
