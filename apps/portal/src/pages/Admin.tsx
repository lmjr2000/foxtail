/** Corporate admin: logins, franchisees and recent activity. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ROLE_LABELS, ROLES, type Role } from '@foxtail/shared';
import { apiDelete, apiPatch, apiPost, useApi, type AdminUser, type Franchisee } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo } from '../lib/format';
import { Card, Empty, ErrorNote, Field, Loading, MobileList, MobileListItem, Modal, PageHeader, Pill } from '../components/ui';

const TABS = [{ key: 'logins', label: 'Logins' }, { key: 'franchisees', label: 'Franchisees' }, { key: 'activity', label: 'Activity' }] as const;

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'logins';
  return (
    <div className="space-y-4">
      <PageHeader title="Admin" subtitle="Who can sign in, which franchisee they belong to, and recent activity." />
      <div className="flex gap-1 border-b border-line" role="tablist">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
            onClick={() => setParams({ tab: t.key }, { replace: true })}>{t.label}</button>
        ))}
      </div>
      {tab === 'logins' && <Logins />}
      {tab === 'franchisees' && <Franchisees />}
      {tab === 'activity' && <Activity />}
    </div>
  );
}

function Logins() {
  const { user: me } = useAuth();
  const users = useApi<{ users: AdminUser[] }>('/foxtail/users');
  const fr = useApi<{ franchisees: Franchisee[] }>('/foxtail/franchisees');
  const [edit, setEdit] = useState<AdminUser | 'new' | null>(null);
  const [setPasswordFor, setSetPasswordFor] = useState<AdminUser | null>(null);
  const frName = new Map((fr.data?.franchisees || []).map(f => [f.id, f.name]));
  return (
    <>
      <div className="flex justify-end"><button type="button" className="btn-primary mobile-full-width" onClick={() => setEdit('new')}>Add login</button></div>
      <ErrorNote error={users.error} />
      {!users.data ? <Loading /> : !users.data.users?.length ? <Empty>No logins yet.</Empty> : (
        <>
          {/* Desktop table */}
          <div className="card overflow-x-auto desktop-table">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Franchisee</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {users.data.users.map(u => (
                  <tr key={u.id} className={u.disabled ? 'opacity-60' : ''}>
                    <td className="text-ink">{u.name || '—'}{u.id === me?.id && <span className="text-ink-4 text-xs"> (you)</span>}</td>
                    <td>{u.email}</td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>{u.franchiseeId ? frName.get(u.franchiseeId) ?? '…' : <span className="text-ink-4">—</span>}</td>
                    <td>{u.disabled ? <Pill tone="neutral">Turned off</Pill> : u.mustChangePassword ? <Pill tone="warn">Password not set</Pill> : fmtAgo(u.lastLoginAt)}</td>
                    <td className="text-right"><button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(u)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Mobile list */}
          <div className="mobile-list">
            <MobileList>
              {users.data.users.map(u => (
                <MobileListItem
                  key={u.id}
                  title={<span className={u.disabled ? 'opacity-60' : ''}>{u.name || u.email}{u.id === me?.id && <span className="text-ink-4 text-[13px]"> (you)</span>}</span>}
                  subtitle={<span className={u.disabled ? 'opacity-60' : ''}>{ROLE_LABELS[u.role]}{u.franchiseeId ? ` · ${frName.get(u.franchiseeId) ?? '…'}` : ''}</span>}
                  badge={u.disabled ? <Pill tone="neutral">Off</Pill> : u.mustChangePassword ? <Pill tone="warn">Password not set</Pill> : undefined}
                  value={!u.disabled && !u.mustChangePassword ? fmtAgo(u.lastLoginAt) : undefined}
                  onClick={() => setEdit(u)}
                  className={u.disabled ? 'opacity-60' : ''}
                />
              ))}
            </MobileList>
          </div>
        </>
      )}
      {edit && <LoginEditor user={edit === 'new' ? null : edit} franchisees={fr.data?.franchisees || []} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); users.reload(); }} onSetPassword={u => { setEdit(null); setSetPasswordFor(u); }} />}
      {setPasswordFor && <SetPasswordModal user={setPasswordFor} onClose={() => setSetPasswordFor(null)} onSaved={() => { setSetPasswordFor(null); users.reload(); }} />}
    </>
  );
}

