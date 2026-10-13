/**
 * All-stores report (PDF and CSV) from the overview. Scoped like everything else: a franchise owner's
 * "all stores" report only contains their own stores.
 */
import { fmtDuration } from '../counting/time.js';
import type { Overview } from '../overview.js';
import { BAD, csvFile, csvRow, Doc, GREY, M } from './pdf.js';

const money = (v: number | null) => (v === null ? '' : v.toFixed(2));
const moneyText = (v: number | null) => (v === null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v * 10) / 10));

export function allStoresCsv(o: Overview, title: string): string {
  const L: string[] = [];
  L.push(csvRow(title), csvRow('Period', o.range.label), csvRow('Hours', o.hoursLabel), csvRow('Compared with', o.range.compareLabel ?? 'None'), csvRow('Generated (UTC)', o.generatedAt));
  L.push('');
  const t = o.totals;
  L.push(csvRow('Totals (stores that are counting only)'));
  L.push(csvRow('Stores', t.stores), csvRow('Stores counting', t.storesCounting), csvRow('Customers entered', t.entered ?? ''), csvRow('Entered change %', t.enteredDeltaPct ?? ''));
  L.push(csvRow('Average wait (sec)', t.avgWaitSeconds ?? ''), csvRow('Measured waits', t.waitN), csvRow('Left before service', t.walkaways ?? ''), csvRow('Front-counter staffing %', t.counterCoveragePct ?? ''));
  L.push(csvRow('Sales', money(t.sales)), csvRow('Transactions', t.transactions ?? ''), csvRow('Traffic to transaction %', t.conversionPct ?? ''));
  L.push('');
  L.push(csvRow('Stores'), csvRow('Store', 'Store number', 'Franchisee', 'City', 'State', 'Counting status', 'Customers entered', 'Entered change %', 'Avg wait (sec)', 'Measured waits', 'Peak line', 'Front-counter staffing %', 'Left before service', 'Sales', 'Transactions', 'Traffic to transaction %'));
  for (const s of o.stores) {
    L.push(csvRow(s.name, s.storeNumber ?? '', s.franchiseeName ?? 'Corporate', s.city ?? '', s.state ?? '', s.statusText, s.entered ?? '', s.enteredDeltaPct ?? '', s.avgWaitSeconds ?? '', s.waitN, s.peakLine ?? '', s.counterCoveragePct ?? '', s.walkaways ?? '', money(s.sales), s.transactions ?? '', s.conversionPct ?? ''));
  }
  L.push('');
  L.push(csvRow('Worst hours'), csvRow('Store', 'Hour', 'Days', 'Avg wait (sec)', 'Wait target (sec)', 'Measured waits', 'Avg line', 'Peak line', 'Front-counter staffing %', 'Why'));
  for (const w of o.worstHours) L.push(csvRow(w.storeName, w.label, w.days, w.waitAvgSeconds ?? '', w.waitTargetSeconds, w.waitN, w.lineAvg ?? '', w.linePeak ?? '', w.counterCoveragePct ?? '', w.reason));
  if (!o.worstHours.length) L.push(csvRow('None: no hour was over its wait target or short on counter staff.'));
  L.push('');
  L.push(csvRow('By hour of day (all counting stores)'), csvRow('Hour', 'Stores', 'Customers entered', 'Avg wait (sec)', 'Avg line', 'Front-counter staffing %'));
  for (const h of o.byHour) L.push(csvRow(h.label, h.stores, h.entered ?? '', h.waitAvgSeconds ?? '', h.lineAvg ?? '', h.counterCoveragePct ?? ''));
  return csvFile(L);
}

