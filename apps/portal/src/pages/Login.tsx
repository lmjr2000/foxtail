import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch, apiPost, type SessionUser } from '../lib/api';
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

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [staffForm, setStaffForm] = useState(false);
  const { signIn } = useAuth();

  useEffect(() => { apiFetch<{ googleClientId: string | null; demo?: boolean }>('/auth/config').then(c => { setGoogleId(c.googleClientId); setDemo(!!c.demo); }).catch(() => {}); }, []);

  const enterDemo = async (as: 'corporate' | 'owner') => {
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ token: string; user: SessionUser }>('/auth/demo', { as });
      signIn(r.token, r.user);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open the demo'); } finally { setBusy(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
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
        <div className="w-full max-w-sm">
        <div className="lg:hidden mb-6"><img src="/foxtail-wordmark-black.png" alt="Foxtail Coffee Co." className="h-8 w-auto dark:invert" /></div>
        {demo && (
          <div className="space-y-3 mb-8" data-testid="demo-entry">
            <div>
              <span className="badge badge-accent mb-2">Demo</span>
              <h2 className="text-xl font-bold text-ink">See Foxtail in action</h2>
              <p className="text-sm text-ink-3 mt-1">Example stores with made-up numbers. Pick a view — no password needed.</p>
            </div>
            {error && !staffForm && <div className="callout callout-bad" role="alert">{error}</div>}
            <button type="button" disabled={busy} onClick={() => enterDemo('corporate')} className="w-full text-left card px-4 py-3.5 hover:border-accent hover:shadow-card-hover transition-colors disabled:opacity-50" data-testid="demo-corporate">
              <div className="font-semibold text-ink">Enter as Corporate →</div>
              <div className="text-xs text-ink-3 mt-0.5">CEO, VPs and district managers: every store side by side, rankings, worst hours.</div>
            </button>
            <button type="button" disabled={busy} onClick={() => enterDemo('owner')} className="w-full text-left card px-4 py-3.5 hover:border-accent hover:shadow-card-hover transition-colors disabled:opacity-50" data-testid="demo-owner">
              <div className="font-semibold text-ink">Enter as a Franchise Owner →</div>
              <div className="text-xs text-ink-3 mt-0.5">Only that owner's own stores, with their reports. Other franchisees' stores stay hidden.</div>
            </button>
            {!staffForm && <button type="button" className="text-xs text-ink-4 hover:text-ink-2 underline" onClick={() => setStaffForm(true)}>Staff sign-in</button>}
          </div>
        )}
        {(!demo || staffForm) && (
        <form onSubmit={submit} className="w-full space-y-4" aria-label="Sign in">
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
        )}
        </div>
      </div>
    </div>
  );
}
