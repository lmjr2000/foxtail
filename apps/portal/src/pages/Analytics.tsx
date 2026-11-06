/**
 * Analytics-only workspace for Foxtail. Numbers and event metadata only —
 * no cameras, live video, clips, snapshots, or camera admin.
 * Reuses existing /api/v1/foxtail/* endpoints; store scope is enforced server-side.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  download,
  useApi,
  type Alert,
  type Overview as OverviewData,
  type OverviewStore,
  type StoreListItem,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo, fmtDuration, fmtNum, fmtPct, storePlace } from '../lib/format';
import { RangeBar, useRange } from '../components/RangeBar';
import { Card, Empty, ErrorNote, Loading, PageHeader, Pill } from '../components/ui';

/** List payload may include `type` from Omni even though the portal Alert type omits it. */
type AnalyticsAlert = Alert & { type?: string; detail?: string | null };

type ReportKey =
  | 'traffic'
  | 'wait'
  | 'walkaways'
  | 'pickup'
  | 'seating'
  | 'coverage'
  | 'flow'
  | 'hours'
  | 'alerts'
  | 'compare'
  | 'quality';

const REPORTS: Array<{ key: ReportKey; label: string; blurb: string }> = [
  { key: 'traffic', label: 'Traffic & occupancy', blurb: 'Customers entered and peak occupancy by store' },
  { key: 'wait', label: 'Line & wait', blurb: 'Average wait, peak line, waits measured' },
  { key: 'walkaways', label: 'Left before service', blurb: 'Likely walkaways vs people who waited' },
  { key: 'pickup', label: 'Pickup wait', blurb: 'From per-store insights when a pickup zone exists' },
  { key: 'seating', label: 'Seating use', blurb: 'Indoor / patio utilization when zones are set' },
  { key: 'coverage', label: 'Counter coverage', blurb: 'Front-counter staffing estimate (no employee IDs)' },
  { key: 'flow', label: 'Customer flow', blurb: 'Entered → line → register → exit score' },
  { key: 'hours', label: 'Opened late / closed early', blurb: 'Hours-compliance alerts (metadata only)' },
  { key: 'alerts', label: 'Wait & line alerts', blurb: 'When wait targets were exceeded' },
  { key: 'compare', label: 'Multi-store compare', blurb: 'Side-by-side ranking for selected stores' },
  { key: 'quality', label: 'Data quality', blurb: 'Which stores are counting, stale, or not set up' },
];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  ok: 'ok', stale: 'warn', no_data: 'warn', off: 'neutral', not_set_up: 'neutral', demo: 'info',
};

function statusWhy(s: OverviewStore): string {
  switch (s.status) {
    case 'not_set_up': return 'Counting zones are not set up yet — this store cannot produce traffic or wait numbers.';
    case 'no_data': return 'No samples in this period. The store may be closed, offline, or not yet counting.';
    case 'stale': return `Last sample ${fmtAgo(s.lastSampleAt)}. Numbers may be incomplete.`;
    case 'off': return 'Sampling is turned off for this store.';
    case 'demo': return 'Demo store — not mixed into live chain totals without a clear Demo badge.';
    case 'ok': return s.lastSampleAt ? `Last sample ${fmtAgo(s.lastSampleAt)}` : 'Counting';
    default: return s.statusText || s.status;
  }
}

