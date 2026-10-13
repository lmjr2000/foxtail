import { useState, type FormEvent } from 'react';
import { apiPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/ui';

/** Change password. When `forced`, this is the only thing a user with mustChangePassword=true can do. */
export default function Account({ forced = false }: { forced?: boolean }) {
  const { signOut, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 10) { setMsg({ ok: false, text: 'Password must be at least 10 characters.' }); return; }
    if (next !== again) { setMsg({ ok: false, text: 'The two new passwords do not match.' }); return; }
    setBusy(true); setMsg(null);
    try {
      // Omni returns {ok, token} - store the new token to keep the session valid
      const r = await apiPost<{ ok: boolean; token: string }>('/auth/change-password', { currentPassword: current, newPassword: next });
      if (r.token) {
        // Re-fetch user info with new token, or just update token and mark password changed
        const { setToken } = await import('../lib/api');
        setToken(r.token);
        // Reload user to get updated mustChangePassword=false
        window.location.reload();
      } else {
        setCurrent(''); setNext(''); setAgain('');
        setMsg({ ok: true, text: 'Password changed.' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not change the password' });
    } finally { setBusy(false); }
  };

  const form = (
    <form onSubmit={submit} className="card card-body max-w-md space-y-4">
      {msg && <div className={`callout ${msg.ok ? 'callout-ok' : 'callout-bad'}`} role="status">{msg.text}</div>}
      <label className="block"><span className="input-label">Current password</span>
        <input className="input" type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} />
      </label>
      <label className="block"><span className="input-label">New password</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={e => setNext(e.target.value)} />
        <span className="input-help block">At least 10 characters, with letters and a number.</span>
      </label>
      <label className="block"><span className="input-label">New password again</span>
        <input className="input" type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        {forced && <button type="button" className="btn-ghost" onClick={signOut}>Sign out</button>}
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <img src="/foxtail-wordmark-black.png" alt="Foxtail Coffee Co." className="h-8 w-auto dark:invert" />
          <div><h1 className="text-xl font-bold text-ink">Set your password</h1><p className="text-sm text-ink-3 mt-1">Welcome{user?.name ? `, ${user.name}` : ''}. Please set a new password before continuing.</p></div>
          {form}
        </div>
      </div>
    );
  }
  return <><PageHeader title="Your account" subtitle={user?.email} />{form}</>;
}
