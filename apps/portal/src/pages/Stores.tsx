import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_HOURS, DEFAULT_TIMEZONE } from '@foxtail/shared';
import { apiPost, useApi, type Franchisee, type Store, type StoreListItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo, storePlace } from '../lib/format';
import { Empty, ErrorNote, Field, Loading, Modal, PageHeader, Pill } from '../components/ui';

function countingBadge(s: StoreListItem) {
  if (!s.counting.measurable) return <Pill tone="neutral">Counting not set up</Pill>;
  if (!s.counting.enabled) return <Pill tone="neutral">Counting off</Pill>;
  const fresh = s.counting.lastSampleAt && Date.now() - new Date(s.counting.lastSampleAt).getTime() < 10 * 60_000;
  return fresh ? <Pill tone="ok">Counting</Pill> : <Pill tone="warn" title="Outside opening hours, or the cameras are not answering">Last count {fmtAgo(s.counting.lastSampleAt)}</Pill>;
}

export default function Stores() {
  const { isCorporate, canManage } = useAuth();
  const { data, error, reload } = useApi<{ stores: StoreListItem[] }>('/stores');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.stores || []).filter(s => !t || [s.name, s.storeNumber, s.city, s.state, s.franchiseeName].some(v => v?.toLowerCase().includes(t)));
  }, [data, q]);

  return (
    <div className="space-y-5">
      <PageHeader title="Stores" subtitle={data ? `${data.stores.length} store${data.stores.length === 1 ? '' : 's'}` : undefined}
        actions={canManage && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add store</button>} />
      <ErrorNote error={error} />
      {!data && !error && <Loading />}
      {data && (data.stores.length === 0 ? <Empty>{canManage ? 'No stores yet. Add the first one.' : 'No stores are assigned to your login yet.'}</Empty> : (
        <>
          {data.stores.length > 8 && <input className="input max-w-sm" placeholder="Search stores" aria-label="Search stores" value={q} onChange={e => setQ(e.target.value)} />}
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Store</th><th>Location</th>{isCorporate && <th>Franchisee</th>}<th>Counting</th><th /></tr></thead>
              <tbody>
                {list.map(s => (
                  <tr key={s.id} className="hover:bg-surface-2">
                    <td><Link to={`/stores/${s.id}`} className="font-medium text-ink hover:text-accent-ink">{s.name}</Link></td>
                    <td className="text-ink-3">{storePlace(s) || '—'}</td>
                    {isCorporate && <td className="text-ink-3">{s.franchiseeName || 'Corporate'}</td>}
                    <td>{countingBadge(s)}</td>
                    <td className="text-right whitespace-nowrap">
                      <Link to={`/stores/${s.id}`} className="btn-ghost btn-sm">Dashboard</Link>
                      {isCorporate && <Link to={`/stores/${s.id}/settings`} className="btn-ghost btn-sm">Settings</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
      {adding && <AddStore onClose={() => setAdding(false)} onDone={reload} />}
    </div>
  );
}

function AddStore({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const fr = useApi<{ franchisees: Franchisee[] }>('/franchisees');
  const [f, setF] = useState({ name: '', storeNumber: '', address: '', city: '', state: '', postalCode: '', timezone: DEFAULT_TIMEZONE, franchiseeId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<{ store: Store }>('/stores', { ...f, franchiseeId: f.franchiseeId || null, openingHours: DEFAULT_HOURS });
      onDone();
      nav(`/stores/${r.store.id}/settings`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the store'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add store" open onClose={onClose} footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Adding…' : 'Add store'}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ErrorNote error={err} />
        <div className="sm:col-span-2"><Field label="Store name"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field></div>
        <Field label="Store number"><input className="input" value={f.storeNumber} onChange={set('storeNumber')} /></Field>
        <Field label="Franchisee">
          <select className="input" value={f.franchiseeId} onChange={set('franchiseeId')}>
            <option value="">Corporate-owned</option>
            {fr.data?.franchisees.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="Street address"><input className="input" value={f.address} onChange={set('address')} /></Field></div>
        <Field label="City"><input className="input" value={f.city} onChange={set('city')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State"><input className="input" value={f.state} onChange={set('state')} /></Field>
          <Field label="ZIP"><input className="input" value={f.postalCode} onChange={set('postalCode')} /></Field>
        </div>
        <div className="sm:col-span-2 text-xs text-ink-3">Opening hours start at 6 AM – 8 PM every day; change them, the time zone, the recorder and counting areas on the next screen.</div>
      </div>
    </Modal>
  );
}
