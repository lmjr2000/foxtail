/**
 * Corporate overview (every store) and franchise-owner home (their stores). Same page: the server
 * decides which stores are included. Stores that are not counting are listed but never ranked or totalled.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { download, useApi, type Overview as OverviewData, type OverviewStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo, fmtDuration, fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { RangeBar, useRange } from '../components/RangeBar';
import { Card, Delta, Empty, ErrorNote, Loading, PageHeader, Pill } from '../components/ui';

type SortKey = 'name' | 'entered' | 'avgWaitSeconds' | 'peakLine' | 'counterCoveragePct' | 'walkaways' | 'sales' | 'conversionPct';
const COLS: Array<{ key: SortKey; label: string; better: 'higher' | 'lower' | null }> = [
  { key: 'entered', label: 'Customers', better: 'higher' },
  { key: 'avgWaitSeconds', label: 'Avg wait', better: 'lower' },
  { key: 'peakLine', label: 'Longest line', better: 'lower' },
  { key: 'counterCoveragePct', label: 'Counter staffing', better: 'higher' },
  { key: 'walkaways', label: 'Left line', better: 'lower' },
  { key: 'sales', label: 'Sales', better: 'higher' },
  { key: 'conversionPct', label: 'Traffic → sale', better: 'higher' },
];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = { ok: 'ok', stale: 'warn', no_data: 'warn', off: 'neutral', not_set_up: 'neutral', demo: 'info' };

function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="card px-4 py-3.5 min-w-0">
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className="text-[26px] leading-tight font-semibold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-4 mt-0.5">{sub}</div>}
    </div>
  );
}

function cell(s: OverviewStore, k: SortKey): string {
  switch (k) {
    case 'entered': return fmtNum(s.entered);
    case 'avgWaitSeconds': return fmtDuration(s.avgWaitSeconds);
    case 'peakLine': return fmtNum(s.peakLine);
    case 'counterCoveragePct': return fmtPct(s.counterCoveragePct);
    case 'walkaways': return fmtNum(s.walkaways);
    case 'sales': return fmtMoney(s.sales);
    case 'conversionPct': return fmtPct(s.conversionPct);
    default: return s.name;
  }
}

export default function Overview() {
  const { isCorporate } = useAuth();
  const { range, hours, qs, setRange, setHours } = useRange('today');
  const { data, error } = useApi<OverviewData>(`/foxtail/overview?${qs}`, range === 'today' ? 60_000 : 0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'entered', dir: -1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const [autoSwitched, setAutoSwitched] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const counting = (s: OverviewStore) => s.status === 'ok' || s.status === 'stale';
    return [...data.stores].sort((a, b) => {
      if (counting(a) !== counting(b)) return counting(a) ? -1 : 1;
      if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir;
      const va = a[sort.key] as number | null, vb = b[sort.key] as number | null;
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * sort.dir;
    });
  }, [data, sort]);

  const lastSampleAt = useMemo(() => {
    if (!data) return null;
    const times = data.stores.map(s => s.lastSampleAt).filter((t): t is string => !!t);
    if (!times.length) return null;
    return times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  }, [data]);

  const isClosedToday = range === 'today' && data && data.totals.storesCounting === 0 && data.totals.stores > 0;

  useEffect(() => {
    if (isClosedToday && !autoSwitched && lastSampleAt) {
      setAutoSwitched(true);
      setRange('yesterday');
    }
  }, [isClosedToday, autoSwitched, lastSampleAt, setRange]);

  const dl = async (kind: 'pdf' | 'csv') => {
    setBusy(kind); setDlError(null);
    try { await download(`/foxtail/reports/all-stores.${kind}?${qs}`, `foxtail-stores.${kind}`); } catch (e) { setDlError(e instanceof Error ? e.message : 'Download failed'); } finally { setBusy(null); }
  };

  const t = data?.totals;
  const title = isCorporate ? 'All stores' : 'My stores';
  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        subtitle={data ? `${data.range.label} · ${data.hoursLabel} · ${t!.storesCounting} of ${t!.stores} store${t!.stores === 1 ? '' : 's'} counting` : undefined}
        actions={<>
          <button type="button" className="btn-secondary" disabled={!!busy || !data} onClick={() => dl('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'PDF report'}</button>
          <button type="button" className="btn-secondary" disabled={!!busy || !data} onClick={() => dl('csv')}>{busy === 'csv' ? 'Preparing…' : 'CSV'}</button>
        </>}
      />
      <RangeBar range={range} hours={hours} setRange={setRange} setHours={setHours} />
      <ErrorNote error={error || dlError} />
      {!data && !error && <Loading />}
      {data && t && (
        <>
          {t.stores === 0 ? <Empty>{isCorporate ? 'No stores yet. Add the first one under Stores.' : 'No stores are assigned to your login yet. Contact Foxtail corporate.'}</Empty> : (
            <>
              {t.storesCounting === 0 ? (
                <div className="card p-8 text-center">
                  <div className="text-4xl mb-3">{range === 'today' ? '🌙' : '📊'}</div>
                  <h3 className="text-lg font-semibold text-ink mb-2">
                    {range === 'today' ? 'Stores are closed' : 'No counting data'}
                  </h3>
                  <p className="text-sm text-ink-3 max-w-md mx-auto mb-4">
                    {range === 'today' && lastSampleAt
                      ? `All stores are currently closed. Last counted ${fmtAgo(lastSampleAt)}.`
                      : 'None of these stores has counting running in this period.'}
                  </p>
                  {range === 'today' && (
                    <button type="button" onClick={() => setRange('yesterday')} className="btn-secondary">
                      View yesterday
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2">
                  <Tile label="Customers entered" value={fmtNum(t.entered)} sub={t.enteredDeltaPct !== null && Number.isFinite(t.enteredDeltaPct) ? <Delta pct={t.enteredDeltaPct} good={t.enteredDeltaPct === 0 ? null : t.enteredDeltaPct > 0} direction={t.enteredDeltaPct > 0 ? 'up' : t.enteredDeltaPct < 0 ? 'down' : 'flat'} label={data.range.compareLabel} /> : undefined} />
                  <Tile label="Average wait" value={fmtDuration(t.avgWaitSeconds)} sub={t.waitN ? `${fmtNum(t.waitN)} waits measured` : undefined} />
                  <Tile label="Front-counter staffing" value={fmtPct(t.counterCoveragePct)} sub="Average of stores (estimate)" />
                  <Tile label="Left before service" value={fmtNum(t.walkaways)} sub={t.queuers ? `of ${fmtNum(t.queuers)} who waited` : undefined} />
                  <Tile label="Register sales" value={fmtMoney(t.sales)} sub={t.storesWithPos ? `${t.storesWithPos} store${t.storesWithPos === 1 ? '' : 's'} with POS data${t.conversionPct !== null && Number.isFinite(t.conversionPct) ? ` · ${Math.round(t.conversionPct)}% traffic → sale` : ''}` : 'No POS data uploaded'} />
                </div>
              )}

              <Card title="Stores ranked" right={<span className="text-xs text-ink-3">Click a column to rank by it</span>} testId="ranking">
                <div className="overflow-x-auto -mx-4">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="w-8">#</th>
                        <th><button type="button" className="hover:text-ink" onClick={() => setSort(s => ({ key: 'name', dir: s.key === 'name' ? (s.dir === 1 ? -1 : 1) : 1 }))}>Store{sort.key === 'name' ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>
                        {COLS.map(c => (
                          <th key={c.key} className="num">
                            <button type="button" className="hover:text-ink" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : (c.better === 'lower' ? 1 : -1) }))}>
                              {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s, i) => {
                        const counting = s.status === 'ok' || s.status === 'stale';
                        const isDemo = s.status === 'demo';
                        return (
                          <tr key={s.storeId} className={`hover:bg-surface-2 ${isDemo ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                            <td className="text-ink-4 tabular-nums">{counting && !isDemo ? i + 1 : ''}</td>
                            <td className="min-w-[14rem]">
                              <Link to={`/stores/${s.storeId}?${qs}`} className="font-medium text-ink hover:text-accent-ink">{s.name}</Link>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                                {[s.storeNumber ? `#${s.storeNumber}` : null, [s.city, s.state].filter(Boolean).join(', ') || null, isCorporate ? (s.franchiseeName || 'Corporate') : null].filter(Boolean).join(' · ')}
                                {isDemo && <Pill tone="info">DEMO — not real data</Pill>}
                                {s.status !== 'ok' && !isDemo && <Pill tone={STATUS_TONE[s.status]}>{s.statusText}</Pill>}
                              </div>
                            </td>
                            {COLS.map(c => (
                              <td key={c.key} className={`num ${c.key === 'avgWaitSeconds' && s.avgWaitSeconds !== null && s.avgWaitSeconds > s.waitTargetSeconds ? 'text-bad font-medium' : ''} ${c.key === 'counterCoveragePct' && s.counterCoveragePct !== null && s.counterCoveragePct < 70 ? 'text-bad font-medium' : ''}`}>
                                {cell(s, c.key)}
                                {c.key === 'entered' && s.enteredDeltaPct !== null && Number.isFinite(s.enteredDeltaPct) && <div className={`text-[11px] ${s.enteredDeltaPct >= 0 ? 'text-ok' : 'text-bad'}`}>{s.enteredDeltaPct > 0 ? '+' : ''}{s.enteredDeltaPct}%</div>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <Card title="Worst hours" className="lg:col-span-3" right={<span className="text-xs text-ink-3">Waits over target or counter short-staffed</span>} testId="worst-hours">
                  {!data.worstHours || data.worstHours.length === 0 ? <Empty>{t.storesCounting ? 'No hour was over its wait target or short on counter staff.' : 'No counts yet.'}</Empty> : (
                    <div className="overflow-x-auto -mx-4">
                      <table className="table">
                        <thead><tr><th>Store</th><th>Hour</th><th className="num">Avg wait</th><th className="num">Avg line</th><th className="num">Counter</th><th>Why</th></tr></thead>
                        <tbody>
                          {data.worstHours.map(w => (
                            <tr key={`${w.storeId}-${w.hour}`}>
                              <td><Link to={`/stores/${w.storeId}?${qs}`} className="text-ink hover:text-accent-ink">{w.storeName}</Link></td>
                              <td className="whitespace-nowrap">{w.label}{w.days > 1 ? <span className="text-ink-4 text-[11px]"> · {w.days} days</span> : null}</td>
                              <td className={`num ${w.waitAvgSeconds !== null && w.waitAvgSeconds > w.waitTargetSeconds ? 'text-bad font-medium' : ''}`}>{fmtDuration(w.waitAvgSeconds)}</td>
                              <td className="num">{w.lineAvg ?? '—'}</td>
                              <td className={`num ${w.counterCoveragePct !== null && w.counterCoveragePct < 70 ? 'text-bad font-medium' : ''}`}>{fmtPct(w.counterCoveragePct)}</td>
                              <td className="text-xs text-ink-3 min-w-[12rem]">{w.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <Card title="Through the day" className="lg:col-span-2" right={<span className="text-xs text-ink-3">All counting stores</span>} testId="by-hour">
                  {!data.byHour || data.byHour.length === 0 ? <Empty>Hourly breakdown not available.</Empty> : <HourBars hours={data.byHour} />}
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function HourBars({ hours }: { hours: OverviewData['byHour'] }) {
  const max = Math.max(1, ...hours.map(h => h.entered ?? 0));
  return (
    <div className="flex flex-col gap-1.5">
      {hours.map(h => (
        <div key={h.hour} className="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-2 text-xs">
          <span className="text-ink-3">{h.label}</span>
          <div className="h-3 rounded bg-surface-3 overflow-hidden"><div className="h-full rounded bg-accent" style={{ width: `${((h.entered ?? 0) / max) * 100}%` }} /></div>
          <span className="text-right tabular-nums text-ink-2" title="Average wait">{fmtDuration(h.waitAvgSeconds)}</span>
        </div>
      ))}
      <div className="text-[11px] text-ink-4 mt-1">Bars: customers entered. Right: average wait.</div>
    </div>
  );
}
