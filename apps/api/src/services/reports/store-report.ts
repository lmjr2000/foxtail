/**
 * One store's report (PDF and CSV), built from the same payload the store page shows. Only real
 * values: anything not measured is written as "Not set up" / "No data", never as zero.
 */
import type { InsightsResult } from '../counting/compute.js';
import { fmtDuration } from '../counting/time.js';
import type { Store } from '../stores.js';
import { BAD, csvFile, csvRow, Doc, fmtLocal, GOOD, GREY, M, W } from './pdf.js';

export interface StoreReportMeta { store: Store; generatedAt: Date; hoursLabel: string }

const statusText = (m: { status: string; needs: string | null }) => (m.status === 'ok' ? '' : m.needs || m.status);
const where = (s: Store) => [s.storeNumber ? `#${s.storeNumber}` : null, [s.address, s.city, s.state].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ');

export function storeCsv(r: InsightsResult, meta: StoreReportMeta): string {
  const tz = r.timezone;
  const L: string[] = [];
  L.push(csvRow('Foxtail store report'));
  L.push(csvRow('Store', meta.store.name), csvRow('Store number', meta.store.storeNumber ?? ''), csvRow('Address', [meta.store.address, meta.store.city, meta.store.state].filter(Boolean).join(', ')));
  L.push(csvRow('Period', r.range.label, fmtLocal(r.range.start, tz), fmtLocal(r.range.end, tz)), csvRow('Hours', meta.hoursLabel), csvRow('Compared with', r.compare?.label || 'None'));
  L.push(csvRow('Time zone', tz), csvRow('Generated', fmtLocal(meta.generatedAt, tz)));
  L.push(csvRow('Camera sample rounds', r.dataStatus.rounds), csvRow('Counting areas measured', `${r.dataStatus.zonesMeasurable} of ${r.dataStatus.zonesTotal}`));
  if (!r.dataStatus.hasData) L.push(csvRow(r.dataStatus.zonesMeasurable ? 'No counts in this period.' : 'Counting is not set up for this store. No numbers are available.'));
  L.push('');
  L.push(csvRow('Metrics'), csvRow('Metric', 'Value', 'Compare', 'Change %', 'Estimate', 'Detail', 'Status'));
  for (const m of Object.values(r.metrics)) {
    L.push(csvRow(m.label, m.value === null ? '' : m.display, m.compareDisplay ?? '', m.deltaPct ?? '', m.estimate ? 'yes' : '', m.sub ?? '', statusText(m)));
  }
  L.push('');
  L.push(csvRow(r.chart.granularity === 'hour' ? 'By hour' : 'By day'), csvRow('Period', 'Customers entered', 'Entered (compare)', 'Avg in store', 'Peak in store', `${r.chart.waitLabel} (sec)`, 'Avg in line', 'Peak line', 'Avg counter staff', 'Left before service'));
  for (const b of r.chart.buckets) L.push(csvRow(b.label, b.entered ?? '', b.compareEntered ?? '', b.occupancyAvg ?? '', b.occupancyPeak ?? '', b.waitAvgSeconds ?? '', b.queueAvg ?? '', b.queuePeak ?? '', b.staffAvg ?? '', b.walkaways ?? ''));
  L.push('');
  if (r.staffing.available) {
    L.push(csvRow('Staffing by area (estimate: people seen in staff-side areas)'), csvRow('Area', 'Now', 'Average', 'Target min', 'Target max', 'Time at/above target %'));
    for (const z of r.staffing.zones) L.push(csvRow(z.label, z.current ?? '', z.avg ?? '', z.targetMin ?? '', z.targetMax ?? '', z.coveragePct ?? ''));
    L.push('');
  }
  if (r.utilization.available) {
    L.push(csvRow('Seating'), csvRow('Area', 'Seats', 'Average %', 'Peak %'));
    for (const z of r.utilization.zones) L.push(csvRow(z.label, z.capacity, z.avgPct ?? '', z.peakPct ?? ''));
    L.push('');
  }
  L.push(csvRow('Customer flow'), csvRow('Stage', 'Count', '% of first stage', 'Note'));
  for (const s of r.flow.stages) L.push(csvRow(s.label, s.count ?? '', s.pct ?? '', s.needs ?? (s.estimate ? 'estimate' : '')));
  L.push('');
  L.push(csvRow('Key moments'), csvRow('Time', 'What happened', 'Detail'));
  for (const m of r.keyMoments) L.push(csvRow(m.timeLabel, m.title, m.detail));
  if (!r.keyMoments.length) L.push(csvRow('None in this period'));
  L.push('');
  L.push(csvRow('Insights'));
  for (const i of r.insights) L.push(csvRow(i.text, i.basis));
  L.push(csvRow('Recommendations'));
  for (const i of r.recommendations) L.push(csvRow(i.text, i.basis));
  L.push('');
  L.push(csvRow('How these numbers are measured'));
  for (const n of r.notes) L.push(csvRow(n));
  return csvFile(L);
}

/** Hourly (or daily) detail only, one row per bucket — for spreadsheets. */
export function storeHourlyCsv(r: InsightsResult, meta: StoreReportMeta): string {
  const ns = (ok: boolean, v: unknown) => (ok ? (v ?? '') : 'Not set up');
  const L = [
    csvRow('Store', meta.store.name), csvRow('Period', r.range.label), csvRow('Hours', meta.hoursLabel), csvRow('Time zone', r.timezone),
    csvRow(r.chart.granularity === 'hour' ? 'Hour' : 'Day', 'Customers entered', 'Entered (compare)', 'Avg in store', 'Peak in store', 'Avg in line', 'Peak line', 'Avg wait (sec)', 'Left before service', 'Avg counter staff'),
  ];
  for (const b of r.chart.buckets) {
    L.push(csvRow(b.label, ns(r.chart.has.entered, b.entered), ns(r.chart.has.entered, b.compareEntered), ns(r.chart.has.occupancy, b.occupancyAvg), ns(r.chart.has.occupancy, b.occupancyPeak),
      ns(r.queue.available, b.queueAvg), ns(r.queue.available, b.queuePeak), ns(r.chart.has.wait, b.waitAvgSeconds), ns(r.queue.walkaways !== null, b.walkaways), ns(r.staffing.available, b.staffAvg)));
  }
  return csvFile(L);
}

export function storePdf(r: InsightsResult, meta: StoreReportMeta): Buffer {
  const tz = r.timezone;
  const d = new Doc();
  d.banner('Foxtail Coffee Co. · Store report', meta.store.name);
  const w = where(meta.store);
  if (w) { d.p.text(M, d.y, w, 10, false, GREY); d.y -= 14; }
  d.p.text(M, d.y, `${r.range.label} · ${meta.hoursLabel} · ${fmtLocal(r.range.start, tz)} – ${fmtLocal(r.range.end, tz)}`, 10, false, GREY); d.y -= 14;
  d.p.text(M, d.y, `Compared with: ${r.compare?.label || 'none'} · ${r.dataStatus.rounds} camera sample rounds · ${r.dataStatus.zonesMeasurable} of ${r.dataStatus.zonesTotal} areas measured`, 9, false, GREY); d.y -= 6;

  if (!r.dataStatus.hasData) {
    d.section('No numbers for this period');
    d.paragraph(r.dataStatus.zonesMeasurable ? 'Counting is set up, but no camera samples were recorded in this period.' : 'Counting is not set up for this store yet, so there are no numbers to report.');
  }

  // KPI tiles
  d.section('Key numbers');
  const k = r.kpis;
  const cols = Math.min(5, Math.max(1, k.length));
  const tw = (W - 2 * M - (cols - 1) * 8) / cols;
  k.forEach((m, i) => {
    const col = i % cols;
    if (col === 0 && i > 0) d.y -= 66;
    if (col === 0) d.need(62);
    const x = M + col * (tw + 8);
    d.p.rect(x, d.y - 52, tw, 58, [0.95, 0.95, 0.945]);
    d.p.text(x + 6, d.y - 6, m.label, 8, false, GREY);
    d.p.text(x + 6, d.y - 32, m.status === 'ok' ? m.display : '—', m.unit === 'seconds' ? 13 : 16, true);
    const sub = m.status !== 'ok' ? (m.status === 'needs_zones' ? 'Not set up' : 'No data') : m.deltaPct !== null ? `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct}% vs ${r.compare?.label || 'compare'}` : (m.sub || '');
    d.p.text(x + 6, d.y - 46, sub.slice(0, 40), 6.5, false, m.good === false ? BAD : m.good ? GOOD : GREY);
  });
  d.y -= 70;

  // Hourly table
  if (r.dataStatus.hasData) {
    d.section(r.chart.granularity === 'hour' ? 'By hour' : 'By day');
    d.table(
      [{ label: r.chart.granularity === 'hour' ? 'Hour' : 'Day', width: 80 }, { label: 'Entered', width: 70, align: 'right' }, { label: 'Avg wait', width: 80, align: 'right' }, { label: 'Avg line', width: 70, align: 'right' }, { label: 'Peak line', width: 70, align: 'right' }, { label: 'Counter staff', width: 74, align: 'right' }, { label: 'Left line', width: 80, align: 'right' }],
      r.chart.buckets.map(b => [b.label, b.entered === null ? '—' : String(b.entered), fmtDuration(b.waitAvgSeconds), b.queueAvg === null ? '—' : String(b.queueAvg), b.queuePeak === null ? '—' : String(b.queuePeak), b.staffAvg === null ? '—' : String(b.staffAvg), b.walkaways === null || b.walkaways === undefined ? '—' : String(b.walkaways)]),
    );
  }

  d.section('All metrics');
  d.table(
    [{ label: 'Metric', width: 190 }, { label: 'Value', width: 80, align: 'right' }, { label: 'Detail', width: 254 }],
    Object.values(r.metrics).map(m => [m.label + (m.estimate ? ' (estimate)' : ''), { text: m.status === 'ok' ? m.display : '—', bold: true }, { text: m.status === 'ok' ? (m.compareDisplay ? `was ${m.compareDisplay} (${m.deltaPct ?? 0}%)` : (m.sub || '')) : (m.needs || ''), rgb: GREY }]),
  );

  if (r.staffing.available) { d.section('Staffing by area (estimate)'); d.bullets(r.staffing.zones.map(z => `${z.label}: average ${z.avg ?? '—'}, target ${z.targetMin ?? '—'}${z.targetMax ? `–${z.targetMax}` : ''}, at/above target ${z.coveragePct ?? '—'}% of the time`)); }
  if (r.utilization.available) { d.section('Seating'); d.bullets(r.utilization.zones.map(z => `${z.label}: average ${z.avgPct ?? '—'}%, peak ${z.peakPct ?? '—'}% of ${z.capacity} seats`)); }
  if (r.flow.stages.some(s => s.count !== null)) { d.section('Customer flow'); d.bullets(r.flow.stages.map(s => (s.needs ? `${s.label}: not set up` : `${s.label}: ${s.count ?? '—'}${s.pct !== null ? ` (${s.pct}%)` : ''}`))); }
  if (r.keyMoments.length) { d.section('Key moments'); d.bullets(r.keyMoments.map(m => `${m.timeLabel} — ${m.title}. ${m.detail}`)); }
  if (r.insights.length) { d.section('What stood out'); d.bullets(r.insights.map(i => i.text)); }
  if (r.recommendations.length) { d.section('Recommendations'); d.bullets(r.recommendations.map(i => i.text)); }
  d.section('How these numbers are measured');
  d.bullets(r.notes, 8.5);
  d.footer(`Foxtail · ${meta.store.name} · generated ${fmtLocal(meta.generatedAt, tz)} (${tz})`);
  return d.render(`Foxtail store report - ${meta.store.name}`);
}