function isCounting(s: OverviewStore) {
  return s.status === 'ok' || s.status === 'stale';
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3.5 min-w-0">
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className="text-[26px] leading-tight font-semibold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-4 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const { isCorporate } = useAuth();
  const { range, hours, qs, setRange, setHours } = useRange('7d');
  const storesList = useApi<{ stores: StoreListItem[] }>('/foxtail/stores');
  const overview = useApi<OverviewData>(`/foxtail/overview?${qs}`);
  const alerts = useApi<{ alerts: AnalyticsAlert[] }>(`/foxtail/alerts?status=all&limit=200`);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<ReportKey>('compare');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed selection to healthy stores once overview arrives (exclude empty / not set up).
  useEffect(() => {
    if (seeded || !overview.data) return;
    const healthy = overview.data.stores.filter(s => s.status === 'ok').map(s => s.storeId);
    const fallback = overview.data.stores.map(s => s.storeId);
    setSelected(new Set(healthy.length ? healthy : fallback));
    setSeeded(true);
  }, [overview.data, seeded]);

  const byId = useMemo(() => {
    const m = new Map<string, OverviewStore>();
    overview.data?.stores.forEach(s => m.set(s.storeId, s));
    return m;
  }, [overview.data]);

  const selectedRows = useMemo(
    () => [...selected].map(id => byId.get(id)).filter((s): s is OverviewStore => !!s),
    [selected, byId],
  );

  const countingRows = useMemo(() => selectedRows.filter(isCounting), [selectedRows]);
  const emptyRows = useMemo(() => selectedRows.filter(s => !isCounting(s)), [selectedRows]);

  const totals = useMemo(() => {
    let entered = 0, enteredN = 0, waitSum = 0, waitN = 0, walkaways = 0, walkN = 0, queuers = 0, covSum = 0, covN = 0;
    for (const s of countingRows) {
      if (s.entered !== null) { entered += s.entered; enteredN++; }
      if (s.avgWaitSeconds !== null && s.waitN) { waitSum += s.avgWaitSeconds * s.waitN; waitN += s.waitN; }
      if (s.walkaways !== null) { walkaways += s.walkaways; walkN++; }
      queuers += s.queuers || 0;
      if (s.counterCoveragePct !== null) { covSum += s.counterCoveragePct; covN++; }
    }
    return {
      entered: enteredN ? entered : null,
      avgWait: waitN ? waitSum / waitN : null,
      waitN,
      walkaways: walkN ? walkaways : null,
      queuers,
      coverage: covN ? covSum / covN : null,
      storesCounting: countingRows.length,
      storesSelected: selectedRows.length,
    };
  }, [countingRows, selectedRows.length]);

  const hoursAlerts = useMemo(() => {
    const ids = selected;
    return (alerts.data?.alerts || []).filter(a => {
      const hay = `${a.type || ''} ${a.title || ''}`;
      if (!/BI_OPENED_LATE|BI_CLOSED_EARLY|opened late|closed early/i.test(hay)) return false;
      return ids.has(a.siteId);
    });
  }, [alerts.data, selected]);

  const waitAlerts = useMemo(() => {
    const ids = selected;
    return (alerts.data?.alerts || []).filter(a => {
      const hay = `${a.type || ''} ${a.title || ''}`;
      if (!/BI_WAIT_TIME|BI_LINE_BUILDING|Wait time|line building/i.test(hay)) return false;
      return ids.has(a.siteId);
    });
  }, [alerts.data, selected]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    if (!overview.data) return;
    setSelected(new Set(overview.data.stores.map(s => s.storeId)));
  };

  const selectHealthy = () => {
    if (!overview.data) return;
    setSelected(new Set(overview.data.stores.filter(s => s.status === 'ok').map(s => s.storeId)));
  };

  const clearSelection = () => setSelected(new Set());

  const exportCsv = async () => {
    if (!selected.size) { setErr('Select at least one store to export.'); return; }
    setBusy('csv'); setErr(null);
    try {
      // Prefer the scoped all-stores CSV when every visible store is selected; otherwise loop.
      const allIds = overview.data?.stores.map(s => s.storeId) || [];
      const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
      if (allSelected) {
        await download(`/foxtail/reports/all-stores.csv?${qs}`, 'foxtail-analytics-all-stores.csv');
      } else {
        // Sequential per-store CSVs so Foxtail never sees out-of-scope stores.
        for (const id of selected) {
          const name = (byId.get(id)?.name || id).replace(/[^\w.-]+/g, '_');
          await download(`/foxtail/stores/${id}/report.csv?${qs}`, `foxtail-analytics-${name}.csv`);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const storePicker = (
    <Card title="Locations" right={
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={selectHealthy}>Healthy only</button>
        <button type="button" className="btn-secondary btn-sm" onClick={selectAll}>Select all</button>
        <button type="button" className="btn-secondary btn-sm" onClick={clearSelection}>Clear</button>
      </div>
    } testId="analytics-location-picker">
      {!overview.data && !overview.error ? <Loading label="Loading stores…" /> : null}
      {overview.data && overview.data.stores.length === 0 ? (
        <Empty>{isCorporate ? 'No stores yet.' : 'No stores are assigned to your login yet.'}</Empty>
      ) : null}
      {overview.data && overview.data.stores.length > 0 && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2" role="listbox" aria-label="Stores" aria-multiselectable="true">
          {overview.data.stores.map(s => {
            const on = selected.has(s.storeId);
            return (
              <li key={s.storeId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(s.storeId)}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors min-h-[52px] ${
                    on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 w-4 h-4 rounded border grid place-items-center shrink-0 ${on ? 'bg-accent border-accent text-white' : 'border-line-2 bg-surface'}`}>
                      {on ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink truncate">{s.name}</span>
                      <span className="block text-xs text-ink-4 truncate">{storePlace(s)}</span>
                      <span className="mt-1 inline-flex"><Pill tone={STATUS_TONE[s.status] || 'neutral'}>{s.statusText || s.status}</Pill></span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {storesList.error && <p className="text-xs text-ink-4 mt-2">Store list note: {storesList.error}</p>}
    </Card>
  );

  const emptyBanner = emptyRows.length > 0 && (
    <div className="callout callout-warn" data-testid="analytics-empty-stores">
      <div className="font-semibold text-ink mb-1">{emptyRows.length} selected store{emptyRows.length === 1 ? '' : 's'} with no usable data</div>
      <ul className="text-sm space-y-1">
        {emptyRows.map(s => (
          <li key={s.storeId}><span className="font-medium text-ink">{s.name}</span> — {statusWhy(s)}</li>
        ))}
      </ul>
      <p className="text-xs text-ink-3 mt-2">They stay visible so the gap is clear, but they are not ranked or totalled with counting stores.</p>
    </div>
  );

  const kpiStrip = selectedRows.length > 0 && (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="analytics-kpis">
      <Tile label="Stores selected" value={fmtNum(totals.storesSelected)} sub={`${totals.storesCounting} counting`} />
      <Tile label="Customers entered" value={fmtNum(totals.entered)} sub={overview.data?.range.label} />
      <Tile label="Average wait" value={fmtDuration(totals.avgWait)} sub={totals.waitN ? `${fmtNum(totals.waitN)} waits` : undefined} />
      <Tile label="Left before service" value={fmtNum(totals.walkaways)} sub={totals.queuers ? `of ${fmtNum(totals.queuers)} who waited` : undefined} />
      <Tile label="Counter coverage" value={fmtPct(totals.coverage)} sub="Estimate · no employee IDs" />
    </div>
  );

  const compareTable = (
    <Card title="Selected stores" testId="analytics-compare">
      {selectedRows.length === 0 ? <Empty>Select one or more locations above.</Empty> : (
        <div className="overflow-x-auto -mx-4">
          <table className="table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Status</th>
                <th className="num">Customers</th>
                <th className="num">Avg wait</th>
                <th className="num">Peak line</th>
                <th className="num">Left line</th>
                <th className="num">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {[...selectedRows].sort((a, b) => {
                if (isCounting(a) !== isCounting(b)) return isCounting(a) ? -1 : 1;
                return (b.entered ?? -1) - (a.entered ?? -1);
              }).map(s => (
                <tr key={s.storeId} className={!isCounting(s) ? 'opacity-70' : undefined}>
                  <td>
                    <div className="font-medium text-ink">{s.name}</div>
                    <div className="text-xs text-ink-4">{storePlace(s)}</div>
                  </td>
                  <td><Pill tone={STATUS_TONE[s.status] || 'neutral'}>{s.statusText || s.status}</Pill></td>
                  <td className="num">{isCounting(s) ? fmtNum(s.entered) : '—'}</td>
                  <td className="num">{isCounting(s) ? fmtDuration(s.avgWaitSeconds) : '—'}</td>
                  <td className="num">{isCounting(s) ? fmtNum(s.peakLine) : '—'}</td>
                  <td className="num">{isCounting(s) ? fmtNum(s.walkaways) : '—'}</td>
                  <td className="num">{isCounting(s) ? fmtPct(s.counterCoveragePct) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const qualityPanel = (
    <Card title="Data quality" testId="analytics-quality">
      {selectedRows.length === 0 ? <Empty>Select locations to see coverage.</Empty> : (
        <ul className="divide-y divide-line -mx-4">
          {selectedRows.map(s => (
            <li key={s.storeId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink">{s.name}</div>
                <div className="text-sm text-ink-3 mt-0.5">{statusWhy(s)}</div>
              </div>
              <Pill tone={STATUS_TONE[s.status] || 'neutral'}>{s.statusText || s.status}</Pill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const metricCards = (kind: ReportKey) => (
    <Card title={REPORTS.find(r => r.key === kind)?.label || 'Report'} testId={`analytics-report-${kind}`}>
      {countingRows.length === 0 ? (
        <Empty>
          {selectedRows.length === 0
            ? 'Select one or more locations.'
            : 'None of the selected stores have counting data in this period. See Data quality for why.'}
        </Empty>
      ) : (
        <div className="overflow-x-auto -mx-4">
          <table className="table">
            <thead>
              <tr>
                <th>Store</th>
                {kind === 'traffic' && (<><th className="num">Entered</th><th className="num">vs prior</th></>)}
                {kind === 'wait' && (<><th className="num">Avg wait</th><th className="num">Waits</th><th className="num">Peak line</th><th className="num">Line now</th></>)}
                {kind === 'walkaways' && (<><th className="num">Left line</th><th className="num">Queuers</th></>)}
                {kind === 'coverage' && (<><th className="num">Counter coverage</th></>)}
                {(kind === 'pickup' || kind === 'seating' || kind === 'flow') && (
                  <th>Note</th>
                )}
              </tr>
            </thead>
            <tbody>
              {countingRows.map(s => (
                <tr key={s.storeId}>
                  <td className="font-medium text-ink">{s.name}</td>
                  {kind === 'traffic' && (
                    <>
                      <td className="num">{fmtNum(s.entered)}</td>
                      <td className="num">{s.enteredDeltaPct !== null && Number.isFinite(s.enteredDeltaPct) ? `${s.enteredDeltaPct > 0 ? '+' : ''}${Math.round(s.enteredDeltaPct)}%` : '—'}</td>
                    </>
                  )}
                  {kind === 'wait' && (
                    <>
                      <td className="num">{fmtDuration(s.avgWaitSeconds)}</td>
                      <td className="num">{fmtNum(s.waitN)}</td>
                      <td className="num">{fmtNum(s.peakLine)}</td>
                      <td className="num">{fmtNum(s.lineNow)}</td>
                    </>
                  )}
                  {kind === 'walkaways' && (
                    <>
                      <td className="num">{fmtNum(s.walkaways)}</td>
                      <td className="num">{fmtNum(s.queuers)}</td>
                    </>
                  )}
                  {kind === 'coverage' && (
                    <td className="num">{fmtPct(s.counterCoveragePct)}</td>
                  )}
                  {kind === 'pickup' && (
                    <td className="text-sm text-ink-3">Open the store page for pickup dwell when a dedicated pickup zone exists. Chain overview does not expose pickup as a column yet.</td>
                  )}
                  {kind === 'seating' && (
                    <td className="text-sm text-ink-3">Seating utilization is on each store&apos;s Insights card when seating zones have capacity set.</td>
                  )}
                  {kind === 'flow' && (
                    <td className="text-sm text-ink-3">Customer flow score needs ENTRY → QUEUE → REGISTER zones. Incomplete zone stores show gaps under Data quality.</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const alertList = (rows: AnalyticsAlert[], empty: string, testId: string) => (
    <Card title={REPORTS.find(r => r.key === report)?.label} testId={testId}>
      {rows.length === 0 ? <Empty>{empty}</Empty> : (
        <ul className="divide-y divide-line -mx-4">
          {rows.slice(0, 100).map(a => (
            <li key={a.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink">{a.title || a.type || 'Alert'}</div>
                {a.detail ? <div className="text-sm text-ink-3 mt-0.5">{a.detail}</div> : null}
                <div className="text-xs text-ink-4 mt-1">
                  {[a.storeName, a.type, a.createdAt ? new Date(a.createdAt).toLocaleString() : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Pill tone={a.severity === 'critical' || a.severity === 'high' ? 'bad' : 'warn'}>{a.severity || 'info'}</Pill>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-4 mt-3">Snapshots and camera links are hidden on this page. Open Security if you need video review.</p>
    </Card>
  );

  let body: ReactNode = null;
  switch (report) {
    case 'compare': body = compareTable; break;
    case 'quality': body = qualityPanel; break;
    case 'hours': body = alertList(hoursAlerts, 'No opened-late or closed-early alerts for the selected stores in recent history.', 'analytics-hours'); break;
    case 'alerts': body = alertList(waitAlerts, 'No wait or line alerts for the selected stores in recent history.', 'analytics-alerts'); break;
    default: body = metricCards(report);
  }

  return (
    <div className="space-y-5" data-testid="analytics-page">
      <PageHeader
        title="Analytics"
        subtitle="Numbers only — pick locations, choose a report, export CSV. No live video or camera controls here."
        actions={
          <button type="button" className="btn-primary" disabled={!!busy || selected.size === 0} onClick={() => void exportCsv()} data-testid="analytics-export-csv">
            {busy === 'csv' ? 'Preparing…' : 'Export CSV'}
          </button>
        }
      />
      <RangeBar range={range} hours={hours} setRange={setRange} setHours={setHours} />
      <p className="text-xs text-ink-4 -mt-3">Date windows follow the API (up to 31 days). Longer ranges need daily rollups later.</p>
      <ErrorNote error={err || overview.error || alerts.error} />
      {storePicker}
      {emptyBanner}
      {kpiStrip}
      <Card title="Report" testId="analytics-report-picker">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report type">
          {REPORTS.map(r => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={report === r.key}
              className={`btn-sm ${report === r.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReport(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink-3 mt-3">{REPORTS.find(r => r.key === report)?.blurb}</p>
      </Card>
      {body}
    </div>
  );
}