export function allStoresPdf(o: Overview, title: string): Buffer {
  const d = new Doc();
  d.banner(`Foxtail Coffee Co. · ${title}`, `${o.range.label} · ${o.hoursLabel}`);
  const t = o.totals;
  d.p.text(M, d.y, `${t.stores} store${t.stores === 1 ? '' : 's'}, ${t.storesCounting} counting. Stores that are not counting are listed but left out of every total.`, 9.5, false, GREY);
  d.y -= 8;

  d.section('Totals');
  d.table(
    [{ label: 'Customers entered', width: 105, align: 'right' }, { label: 'Avg wait', width: 80, align: 'right' }, { label: 'Left line', width: 70, align: 'right' }, { label: 'Counter staffing', width: 95, align: 'right' }, { label: 'Sales', width: 85, align: 'right' }, { label: 'Traffic→sale', width: 89, align: 'right' }],
    [[n(t.entered) + (t.enteredDeltaPct !== null ? ` (${t.enteredDeltaPct > 0 ? '+' : ''}${t.enteredDeltaPct}%)` : ''), fmtDuration(t.avgWaitSeconds), n(t.walkaways), t.counterCoveragePct === null ? '—' : `${Math.round(t.counterCoveragePct)}%`, moneyText(t.sales), t.conversionPct === null ? '—' : `${t.conversionPct}%`]],
    9,
  );

  d.section('Stores');
  d.table(
    [{ label: 'Store', width: 150 }, { label: 'Status', width: 92 }, { label: 'Entered', width: 56, align: 'right' }, { label: 'Avg wait', width: 58, align: 'right' }, { label: 'Peak line', width: 52, align: 'right' }, { label: 'Counter', width: 52, align: 'right' }, { label: 'Sales', width: 64, align: 'right' }],
    o.stores.map(s => [
      s.name + (s.storeNumber ? ` #${s.storeNumber}` : ''),
      { text: s.statusText, rgb: s.status === 'ok' ? GREY : BAD },
      n(s.entered),
      { text: fmtDuration(s.avgWaitSeconds), rgb: s.avgWaitSeconds !== null && s.avgWaitSeconds > s.waitTargetSeconds ? BAD : undefined },
      n(s.peakLine),
      s.counterCoveragePct === null ? '—' : `${Math.round(s.counterCoveragePct)}%`,
      moneyText(s.sales),
    ]),
  );

  d.section('Worst hours');
  if (!o.worstHours.length) d.paragraph('No hour was over its wait target or short on counter staff in this period.');
  else d.table(
    [{ label: 'Store', width: 150 }, { label: 'Hour', width: 50 }, { label: 'Avg wait', width: 58, align: 'right' }, { label: 'Avg line', width: 52, align: 'right' }, { label: 'Counter', width: 52, align: 'right' }, { label: 'Why', width: 162 }],
    o.worstHours.map(w => [w.storeName, w.label, fmtDuration(w.waitAvgSeconds), n(w.lineAvg), w.counterCoveragePct === null ? '—' : `${Math.round(w.counterCoveragePct)}%`, { text: w.reason, rgb: GREY }]),
  );

  if (o.byHour.length) {
    d.section('By hour of day (all counting stores)');
    d.table(
      [{ label: 'Hour', width: 70 }, { label: 'Stores', width: 60, align: 'right' }, { label: 'Entered', width: 90, align: 'right' }, { label: 'Avg wait', width: 90, align: 'right' }, { label: 'Avg line', width: 90, align: 'right' }, { label: 'Counter staffing', width: 124, align: 'right' }],
      o.byHour.map(h => [h.label, String(h.stores), n(h.entered), fmtDuration(h.waitAvgSeconds), n(h.lineAvg), h.counterCoveragePct === null ? '—' : `${Math.round(h.counterCoveragePct)}%`]),
    );
  }
  d.section('How these numbers are measured');
  d.bullets([
    'Counts come from person detection on periodic camera snapshots, assigned to the counting areas drawn on each store camera.',
    'Average wait is weighted by the number of measured waits at each store. Staffing is an estimate (people seen behind the counter), not employee identification.',
    'Traffic to transaction % only uses hours where a store has both camera counts and uploaded register data.',
  ], 8.5);
  d.footer(`Foxtail · ${title} · generated ${new Date(o.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  return d.render(`Foxtail - ${title}`);
}
