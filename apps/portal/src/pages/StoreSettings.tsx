/**
 * Store settings (corporate). Admins edit; corporate viewers see the same page read-only.
 * Tabs: details & hours · counting (areas, targets, which numbers show) · accuracy checks.
 *
 * Note: Recorder settings are managed in Omni, not here. Foxtail is a frontend-only app.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DAYS, ZONE_TYPE_DEFS, type Day, type OperatingHours, type ZoneType } from '@foxtail/shared';
import { apiDelete, apiPatch, apiPost, apiPut, useApi, type Franchisee, type Store } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo, fmtDuration } from '../lib/format';
import { Card, ErrorNote, Field, Loading, Modal, PageHeader, Pill, Toggle } from '../components/ui';
import ZoneDrawer, { type Point } from '../components/ZoneDrawer';

const TABS = [
  { key: 'details', label: 'Details & hours' },
  { key: 'counting', label: 'Counting' },
  { key: 'accuracy', label: 'Accuracy checks' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText = 'Saved.') => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); return true; } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save' }); return false; } finally { setBusy(false); }
  };
  const note = msg ? <div className={`callout ${msg.ok ? 'callout-ok' : 'callout-bad'}`} role="status">{msg.text}</div> : null;
  return { busy, run, note, setMsg };
}

export default function StoreSettings() {
  const { storeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'details') as Tab;
  const { canManage } = useAuth();
  const store = useApi<{ store: Store }>(`/foxtail/stores/${storeId}`);
  const s = store.data?.store;
  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={<><Link to="/stores" className="hover:underline">Stores</Link> / {s ? <Link to={`/stores/${storeId}`} className="hover:underline">{s.name}</Link> : '…'} / Settings</>}
        title={s ? `${s.name} settings` : 'Store settings'}
        subtitle={canManage ? undefined : 'Read only: only corporate admins can change settings.'}
        actions={<Link to={`/stores/${storeId}`} className="btn-secondary">Dashboard</Link>}
      />
      <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" role="tablist">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
            onClick={() => { const p = new URLSearchParams(params); p.set('tab', t.key); setParams(p, { replace: true }); }}>{t.label}</button>
        ))}
      </div>
      <ErrorNote error={store.error} />
      {!s && !store.error && <Loading />}
      {s && tab === 'details' && <DetailsTab store={s} canManage={canManage} onSaved={store.reload} />}
      {s && tab === 'counting' && <CountingTab storeId={storeId} canManage={canManage} />}
      {s && tab === 'accuracy' && <AccuracyTab storeId={storeId} canManage={canManage} timezone={s.timezone} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------- details

const DAY_LABEL: Record<Day, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const US_TZ = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

function DetailsTab({ store, canManage, onSaved }: { store: Store; canManage: boolean; onSaved: () => void }) {
  const nav = useNavigate();
  const fr = useApi<{ franchisees: Franchisee[] }>('/foxtail/franchisees');
  const [f, setF] = useState({ name: store.name, storeNumber: store.storeNumber ?? '', address: store.address ?? '', city: store.city ?? '', state: store.state ?? '', postalCode: store.postalCode ?? '', timezone: store.timezone, franchiseeId: store.franchiseeId ?? '' });
  const [hours, setHours] = useState<OperatingHours>(store.openingHours);
  const [archiving, setArchiving] = useState(false);
  const { busy, run, note } = useSaver();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const dis = !canManage;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Store">
        <fieldset disabled={dis} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Field label="Store name"><input className="input" value={f.name} onChange={set('name')} /></Field></div>
          <Field label="Store number"><input className="input" value={f.storeNumber} onChange={set('storeNumber')} /></Field>
          <Field label="Franchisee" help="Franchise owners of this franchisee see this store; nobody else outside corporate does.">
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
          <div className="sm:col-span-2">
            <Field label="Time zone" help="'Today', hours of day and opening hours are all in the store's own time zone.">
              <select className="input" value={f.timezone} onChange={set('timezone')}>
                {[...new Set([...US_TZ, f.timezone])].map(t => <option key={t} value={t}>{t.replace('America/', '').replace('Pacific/', '').replace(/_/g, ' ')} ({t})</option>)}
              </select>
            </Field>
          </div>
        </fieldset>
      </Card>
      <Card title="Opening hours" right={<span className="text-xs text-ink-3">Counting only runs while open</span>}>
        <fieldset disabled={dis} className="flex flex-col gap-2">
          {DAYS.map(d => {
            const v = hours[d];
            return (
              <div key={d} className="grid grid-cols-[6.5rem_auto_1fr] items-center gap-3 text-sm">
                <span className="text-ink-2">{DAY_LABEL[d]}</span>
                <Toggle label={`${DAY_LABEL[d]} open`} checked={!!v} disabled={dis} onChange={on => setHours(h => ({ ...h, [d]: on ? { open: '06:00', close: '20:00' } : null }))} />
                {v ? (
                  <span className="flex items-center gap-2">
                    <input type="time" aria-label={`${DAY_LABEL[d]} opens`} className="input !min-h-0 h-9 w-auto" value={v.open} onChange={e => setHours(h => ({ ...h, [d]: { ...v, open: e.target.value } }))} />
                    <span className="text-ink-3 text-xs">to</span>
                    <input type="time" aria-label={`${DAY_LABEL[d]} closes`} className="input !min-h-0 h-9 w-auto" value={v.close} onChange={e => setHours(h => ({ ...h, [d]: { ...v, close: e.target.value } }))} />
                  </span>
                ) : <span className="text-ink-4 text-xs">Closed</span>}
              </div>
            );
          })}
          {canManage && <button type="button" className="btn-ghost btn-sm self-start" onClick={() => { const m = hours.mon; if (m) setHours(Object.fromEntries(DAYS.map(d => [d, { ...m }])) as OperatingHours); }}>Use Monday's hours every day</button>}
        </fieldset>
      </Card>
      {canManage && (
        <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy || !f.name.trim()} onClick={() => run(async () => { await apiPatch(`/foxtail/stores/${store.id}`, { ...f, franchiseeId: f.franchiseeId || null, openingHours: hours }); onSaved(); })}>{busy ? 'Saving…' : 'Save store'}</button>
          {note}
          <div className="flex-1" />
          <button type="button" className="btn-ghost text-bad" onClick={() => setArchiving(true)}>Archive store…</button>
        </div>
      )}
      <Modal title="Archive store" open={archiving} onClose={() => setArchiving(false)} footer={<><button type="button" className="btn-ghost" onClick={() => setArchiving(false)}>Cancel</button><button type="button" className="btn-danger" onClick={async () => { await apiDelete(`/foxtail/stores/${store.id}`); nav('/stores'); }}>Archive</button></>}>
        <p className="text-sm text-ink-2">{store.name} will disappear from every list, report and login, and counting will stop. Its past numbers are kept in the database.</p>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------------------------- counting

interface Camera { id: string; name: string; channel: number; enabled: boolean }
interface ZoneRow { id: string; zoneType: ZoneType; label: string; audience: 'customer' | 'staff'; cameraId: string | null; polygon: Point[] | null; capacity: number | null; staffTargetMin: number | null; staffTargetMax: number | null; enabled: boolean; sortOrder: number }
interface CountingResp {
  overrides: { kpiMetrics: string[] | null; enabledModules: string[] | null; thresholds: Record<string, number> | null; samplingEnabled: boolean; sampleIntervalSeconds: number } | null;
  config: { kpis: string[]; modules: string[]; thresholds: Record<string, number>; samplingEnabled: boolean; sampleIntervalSeconds: number };
  zones: ZoneRow[]; cameras: Camera[];
  sampler: { lastRoundAt: string | null; lastAttemptAt: string | null; lastError: string | null; skipped: string | null } | null;
  detector: { configured: boolean };
  catalog: {
    zoneTypes: Array<{ type: ZoneType; label: string; description: string; defaultAudience: 'customer' | 'staff'; hasCapacity: boolean }>;
    suggestedZones: Array<{ type: ZoneType; label: string; audience: 'customer' | 'staff'; capacity?: number; staffTargetMin?: number; staffTargetMax?: number }>;
    metrics: Array<{ key: string; label: string; description: string }>;
    modules: Array<{ key: string; label: string }>;
    thresholds: Array<{ key: string; label: string; default: number; limits: [number, number] }>;
  };
}

const MAIN_TARGETS = ['waitTargetSeconds', 'queueAlertSize', 'queueAlertMinutes', 'pickupTargetSeconds', 'understaffedMinutes', 'walkawayWindowSeconds'];

function CountingTab({ storeId, canManage }: { storeId: string; canManage: boolean }) {
  const { data, error, reload } = useApi<CountingResp>(`/foxtail/stores/${storeId}/counting`);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [kpis, setKpis] = useState<string[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [thr, setThr] = useState<Record<string, number>>({});
  const [on, setOn] = useState(false);
  const [interval, setIntervalS] = useState(30);
  const [drawing, setDrawing] = useState<number | null>(null);
  const [test, setTest] = useState<{ cameraId: string; result: { ok: boolean; error: string | null; zones: Array<{ label: string; count: number }>; people: unknown[] } | null } | null>(null);
  const zoneSaver = useSaver();
  const profSaver = useSaver();

  useEffect(() => {
    if (!data) return;
    setZones(data.zones);
    setKpis(data.config.kpis);
    setModules(data.config.modules);
    setThr(data.config.thresholds);
    setOn(data.config.samplingEnabled);
    setIntervalS(data.config.sampleIntervalSeconds);
  }, [data]);

  const camName = useMemo(() => new Map((data?.cameras || []).map(c => [c.id, `${c.name} (ch ${c.channel})`])), [data]);
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const dis = !canManage;
  const upd = (i: number, patch: Partial<ZoneRow>) => setZones(zs => zs.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const measurable = zones.filter(z => z.enabled && z.cameraId && z.polygon && z.polygon.length >= 3).length;
  const dz = drawing !== null ? zones[drawing] : null;

  return (
    <div className="space-y-4">
      {!data.detector.configured && <div className="callout callout-warn">Person detection is not configured on this server yet (ROBOFLOW_API_KEY and PERSON_MODEL_ID), so no store will be counted until it is. Areas and targets can still be set up.</div>}
      <Card title="Counting areas" right={<span className="text-xs text-ink-3">{measurable} of {zones.length} ready to count</span>}>
        {data.cameras.length === 0 && <div className="callout callout-info mb-3">This store has no cameras registered yet. Import cameras from EZCloud under Admin → Import cameras.</div>}
        {zones.length === 0 && canManage && (
          <div className="rounded-lg bg-surface-2 p-4 text-sm text-ink-2 mb-3 flex flex-wrap items-center justify-between gap-3">
            <span>Start with the usual Foxtail areas: entrance, register line, ordering spot, behind the counter, pickup, seating.</span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setZones(data.catalog.suggestedZones.map((s, i) => ({ id: '', zoneType: s.type, label: s.label, audience: s.audience, cameraId: null, polygon: null, capacity: s.capacity ?? null, staffTargetMin: s.staffTargetMin ?? null, staffTargetMax: s.staffTargetMax ?? null, enabled: true, sortOrder: i })))}>Add the usual areas</button>
          </div>
        )}
        <div className="overflow-x-auto -mx-4">
          <table className="table">
            <thead><tr><th>Area</th><th>Type</th><th>Who</th><th>Camera</th><th>Drawn</th><th className="num">Seats</th><th className="num">Staff target</th><th /></tr></thead>
            <tbody>
              {zones.map((z, i) => (
                <tr key={z.id || `new-${i}`}>
                  <td><input className="input !min-h-0 h-8 min-w-[10rem]" disabled={dis} value={z.label} onChange={e => upd(i, { label: e.target.value })} aria-label="Area name" /></td>
                  <td>
                    <select className="input !min-h-0 h-8 w-auto" disabled={dis} value={z.zoneType} title={ZONE_TYPE_DEFS[z.zoneType].description} onChange={e => upd(i, { zoneType: e.target.value as ZoneType })} aria-label="Area type">
                      {data.catalog.zoneTypes.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="input !min-h-0 h-8 w-auto" disabled={dis} value={z.audience} onChange={e => upd(i, { audience: e.target.value as 'customer' | 'staff' })} aria-label="Customers or staff">
                      <option value="customer">Customers</option><option value="staff">Staff</option>
                    </select>
                  </td>
                  <td>
                    <select className="input !min-h-0 h-8 w-auto" disabled={dis} value={z.cameraId ?? ''} onChange={e => upd(i, { cameraId: e.target.value || null, polygon: e.target.value === z.cameraId ? z.polygon : null })} aria-label="Camera">
                      <option value="">— pick —</option>
                      {data.cameras.map(c => <option key={c.id} value={c.id}>{c.name} (ch {c.channel})</option>)}
                    </select>
                  </td>
                  <td>
                    {z.polygon && z.polygon.length >= 3 ? <Pill tone="ok">Drawn</Pill> : <Pill tone="neutral">Not drawn</Pill>}
                    {canManage && z.cameraId && <button type="button" className="btn-ghost btn-sm" onClick={() => setDrawing(i)}>{z.polygon ? 'Redraw' : 'Draw'}</button>}
                  </td>
                  <td className="num">{ZONE_TYPE_DEFS[z.zoneType].hasCapacity && z.audience === 'customer'
                    ? <input className="input !min-h-0 h-8 w-20 text-right" disabled={dis} inputMode="numeric" value={z.capacity ?? ''} onChange={e => upd(i, { capacity: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Seats" />
                    : <span className="text-ink-4">—</span>}</td>
                  <td className="num">{z.audience === 'staff'
                    ? <span className="inline-flex items-center gap-1">
                        <input className="input !min-h-0 h-8 w-14 text-right" disabled={dis} inputMode="numeric" value={z.staffTargetMin ?? ''} onChange={e => upd(i, { staffTargetMin: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Minimum staff" />
                        <span className="text-ink-4">–</span>
                        <input className="input !min-h-0 h-8 w-14 text-right" disabled={dis} inputMode="numeric" value={z.staffTargetMax ?? ''} onChange={e => upd(i, { staffTargetMax: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Maximum staff" />
                      </span>
                    : <span className="text-ink-4">—</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    {canManage && <Toggle label={`${z.label} enabled`} checked={z.enabled} onChange={v => upd(i, { enabled: v })} />}
                    {canManage && <button type="button" className="btn-ghost btn-sm text-bad" onClick={() => setZones(zs => zs.filter((_, j) => j !== i))} aria-label={`Remove ${z.label}`}>✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setZones(zs => [...zs, { id: '', zoneType: 'QUEUE', label: 'New area', audience: 'customer', cameraId: data.cameras[0]?.id ?? null, polygon: null, capacity: null, staffTargetMin: null, staffTargetMax: null, enabled: true, sortOrder: zs.length }])}>Add area</button>
            <button type="button" className="btn-primary" disabled={zoneSaver.busy} onClick={() => zoneSaver.run(async () => {
              const r = await apiPut<{ zones: ZoneRow[] }>(`/foxtail/stores/${storeId}/counting/zones`, { zones });
              setZones(r.zones);
            }, 'Areas saved.')}>Save areas</button>
            {data.detector.configured && data.cameras.length > 0 && (
              <select className="input !min-h-0 h-9 w-auto" value="" aria-label="Test counting on a camera" onChange={async e => {
                const cameraId = e.target.value; if (!cameraId) return;
                setTest({ cameraId, result: null });
                try { setTest({ cameraId, result: await apiPost(`/foxtail/stores/${storeId}/counting/test`, { cameraId, zones }) }); }
                catch (err) { setTest({ cameraId, result: { ok: false, error: err instanceof Error ? err.message : 'Test failed', zones: [], people: [] } }); }
              }}>
                <option value="">Test count on a camera…</option>
                {data.cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="mt-3 space-y-2">
          {zoneSaver.note}
          {test && (
            <div className={`callout ${test.result === null ? 'callout-info' : test.result.ok ? 'callout-ok' : 'callout-bad'}`}>
              {test.result === null ? `Counting people on ${camName.get(test.cameraId)}…` : test.result.ok
                ? <>{test.result.people.length} people seen on {camName.get(test.cameraId)}. {test.result.zones.map(z => `${z.label}: ${z.count}`).join(' · ') || 'No areas drawn on this camera.'} <span className="text-ink-3">(Nothing was saved.)</span></>
                : test.result.error}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Counting" right={on ? <Pill tone="ok">On</Pill> : <Pill tone="neutral">Off</Pill>}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm text-ink">Count this store</div><div className="text-xs text-ink-3">During opening hours, one picture per camera every interval. Each picture is a paid detection call.</div></div>
              <Toggle label="Count this store" checked={on} disabled={dis} onChange={setOn} />
            </div>
            <Field label="Seconds between pictures" help={`At ${interval}s, a camera is checked ${Math.round(3600 / Math.max(10, interval))} times an hour. Shorter catches more quick visits but costs more.`}>
              <input className="input w-32" type="number" min={10} max={3600} disabled={dis} value={interval} onChange={e => setIntervalS(Number(e.target.value))} />
            </Field>
            {data.sampler && (
              <div className="text-xs text-ink-3">
                Last count {fmtAgo(data.sampler.lastRoundAt)}{data.sampler.skipped ? ` · ${data.sampler.skipped}` : ''}{data.sampler.lastError ? <span className="text-bad"> · {data.sampler.lastError}</span> : null}
              </div>
            )}
          </div>
        </Card>
        <Card title="Targets">
          <fieldset disabled={dis} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.catalog.thresholds.filter(t => MAIN_TARGETS.includes(t.key)).map(t => (
              <Field key={t.key} label={t.label} help={t.key.endsWith('Seconds') ? fmtDuration(thr[t.key]) : undefined}>
                <input className="input" type="number" min={t.limits[0]} max={t.limits[1]} value={thr[t.key] ?? t.default} onChange={e => setThr(x => ({ ...x, [t.key]: Number(e.target.value) }))} />
              </Field>
            ))}
          </fieldset>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-3 text-xs">More targets</summary>
            <fieldset disabled={dis} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {data.catalog.thresholds.filter(t => !MAIN_TARGETS.includes(t.key)).map(t => (
                <Field key={t.key} label={t.label}>
                  <input className="input" type="number" step={t.key === 'trackMaxDistance' ? 0.01 : 1} min={t.limits[0]} max={t.limits[1]} value={thr[t.key] ?? t.default} onChange={e => setThr(x => ({ ...x, [t.key]: Number(e.target.value) }))} />
                </Field>
              ))}
            </fieldset>
          </details>
        </Card>
        <Card title="Numbers this store shows" right={<span className="text-xs text-ink-3">Up to 6 headline numbers</span>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {data.catalog.metrics.map(m => (
              <label key={m.key} className="flex items-start gap-2 text-sm" title={m.description}>
                <input type="checkbox" className="mt-1" disabled={dis || (!kpis.includes(m.key) && kpis.length >= 6)} checked={kpis.includes(m.key)} onChange={e => setKpis(k => (e.target.checked ? [...k, m.key] : k.filter(x => x !== m.key)))} />
                <span className="text-ink-2">{m.label}</span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Dashboard sections">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {data.catalog.modules.map(m => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={dis || m.key === 'traffic'} checked={modules.includes(m.key)} onChange={e => setModules(k => (e.target.checked ? [...k, m.key] : k.filter(x => x !== m.key)))} />
                <span className="text-ink-2">{m.label}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={profSaver.busy || kpis.length === 0} onClick={() => profSaver.run(async () => {
            const defaults = Object.fromEntries(data.catalog.thresholds.map(t => [t.key, t.default]));
            const changed = Object.fromEntries(Object.entries(thr).filter(([k, v]) => v !== defaults[k]));
            await apiPut(`/foxtail/stores/${storeId}/counting/profile`, { samplingEnabled: on, sampleIntervalSeconds: interval, kpiMetrics: kpis, enabledModules: modules, thresholds: changed });
            reload();
          }, 'Counting settings saved.')}>Save counting settings</button>
          {profSaver.note}
        </div>
      )}
      {dz && dz.cameraId && (
        <ZoneDrawer storeId={storeId} cameraId={dz.cameraId} cameraName={camName.get(dz.cameraId) || 'Camera'} label={dz.label} initial={dz.polygon}
          others={zones.filter((z, j) => j !== drawing && z.cameraId === dz.cameraId && z.polygon).map(z => ({ label: z.label, polygon: z.polygon! }))}
          onClose={() => setDrawing(null)} onSave={p => { upd(drawing!, { polygon: p }); setDrawing(null); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------- accuracy

interface Check { id: string; kind: 'count' | 'wait'; startAt: string; minutes: number; manualValue: number; systemValue: number | null; coveragePct: number | null; errorPct: number | null; errorSeconds: number | null; pass: boolean | null; notes: string }

function AccuracyTab({ storeId, canManage, timezone }: { storeId: string; canManage: boolean; timezone: string }) {
  const { data, error, reload } = useApi<{ targets: { countPct: number; waitSeconds: number }; summary: { count: { n: number; avgError: number | null; passRatePct: number | null }; wait: { n: number; avgError: number | null; passRatePct: number | null } }; checks: Check[] }>(`/foxtail/stores/${storeId}/accuracy`);
  const [f, setF] = useState({ kind: 'count' as 'count' | 'wait', start: '', minutes: '30', manualValue: '', notes: '' });
  const saver = useSaver();
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const row = (label: string, s: { n: number; avgError: number | null; passRatePct: number | null }, unit: string, target: number): ReactNode => (
    <div className="card px-4 py-3"><div className="text-xs text-ink-3">{label}</div><div className="text-lg font-semibold text-ink">{s.n ? `${s.passRatePct}% within target` : 'No checks yet'}</div><div className="text-xs text-ink-4">{s.n ? `${s.n} checks · average error ${s.avgError}${unit} · target ${target}${unit}` : `Target: within ${target}${unit}`}</div></div>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3 max-w-3xl">Someone at the store counts customers coming in (or times waits in line) for a set window, then enters the number here. Foxtail compares it with what the cameras measured for exactly that window. Times are in your browser's time zone; the store is in {timezone}.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {row('Customer counts', data.summary.count, '%', data.targets.countPct)}
        {row('Wait times', data.summary.wait, 's', data.targets.waitSeconds)}
      </div>
      {canManage && (
        <Card title="Add a spot check">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
            <Field label="What was checked"><select className="input" value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value as 'count' | 'wait' }))}><option value="count">Customers entered</option><option value="wait">Average wait (seconds)</option></select></Field>
            <Field label="Started at"><input className="input" type="datetime-local" value={f.start} onChange={e => setF(x => ({ ...x, start: e.target.value }))} /></Field>
            <Field label="Minutes"><input className="input" inputMode="numeric" value={f.minutes} onChange={e => setF(x => ({ ...x, minutes: e.target.value }))} /></Field>
            <Field label={f.kind === 'count' ? 'People counted' : 'Average wait (s)'}><input className="input" inputMode="numeric" value={f.manualValue} onChange={e => setF(x => ({ ...x, manualValue: e.target.value }))} /></Field>
            <button type="button" className="btn-primary" disabled={saver.busy || !f.start || !f.manualValue} onClick={() => saver.run(async () => {
              await apiPost(`/foxtail/stores/${storeId}/accuracy`, { kind: f.kind, startAt: new Date(f.start).toISOString(), minutes: Number(f.minutes), manualValue: Number(f.manualValue), notes: f.notes });
              setF(x => ({ ...x, manualValue: '' })); reload();
            }, 'Check added.')}>Add check</button>
          </div>
          <div className="mt-2">{saver.note}</div>
        </Card>
      )}
      {data.checks.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>When</th><th>What</th><th className="num">Counted</th><th className="num">Measured</th><th className="num">Error</th><th>Result</th>{canManage && <th />}</tr></thead>
            <tbody>
              {data.checks.map(c => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{new Date(c.startAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {c.minutes} min</td>
                  <td>{c.kind === 'count' ? 'Customers entered' : 'Average wait'}</td>
                  <td className="num">{c.kind === 'wait' ? fmtDuration(c.manualValue) : c.manualValue}</td>
                  <td className="num">{c.systemValue === null ? '—' : c.kind === 'wait' ? fmtDuration(c.systemValue) : c.systemValue}{c.coveragePct !== null && c.coveragePct < 80 ? <div className="text-[11px] text-warn">only {c.coveragePct}% of samples</div> : null}</td>
                  <td className="num">{c.kind === 'count' ? (c.errorPct === null ? '—' : `${c.errorPct}%`) : (c.errorSeconds === null ? '—' : `${c.errorSeconds}s`)}</td>
                  <td>{c.pass === null ? <Pill tone="neutral">No camera data</Pill> : c.pass ? <Pill tone="ok">Within target</Pill> : <Pill tone="bad">Outside target</Pill>}</td>
                  {canManage && <td className="text-right"><button type="button" className="btn-ghost btn-sm" onClick={async () => { await apiDelete(`/foxtail/stores/${storeId}/accuracy/${c.id}`); reload(); }}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