function LoginEditor({ user, franchisees, onClose, onSaved, onSetPassword }: { user: AdminUser | null; franchisees: Franchisee[]; onClose: () => void; onSaved: () => void; onSetPassword: (u: AdminUser) => void }) {
  const [f, setF] = useState({ email: user?.email ?? '', name: user?.name ?? '', role: (user?.role ?? 'franchise_owner') as Role, franchiseeId: user?.franchiseeId ?? '', disabled: user?.disabled ?? false, password: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); } };
  
  const passwordValid = f.password.length >= 10 && f.password === f.confirmPassword;
  const canSave = user 
    ? true 
    : f.email && passwordValid && (f.role !== 'franchise_owner' || f.franchiseeId);
  
  const save = () => go(async () => {
    const body = { name: f.name, role: f.role, franchiseeId: f.role === 'franchise_owner' ? f.franchiseeId || null : null };
    if (user) { 
      await apiPatch(`/foxtail/users/${user.id}`, { ...body, disabled: f.disabled }); 
      onSaved(); 
    } else { 
      await apiPost('/foxtail/users', { ...body, email: f.email, password: f.password }); 
      onSaved(); 
    }
  });
  
  return (
    <Modal title={user ? `Edit ${user.email}` : 'Add login'} open onClose={onClose}
      footer={<>
        {user && <button type="button" className="btn-ghost mr-auto" disabled={busy} onClick={() => onSetPassword(user)}>Set password</button>}
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy || !canSave} onClick={save}>{busy ? 'Saving…' : user ? 'Save' : 'Create login'}</button>
      </>}>
      <div className="space-y-3">
        <ErrorNote error={err} />
        {!user && <Field label="Email"><input className="input" type="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} autoFocus /></Field>}
        <Field label="Name"><input className="input" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Role" help={f.role === 'franchise_owner' ? 'Sees only the stores of their franchisee, read only, with report downloads.' : f.role === 'corporate_viewer' ? 'Sees every store, read only.' : 'Sees every store and can change all settings and logins.'}>
          <select className="input" value={f.role} onChange={e => setF(x => ({ ...x, role: e.target.value as Role }))}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
        </Field>
        {f.role === 'franchise_owner' && (
          <Field label="Franchisee">
            <select className="input" value={f.franchiseeId} onChange={e => setF(x => ({ ...x, franchiseeId: e.target.value }))}>
              <option value="">— pick —</option>
              {franchisees.map(x => <option key={x.id} value={x.id}>{x.name} ({x.storeCount} store{x.storeCount === 1 ? '' : 's'})</option>)}
            </select>
          </Field>
        )}
        {!user && (
          <>
            <Field label="Password" help="At least 10 characters">
              <input className="input" type="password" value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} autoComplete="new-password" />
            </Field>
            <Field label="Confirm password">
              <input className="input" type="password" value={f.confirmPassword} onChange={e => setF(x => ({ ...x, confirmPassword: e.target.value }))} autoComplete="new-password" />
            </Field>
            {f.password && f.password.length < 10 && <p className="text-xs text-bad">Password must be at least 10 characters.</p>}
            {f.password && f.confirmPassword && f.password !== f.confirmPassword && <p className="text-xs text-bad">Passwords do not match.</p>}
          </>
        )}
        {user && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.disabled} onChange={e => setF(x => ({ ...x, disabled: e.target.checked }))} /> Turn off this login (signs them out everywhere)</label>
        )}
      </div>
    </Modal>
  );
}

function SetPasswordModal({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  
  const valid = password.length >= 10 && password === confirm;
  
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await apiPatch(`/foxtail/users/${user.id}/password`, { password });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not set password'); } 
    finally { setBusy(false); }
  };
  
  return (
    <Modal title={`Set password for ${user.email}`} open onClose={onClose}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy || !valid} onClick={save}>{busy ? 'Saving…' : 'Set password'}</button>
      </>}>
      <div className="space-y-3">
        <ErrorNote error={err} />
        <p className="text-sm text-ink-2">Set a new password for this user. This will sign them out of all active sessions.</p>
        <Field label="New password" help="At least 10 characters">
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        {password && password.length < 10 && <p className="text-xs text-bad">Password must be at least 10 characters.</p>}
        {password && confirm && password !== confirm && <p className="text-xs text-bad">Passwords do not match.</p>}
      </div>
    </Modal>
  );
}

