/**
 * Every location and its cameras (adapted from Eye of Omni's Live wall and Devices list): online /
 * offline status for every camera, latest pictures, and live video on click. Scoped by the server:
 * a franchise owner only ever gets their own stores here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type Camera, type StoreListItem, type VideoMode } from '../lib/api';
import { useAuth } from '../lib/auth';
import { storePlace } from '../lib/format';
import { CameraModal, CameraTile } from '../components/CameraViews';
import { Empty, ErrorNote, Loading, PageHeader } from '../components/ui';

const GRID: Record<string, string> = { '2': 'grid-cols-1 sm:grid-cols-2', '3': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', '4': 'grid-cols-2 lg:grid-cols-4' };

export default function Cameras() {
  const { isCorporate, canManage, isDemo } = useAuth();
  const [params, setParams] = useSearchParams();
  const stores = useApi<{ stores: StoreListItem[] }>('/foxtail/stores', 60_000);
  const [q, setQ] = useState('');
  const [offlineOnly, setOfflineOnly] = useState(false);
  const selected = params.get('store');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (stores.data?.stores || [])
      .filter(s => !t || [s.name, s.storeNumber, s.city, s.state, s.franchiseeName].some(v => v?.toLowerCase().includes(t)))
      .filter(s => !offlineOnly || s.cameras.offline > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [stores.data, q, offlineOnly]);
  const totals = useMemo(() => (stores.data?.stores || []).reduce((a, s) => ({ cams: a.cams + s.cameras.total, on: a.on + s.cameras.online, off: a.off + s.cameras.offline }), { cams: 0, on: 0, off: 0 }), [stores.data]);

  useEffect(() => {
    if (!selected && list.length) setParams(p => { const n = new URLSearchParams(p); n.set('store', list[0].id); return n; }, { replace: true });
  }, [selected, list, setParams]);

  const current = stores.data?.stores.find(s => s.id === selected) || null;
  const all = stores.data?.stores || [];

  return (
    <div className="space-y-4">
      <PageHeader title="Cameras" subtitle={stores.data ? `${all.length} location${all.length === 1 ? '' : 's'} · ${totals.cams} cameras · ${totals.on} online · ${totals.off} offline` : undefined}
        actions={canManage && !isDemo && <Link to="/admin?tab=import" className="btn-secondary">Import cameras</Link>} />
      <ErrorNote error={stores.error} />
      {!stores.data && !stores.error && <Loading />}
      {stores.data && (all.length === 0 ? (
        <Empty>{canManage && !isDemo ? <>No locations yet. <Link className="text-accent-ink underline" to="/admin?tab=import">Import the EZCloud camera export</Link> to add every store and camera.</> : 'No locations are assigned to your login yet.'}</Empty>
      ) : all.length === 1 ? (
        // One location (e.g. a single-store franchise owner): skip the picker and show its cameras straight away.
        <section className="min-w-0"><StoreCameras store={all[0]} canManage={canManage} /></section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4 items-start">
          <aside className="card overflow-hidden lg:sticky lg:top-4">
            <div className="p-3 border-b border-line space-y-2">
              <input className="input !min-h-0 h-9" placeholder="Search locations" aria-label="Search locations" value={q} onChange={e => setQ(e.target.value)} />
              <label className="flex items-center gap-2 text-xs text-ink-3"><input type="checkbox" checked={offlineOnly} onChange={e => setOfflineOnly(e.target.checked)} /> Only locations with offline cameras</label>
            </div>
            <ul className="max-h-[70vh] overflow-y-auto divide-y divide-line" role="listbox" aria-label="Locations">
              {list.map(s => (
                <li key={s.id}>
                  <button type="button" role="option" aria-selected={s.id === selected} onClick={() => setParams(p => { const n = new URLSearchParams(p); n.set('store', s.id); return n; }, { replace: true })}
                    className={`w-full text-left px-3 py-2.5 hover:bg-surface-2 ${s.id === selected ? 'bg-accent-soft' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${s.id === selected ? 'font-semibold text-ink' : 'text-ink'}`}>{s.name}</span>
                      <span className="text-[11px] whitespace-nowrap">
                        <span className="text-ok">{s.cameras.online}</span>{s.cameras.offline > 0 && <> · <span className="text-bad">{s.cameras.offline}</span></>}<span className="text-ink-4"> / {s.cameras.total}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-4 truncate">{[storePlace(s), isCorporate ? s.franchiseeName : null].filter(Boolean).join(' · ') || ' '}</div>
                  </button>
                </li>
              ))}
              {!list.length && <li className="px-3 py-6 text-center text-xs text-ink-4">No matching locations.</li>}
            </ul>
          </aside>
          <section className="min-w-0">{current ? <StoreCameras store={current} canManage={canManage} /> : <Empty>Pick a location.</Empty>}</section>
        </div>
      ))}
    </div>
  );
}

export function StoreCameras({ store, canManage, compact = false }: { store: Pick<StoreListItem, 'id' | 'name'>; canManage: boolean; compact?: boolean }) {
  const { isDemo } = useAuth();
  const { data, error } = useApi<{ cameras: Camera[]; video: { mode: VideoMode; reason: string | null }; recorderModel: string | null }>(`/foxtail/stores/${store.id}/cameras`, 60_000);
  const [open, setOpen] = useState<Camera | null>(null);
  const [cols, setCols] = useState('3');
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const cams = data.cameras.filter(c => c.enabled);
  const on = cams.filter(c => c.status === 'online').length, off = cams.filter(c => c.status === 'offline').length;
  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink truncate">{store.name}</h2>
            <p className="text-xs text-ink-3">{cams.length} camera{cams.length === 1 ? '' : 's'} · {on} online · {off} offline{data.recorderModel ? ` · recorder ${data.recorderModel}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="seg !h-9" role="group" aria-label="Tiles per row">
              {Object.keys(GRID).map(k => <button key={k} type="button" className={`seg-item !h-7 ${cols === k ? 'seg-item-active' : ''}`} onClick={() => setCols(k)} aria-pressed={cols === k}>{k}</button>)}
            </div>
            <Link to={`/stores/${store.id}`} className="btn-secondary !min-h-0 h-9">Dashboard</Link>
          </div>
        </div>
      )}
      {data.video.mode !== 'live' && (
        <div className="callout callout-info text-sm flex flex-wrap items-center justify-between gap-2">
          <span>{data.video.mode === 'pictures' ? data.video.reason : `Camera status is shown below. ${data.video.reason}`}</span>
          {canManage && !isDemo && data.video.mode === 'none' && <Link to={`/stores/${store.id}/settings?tab=recorder`} className="btn-secondary btn-sm">Connect recorder</Link>}
        </div>
      )}
      {cams.length === 0 ? <Empty>No cameras at this location yet.</Empty> : (
        <div className={`grid ${compact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : GRID[cols]} gap-3`}>
          {cams.map(c => <CameraTile key={c.id} storeId={store.id} camera={c} video={data.video.mode} onOpen={() => setOpen(c)} />)}
        </div>
      )}
      {open && <CameraModal storeId={store.id} storeName={store.name} camera={open} video={data.video.mode} reason={data.video.reason} onClose={() => setOpen(null)} />}
    </div>
  );
}
