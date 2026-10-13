/**
 * Store dashboard cards (adapted from Eye of Omni's business-insights cards). Every card reads the
 * computed payload; a card whose areas are not set up says so instead of showing a zero.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Insights, MetricValue } from '../lib/api';
import { fmtDuration } from '../lib/format';
import { Bar, Card, Delta, Empty, EstimateTag, Pill, RawDelta, Stat } from './ui';

interface P { data: Insights; storeId: string; canManage: boolean }

function SetupLink({ storeId, canManage, text }: { storeId: string; canManage: boolean; text: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-6 text-ink-4" title={text || undefined}>
      <span className="text-sm text-ink-3 text-center">{text || 'Not set up'}</span>
      {canManage && <Link to={`/stores/${storeId}/settings?tab=counting`} className="text-xs font-medium text-accent-ink hover:underline">Set up counting</Link>}
    </div>
  );
}

// ------------------------------------------------------------------------------------- KPIs

function KpiTile({ m, compareLabel }: { m: MetricValue; compareLabel: string | null }) {
  const word = m.sub ? /^(Low|Fair|Good) during the rush/.exec(m.sub)?.[1] ?? null : null;
  return (
    <div className="card px-4 py-3.5 flex flex-col gap-1 min-w-0" data-testid={`kpi-${m.key}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] leading-snug text-ink-3 line-clamp-2" title={m.label}>{m.label}</span>
        {m.estimate && <EstimateTag />}
      </div>
      {m.status !== 'ok' ? (
        <>
          <div className="text-2xl font-semibold text-ink-4">—</div>
          <div className="text-[11px] text-ink-4 line-clamp-2" title={m.needs || undefined}>{m.status === 'needs_zones' ? 'Not set up' : 'No data yet'}</div>
        </>
      ) : (
        <>
          <div className="text-[26px] leading-tight font-semibold text-ink tabular-nums">
            {m.display}{word && <span className={`ml-2 text-sm ${word === 'Low' ? 'text-bad' : word === 'Fair' ? 'text-warn' : 'text-ok'}`}>{word}</span>}
          </div>
          <Delta pct={m.deltaPct} good={m.good} direction={m.direction} label={compareLabel} />
          {m.sub && <div className="text-[11px] text-ink-4 truncate" title={m.sub}>{m.sub}</div>}
        </>
      )}
    </div>
  );
}

export function KpiRow({ data }: P) {
  const n = data.kpis.length;
  const cols = n >= 5 ? 'sm:grid-cols-3 xl:grid-cols-5' : n === 4 ? 'lg:grid-cols-4' : n === 3 ? 'sm:grid-cols-3' : '';
  return (
    <div className={`grid grid-cols-2 ${cols} gap-3 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2`} data-testid="kpis">
      {data.kpis.map(m => <KpiTile key={m.key} m={m} compareLabel={data.compare?.label ?? null} />)}
    </div>
  );
}

// ------------------------------------------------------------------------------------- traffic chart

function nice(max: number): number {
  if (max <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line ? <span className="inline-block w-4 h-0.5" style={{ background: color }} /> : <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />}
      {label}
    </span>
  );
}

export function TrafficChart({ data, storeId, canManage }: P) {
  const c = data.chart;
  const [hover, setHover] = useState<number | null>(null);
  const b = c.buckets;
  const show = c.has.entered || c.has.occupancy;
  const W = 720, H = 240, L = 34, R = 40, T = 10, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const lmax = nice(Math.max(1, ...b.flatMap(x => [x.entered ?? 0, x.occupancyAvg ?? 0, x.compareEntered ?? 0])));
  const rmaxMin = nice(Math.max(1, ...b.map(x => (x.waitAvgSeconds ?? 0) / 60)));
  const gw = b.length ? iw / b.length : iw;
  const y = (v: number) => T + ih - (v / lmax) * ih;
  const yr = (sec: number) => T + ih - ((sec / 60) / rmaxMin) * ih;
  const pts = b.map((x, i) => (x.waitAvgSeconds !== null && c.has.wait ? [L + gw * i + gw / 2, yr(x.waitAvgSeconds)] as const : null));
  const segs: Array<Array<readonly [number, number]>> = [];
  let cur: Array<readonly [number, number]> = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const h = hover !== null ? b[hover] : null;
  return (
    <Card title={c.granularity === 'hour' ? 'Customers & wait by hour' : 'Customers & wait by day'} testId="card-traffic">
      {!show ? <SetupLink storeId={storeId} canManage={canManage} text={c.needs || 'No counts in this period'} /> : (
        <div className="relative">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3 mb-1">
            {c.has.entered && <Legend color="var(--c-accent)" label="Customers entered" />}
            {c.has.occupancy && <Legend color="var(--c-ink-4)" label="Average in store" />}
            {c.has.entered && b.some(x => x.compareEntered !== null) && <Legend color="var(--c-ink-3)" label={`Entered, ${data.compare?.label || 'before'}`} line />}
            {c.has.wait && <Legend color="var(--c-rust)" label={`${c.waitLabel} (min)`} line />}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Customers and wait time chart" onMouseLeave={() => setHover(null)}>
            {[0, 0.25, 0.5, 0.75, 1].map(f => (
              <g key={f}>
                <line x1={L} x2={W - R} y1={T + ih - f * ih} y2={T + ih - f * ih} stroke="var(--c-line)" strokeWidth={1} />
                <text x={L - 6} y={T + ih - f * ih + 3} textAnchor="end" fontSize={10} fill="var(--c-ink-4)">{Math.round(lmax * f)}</text>
                {c.has.wait && <text x={W - R + 6} y={T + ih - f * ih + 3} fontSize={10} fill="var(--c-ink-4)">{Math.round(rmaxMin * f * 10) / 10}m</text>}
              </g>
            ))}
            {b.map((x, i) => {
              const gx = L + gw * i, bw = Math.max(2, gw * 0.34);
              return (
                <g key={i}>
                  {hover === i && <rect x={gx} y={T} width={gw} height={ih} fill="var(--c-surface-3)" opacity={0.6} />}
                  {c.has.entered && x.entered !== null && <rect x={gx + gw * 0.14} y={y(x.entered)} width={bw} height={T + ih - y(x.entered)} fill="var(--c-accent)" rx={2} />}
                  {c.has.occupancy && x.occupancyAvg !== null && <rect x={gx + gw * 0.14 + bw + 1} y={y(x.occupancyAvg)} width={bw} height={T + ih - y(x.occupancyAvg)} fill="var(--c-ink-4)" rx={2} />}
                  {x.compareEntered !== null && c.has.entered && <line x1={gx + gw * 0.1} x2={gx + gw * 0.9} y1={y(x.compareEntered)} y2={y(x.compareEntered)} stroke="var(--c-ink-3)" strokeDasharray="3 2" strokeWidth={1.5} />}
                  {(b.length <= 16 || i % 2 === 0) && <text x={gx + gw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--c-ink-4)">{x.label}</text>}
                  <rect x={gx} y={T} width={gw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
            {segs.map((s, i) => <polyline key={i} points={s.map(p => p.join(',')).join(' ')} fill="none" stroke="var(--c-rust)" strokeWidth={2} />)}
            {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="var(--c-rust)" />)}
          </svg>
          {h && (
            <div className="absolute top-6 right-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-card pointer-events-none">
              <div className="font-semibold text-ink">{h.label}</div>
              {c.has.entered && <div>Entered: {h.entered ?? '—'}{h.compareEntered !== null ? ` (was ${h.compareEntered})` : ''}</div>}
              {c.has.occupancy && <div>In store: avg {h.occupancyAvg ?? '—'} · peak {h.occupancyPeak ?? '—'}</div>}
              {c.has.wait && <div>{c.waitLabel}: {fmtDuration(h.waitAvgSeconds)}</div>}
              {h.queueAvg !== null && <div>Line: avg {h.queueAvg} · peak {h.queuePeak ?? '—'}</div>}
              {h.staffAvg !== null && <div>Counter staff seen: {h.staffAvg}</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------- line

export function LineCard({ data, storeId, canManage }: P) {
  const q = data.queue;
  if (!q.available) return <Card title="Line & wait" testId="card-line"><SetupLink storeId={storeId} canManage={canManage} text={q.needs} /></Card>;
  const tone = q.status === 'Long' ? 'bad' : q.status === 'Busy' ? 'warn' : 'ok';
  return (
    <Card title="Line & wait" testId="card-line">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-3">
        <Stat label={data.dataStatus.live ? 'In line now' : 'In line at closing'} value={q.current ?? '—'} extra={q.status && <Pill tone={tone}>{q.status}</Pill>} sub={`Long at ${q.threshold}+`} />
        <Stat label="Average in line" value={q.avg ?? '—'} extra={<RawDelta value={q.avg} compare={q.avgCompare} lowerIsBetter />} />
        <Stat label="Longest line" value={q.peak ?? '—'} sub={q.peakAt ? `at ${q.peakAt}` : undefined} />
        <Stat label="Average wait" value={fmtDuration(q.avgWait)} extra={<RawDelta value={q.avgWait} compare={q.avgWaitCompare} lowerIsBetter />} sub={q.waitN ? `${q.waitN} waits measured` : undefined} />
        <Stat label="Longest wait" value={fmtDuration(q.longestWait)} sub={q.longestAt ? `at ${q.longestAt}` : undefined} />
        <Stat label="Left before service" value={q.walkaways ?? '—'} extra={<RawDelta value={q.walkaways} compare={q.walkawaysCompare} lowerIsBetter />} sub={q.walkawaysNeeds ? 'Needs a register area' : `of ${q.queuers} who waited`} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- staffing

export function StaffingCard({ data, storeId, canManage }: P) {
  const s = data.staffing;
  if (!s.available) return <Card title="Staffing" testId="card-staffing"><SetupLink storeId={storeId} canManage={canManage} text={s.needs} /></Card>;
  return (
    <Card title="Staffing" right={<EstimateTag />} testId="card-staffing">
      <div className="flex flex-col gap-3">
        {s.zones.map(z => {
          const pct = z.current !== null && z.targetMin ? Math.round((z.current / z.targetMin) * 100) : null;
          const tone = z.status === 'understaffed' ? 'bad' : z.status === 'over' ? 'warn' : 'ok';
          return (
            <div key={z.zoneId} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-ink truncate">{z.label}</span>
                <span className="text-ink-2 tabular-nums whitespace-nowrap">{z.current ?? '—'} {data.dataStatus.live ? 'now' : 'at closing'}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1"><Bar pct={pct} tone={tone} /></div>
                <span className="text-[11px] text-ink-4 whitespace-nowrap">{z.targetMin ? `Target ${z.targetMin}${z.targetMax && z.targetMax !== z.targetMin ? `–${z.targetMax}` : ''}` : 'No target'}</span>
              </div>
              <div className="text-[11px] text-ink-4">{z.coveragePct !== null ? `At or above target ${Math.round(z.coveragePct)}% of the time` : z.avg !== null ? `Average ${z.avg}` : 'No counts yet'}</div>
            </div>
          );
        })}
        {s.alert && (
          <div className="rounded-lg border border-bad-line bg-bad-soft px-3 py-2">
            <div className="text-[13px] font-semibold text-bad">{s.alert.title}</div>
            <div className="text-[12px] text-ink-2">{s.alert.timeLabel}{s.alert.detail ? ` — ${s.alert.detail}` : ''}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- pickup

export function PickupCard({ data, storeId, canManage }: P) {
  const p = data.pickup;
  if (!p.available) return <Card title="Pickup" testId="card-pickup"><SetupLink storeId={storeId} canManage={canManage} text={p.needs} /></Card>;
  return (
    <Card title="Pickup" testId="card-pickup">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={data.dataStatus.live ? 'Waiting at pickup now' : 'At pickup at closing'} value={p.current ?? '—'} />
        <Stat label="Average pickup wait" value={fmtDuration(p.avgWait)} sub={`target ${fmtDuration(p.target)}`} />
        <Stat label="Longest pickup wait" value={fmtDuration(p.longest)} />
        <Stat label="Over target" value={p.n ? `${p.overTarget} of ${p.n}` : '—'} />
      </div>
      {p.coveragePct !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-ink-3 mb-1"><span>Pickup staffed at target</span><span>{Math.round(p.coveragePct)}%</span></div>
          <Bar pct={p.coveragePct} tone={p.coveragePct < 70 ? 'bad' : 'ok'} />
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------- seating

export function SeatingCard({ data, storeId, canManage }: P) {
  const u = data.utilization;
  if (!u.available) return <Card title="Seating" testId="card-seating"><SetupLink storeId={storeId} canManage={canManage} text={u.needs} /></Card>;
  const hi = data.config.thresholds.utilizationHighPct ?? 90;
  return (
    <Card title="Seating" testId="card-seating">
      <div className="flex flex-col gap-3">
        {u.zones.map(z => (
          <div key={z.zoneId}>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink truncate">{z.label}</span>
              <span className="text-ink-2 tabular-nums">{z.currentPct !== null ? `${Math.round(z.currentPct)}%` : '—'} <span className="text-ink-4">{z.current ?? '—'}/{z.capacity}</span></span>
            </div>
            <div className="mt-1"><Bar pct={z.avgPct} tone={z.avgPct !== null && z.avgPct >= hi ? 'bad' : 'accent'} /></div>
            <div className="text-[11px] text-ink-4">Average {z.avgPct !== null ? `${Math.round(z.avgPct)}%` : '—'} · peak {z.peakPct !== null ? `${Math.round(z.peakPct)}%` : '—'}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- flow

export function FlowCard({ data, storeId, canManage }: P) {
  const f = data.flow;
  if (!f.stages.some(s => s.count !== null)) return <Card title="Customer flow" testId="card-flow"><SetupLink storeId={storeId} canManage={canManage} text={f.stages[0]?.needs || 'Needs counting areas'} /></Card>;
  const max = Math.max(1, ...f.stages.map(s => s.count ?? 0));
  return (
    <Card title="Customer flow" right={f.score !== null ? <span className="text-xs text-ink-3">Flow score <b className="text-ink">{Math.round(f.score)}</b></span> : undefined} testId="card-flow">
      <div className="flex flex-col gap-2">
        {f.stages.map(s => (
          <div key={s.key} className="min-w-0">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink truncate">{s.label}{s.estimate ? <span className="text-ink-4 text-[11px]"> (est.)</span> : null}</span>
              <span className="text-ink tabular-nums">{s.count ?? '—'} <span className="text-ink-4 text-[11px]">{s.pct !== null ? `${Math.round(s.pct)}%` : ''}</span></span>
            </div>
            {s.count !== null
              ? <div className="mt-1 h-3 rounded bg-surface-3 overflow-hidden"><div className="h-full rounded bg-accent" style={{ width: `${(s.count / max) * 100}%` }} /></div>
              : <div className="mt-1 h-3 rounded bg-surface-3" title={s.needs || undefined} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- moments + insights

const DOT: Record<string, string> = { high: 'bg-bad-fill', medium: 'bg-warn-fill', ok: 'bg-ok-fill', info: 'bg-info-fill' };

export function MomentsCard({ data }: P) {
  const ms = data.keyMoments;
  return (
    <Card title="Key moments" testId="card-moments">
      {ms.length === 0 ? <Empty>{data.dataStatus.hasData ? 'Nothing stood out in this period.' : 'No counts in this period.'}</Empty> : (
        <ol className="flex flex-col gap-3">
          {ms.map((m, i) => (
            <li key={m.id} className="flex gap-3 min-w-0">
              <div className="flex flex-col items-center pt-1">
                <span className={`w-2.5 h-2.5 rounded-full ${DOT[m.severity] || 'bg-info-fill'}`} />
                {i < ms.length - 1 && <span className="flex-1 w-px bg-line mt-1" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-ink-3">{m.timeLabel}</div>
                <div className="text-[13px] font-semibold text-ink">{m.title}</div>
                <div className="text-[12px] text-ink-2">{m.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const TONE: Record<string, string> = { up: 'text-ok', down: 'text-info', bad: 'text-bad', warn: 'text-warn', ok: 'text-ok', info: 'text-info' };

export function InsightsCard({ data }: P) {
  const has = data.insights.length + data.recommendations.length > 0;
  return (
    <Card title="What stood out" testId="card-insights">
      {!has ? <Empty>{data.dataStatus.hasData ? 'No notable patterns in this period.' : 'No counts in this period.'}</Empty> : (
        <div className="flex flex-col gap-2.5">
          {data.insights.map(i => (
            <div key={i.id} className="flex gap-2 text-[13px] text-ink-2" title={i.basis}>
              <span className={`mt-1 w-2 h-2 rounded-full shrink-0 bg-current ${TONE[i.tone] || 'text-info'}`} />
              <span>{i.text}</span>
            </div>
          ))}
          {data.recommendations.map(r => (
            <div key={r.id} className="rounded-lg border border-accent-line bg-accent-soft px-3 py-2" title={r.basis}>
              <div className="text-[12px] font-semibold text-accent-ink">Recommendation</div>
              <div className="text-[13px] text-ink">{r.text}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------------------------- busiest hours

export function HoursCard({ data, className = '' }: P & { className?: string }) {
  const hs = data.hourOfDay;
  if (!hs.length) return null;
  const target = data.config.thresholds.waitTargetSeconds ?? 240;
  return (
    <Card title="By hour of day" className={className} right={<span className="text-xs text-ink-3">{data.range.singleDay ? data.range.label : `${data.range.label}, all days combined`}</span>} testId="card-hours">
      <div className="overflow-x-auto -mx-4">
        <table className="table">
          <thead><tr><th>Hour</th><th className="num">Entered</th><th className="num">Avg wait</th><th className="num">Avg line</th><th className="num">Peak line</th><th className="num">Counter staffing</th></tr></thead>
          <tbody>
            {hs.map(h => (
              <tr key={h.hour}>
                <td>{h.label}</td>
                <td className="num">{h.entered ?? '—'}</td>
                <td className={`num ${h.waitAvgSeconds !== null && h.waitAvgSeconds > target ? 'text-bad font-medium' : ''}`}>{fmtDuration(h.waitAvgSeconds)}</td>
                <td className="num">{h.lineAvg ?? '—'}</td>
                <td className="num">{h.linePeak ?? '—'}</td>
                <td className={`num ${h.counterCoveragePct !== null && h.counterCoveragePct < 70 ? 'text-bad font-medium' : ''}`}>{h.counterCoveragePct !== null ? `${Math.round(h.counterCoveragePct)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