function Franchisees() {
  const fr = useApi<{ franchisees: Franchisee[] }>('/foxtail/franchisees');
  const [edit, setEdit] = useState<Franchisee | 'new' | null>(null);
  return (
    <>
      <div className="flex justify-end"><button type="button" className="btn-primary mobile-full-width" onClick={() => setEdit('new')}>Add franchisee</button></div>
      <ErrorNote error={fr.error} />
      {!fr.data ? <Loading /> : !fr.data.franchisees?.length ? <Empty>No franchisees yet. Add one, then assign stores and franchise-owner logins to it.</Empty> : (
        <>
          {/* Desktop table */}
          <div className="card overflow-x-auto desktop-table">
            <table className="table">
              <thead><tr><th>Franchisee</th><th>Contact</th><th className="num">Stores</th><th className="num">Logins</th><th /></tr></thead>
              <tbody>
                {fr.data.franchisees.map(f => (
                  <tr key={f.id}>
                    <td className="text-ink font-medium">{f.name}</td>
                    <td className="text-ink-3">{[f.contactName, f.contactEmail, f.phone].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num">{f.storeCount}</td><td className="num">{f.loginCount}</td>
                    <td className="text-right"><button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(f)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Mobile list */}
          <div className="mobile-list">
            <MobileList>
              {fr.data.franchisees.map(f => (
                <MobileListItem
                  key={f.id}
                  title={f.name}
                  subtitle={[f.contactName, f.contactEmail].filter(Boolean).join(' · ') || undefined}
                  detail={`${f.storeCount} store${f.storeCount === 1 ? '' : 's'} · ${f.loginCount} login${f.loginCount === 1 ? '' : 's'}`}
                  onClick={() => setEdit(f)}
                />
              ))}
            </MobileList>
          </div>
        </>
      )}
      {edit && <FranchiseeEditor f={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); fr.reload(); }} />}
    </>
  );
}

function FranchiseeEditor({ f, onClose, onSaved }: { f: Franchisee | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: f?.name ?? '', contactName: f?.contactName ?? '', contactEmail: f?.contactEmail ?? '', phone: f?.phone ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); } };
  return (
    <Modal title={f ? `Edit ${f.name}` : 'Add franchisee'} open onClose={onClose}
      footer={<>
        {f && <button type="button" className="btn-ghost text-bad mr-auto" disabled={busy} onClick={() => confirm(`Delete ${f.name}?`) && go(() => apiDelete(`/foxtail/franchisees/${f.id}`))}>Delete</button>}
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy || !v.name.trim()} onClick={() => go(() => (f ? apiPatch(`/foxtail/franchisees/${f.id}`, v) : apiPost('/foxtail/franchisees', v)))}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="space-y-3">
        <ErrorNote error={err} />
        <Field label="Business name"><input className="input" value={v.name} onChange={e => setV(x => ({ ...x, name: e.target.value }))} autoFocus /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Contact name"><input className="input" value={v.contactName} onChange={e => setV(x => ({ ...x, contactName: e.target.value }))} /></Field>
          <Field label="Phone"><input className="input" value={v.phone} onChange={e => setV(x => ({ ...x, phone: e.target.value }))} /></Field>
        </div>
        <Field label="Contact email" help="For your records only; Foxtail does not send email."><input className="input" type="email" value={v.contactEmail} onChange={e => setV(x => ({ ...x, contactEmail: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}

function Activity() {
  const { data, error } = useApi<{ entries: Array<{ at: string; user: string | null; action: string; store: string | null; detail: Record<string, unknown> }> }>('/foxtail/audit?limit=200');
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  return (
    <Card title="Recent activity">
      {data.entries.length === 0 ? <Empty>No changes recorded yet.</Empty> : (
        <>
          {/* Desktop table */}
          <div className="overflow-x-auto -mx-4 desktop-table">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Store</th></tr></thead>
              <tbody>
                {data.entries.map((e, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-ink-3">{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{e.user ?? '—'}</td>
                    <td><code className="text-xs">{e.action}</code></td>
                    <td>{e.store ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Mobile list */}
          <div className="mobile-list -mx-4">
            <MobileList>
              {data.entries.map((e, i) => (
                <MobileListItem
                  key={i}
                  title={<code className="text-[15px] font-normal">{e.action}</code>}
                  subtitle={e.user ?? 'Unknown user'}
                  detail={<>{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{e.store ? ` · ${e.store}` : ''}</>}
                  accessory={null}
                />
              ))}
            </MobileList>
          </div>
        </>
      )}
    </Card>
  );
}
