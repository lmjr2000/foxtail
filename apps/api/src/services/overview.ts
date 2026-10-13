/**
 * Corporate overview / franchise-owner home: every store in the login's scope for one period, with
 * totals, a ranking and the worst hours. Built from the same per-store engine as the store page.
 *
 * A store that is not counting is listed with its status and left OUT of every total and ranking;
 * it never contributes a zero. Totals only add up stores that actually measured something.
 */
import { isZoneMeasurable } from '@foxtail/shared';
import type { AuthContext } from '../middleware/auth.js';
import { listScopedStores, type Store } from './stores.js';
import * as countingStore from './counting/store.js';
import { storeInsights, parseRange, RANGE_HELP } from './counting/insights.js';
import { listPosForStores } from './counting/pos.js';
import type { InsightsResult } from './counting/compute.js';

export type CountingStatus = 'not_set_up' | 'off' | 'no_data' | 'stale' | 'ok';

export const STATUS_TEXT: Record<CountingStatus, string> = {
  not_set_up: 'Counting not set up',
  off: 'Counting turned off',
  no_data: 'No counts in this period',
  stale: 'Counting, but no recent camera samples',
  ok: 'Counting',
};

export interface StoreRow {
  storeId: string; name: string; storeNumber: string | null; city: string | null; state: string | null;
  franchiseeName: string | null; timezone: string;
  status: CountingStatus; statusText: string; lastSampleAt: string | null;
  entered: number | null; enteredCompare: number | null; enteredDeltaPct: number | null;
  avgWaitSeconds: number | null; waitN: number; waitTargetSeconds: number;
  peakLine: number | null; peakLineAt: string | null; lineNow: number | null;
  counterCoveragePct: number | null; walkaways: number | null; queuers: number;
  sales: number | null; transactions: number | null; conversionPct: number | null; matchedHours: number;
}

export interface WorstHour {
  storeId: string; storeName: string; hour: number; label: string; days: number;
  waitAvgSeconds: number | null; waitN: number; waitTargetSeconds: number; lineAvg: number | null; linePeak: number | null;
  counterCoveragePct: number | null; entered: number | null; reason: string;
}

export interface ChainHour { hour: number; label: string; stores: number; entered: number | null; waitAvgSeconds: number | null; waitN: number; lineAvg: number | null; counterCoveragePct: number | null }

export interface Overview {
  range: { key: string; label: string; compareLabel: string | null };
  hoursLabel: string;
  generatedAt: string;
  totals: {
    stores: number; storesCounting: number; entered: number | null; enteredCompare: number | null; enteredDeltaPct: number | null;
    avgWaitSeconds: number | null; waitN: number; walkaways: number | null; queuers: number; counterCoveragePct: number | null;
    sales: number | null; transactions: number | null; conversionPct: number | null; storesWithPos: number;
  };
  stores: StoreRow[];
  worstHours: WorstHour[];
  byHour: ChainHour[];
}

const isCounting = (s: CountingStatus) => s === 'ok' || s === 'stale';
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function statusOf(res: InsightsResult): CountingStatus {
  if (res.dataStatus.zonesMeasurable === 0) return 'not_set_up';
  if (!res.dataStatus.samplingEnabled && !res.dataStatus.hasData) return 'off';
  if (!res.dataStatus.hasData) return 'no_data';
  // Today, counting on, but nothing new for a few rounds: the numbers so far are real, but say so.
  if (res.dataStatus.samplingEnabled && new Date(res.range.end).getTime() > Date.now() - 120_000 && !res.dataStatus.fresh) return 'stale';
  return 'ok';
}

function rowFor(store: Store, res: InsightsResult, waitTarget: number, posRows: Array<{ hourAt: Date; sales: number | null; transactions: number | null }>): StoreRow {
  const status = statusOf(res);
  const counting = isCounting(status);
  const entered = res.metrics.customersEntered;
  const cov = res.metrics.counterCoverage;
  // POS: totals over the whole period; conversion only over hours that have both traffic and transactions.
  const traffic = new Map(res.enteredByHour.map(h => [new Date(h.hourAt).getTime(), h.entered]));
  let pe = 0, pt = 0, matched = 0;
  for (const p of posRows) {
    const e = traffic.get(p.hourAt.getTime());
    if (e !== undefined && p.transactions !== null) { pe += e; pt += p.transactions; matched++; }
  }
  const salesVals = posRows.map(p => p.sales).filter((x): x is number => x !== null);
  const txVals = posRows.map(p => p.transactions).filter((x): x is number => x !== null);
  const waits = res.queue.waitN;
  return {
    storeId: store.id, name: store.name, storeNumber: store.storeNumber, city: store.city, state: store.state,
    franchiseeName: store.franchiseeName, timezone: store.timezone,
    status, statusText: STATUS_TEXT[status], lastSampleAt: res.dataStatus.lastRoundAt,
    entered: counting && entered?.status === 'ok' ? entered.value : null,
    enteredCompare: counting && entered?.status === 'ok' ? entered.compare : null,
    enteredDeltaPct: counting && entered?.status === 'ok' ? entered.deltaPct : null,
    avgWaitSeconds: counting && res.queue.available ? res.queue.avgWait : null, waitN: counting ? waits : 0, waitTargetSeconds: waitTarget,
    peakLine: counting && res.queue.available ? res.queue.peak : null, peakLineAt: counting ? res.queue.peakAt : null,
    lineNow: counting && res.queue.available ? res.queue.current : null,
    counterCoveragePct: counting && cov?.status === 'ok' ? cov.value : null,
    walkaways: counting ? res.queue.walkaways : null, queuers: counting ? res.queue.queuers : 0,
    sales: salesVals.length ? r2(salesVals.reduce((a, b) => a + b, 0)) : null,
    transactions: txVals.length ? txVals.reduce((a, b) => a + b, 0) : null,
    conversionPct: matched && pe > 0 ? r1((pt / pe) * 100) : null, matchedHours: matched,
  };
}

export async function buildOverview(auth: AuthContext, rangeRaw: unknown, hoursRaw: unknown, now = new Date()): Promise<Overview | { error: string }> {
  const stores = await listScopedStores(auth);
  const [cfgs, zones] = await Promise.all([countingStore.loadConfigs(stores), countingStore.getZonesForStores(stores.map(s => s.id))]);
  const results: Array<{ store: Store; res: InsightsResult; waitTarget: number }> = [];
  let rangeInfo: Overview['range'] | null = null;
  let hoursText = 'Opening hours';
  // Stores can be in different timezones: each store's "today" is its own local day.
  const posByStore = new Map<string, Array<{ hourAt: Date; sales: number | null; transactions: number | null }>>();
  for (const store of stores) {
    const out = await storeInsights(store, rangeRaw, hoursRaw, now, { cfg: cfgs.get(store.id)!, zones: zones.get(store.id) || [] });
    if ('error' in out) return out;
    rangeInfo ??= { key: out.range.key, label: out.range.label, compareLabel: out.range.compare?.label ?? null };
    hoursText = out.hours.mode === 'open' ? 'Opening hours' : out.hours.mode === 'all' ? 'All hours' : hoursText;
    const pos = await listPosForStores([store.id], out.range.start, out.range.end);
    posByStore.set(store.id, pos.get(store.id) || []);
    results.push({ store, res: out.result, waitTarget: out.cfg.thresholds.waitTargetSeconds });
  }
  if (!rangeInfo) {
    const r = parseRange(rangeRaw, 'America/New_York', now);
    if (!r) return { error: RANGE_HELP };
    rangeInfo = { key: r.key, label: r.label, compareLabel: r.compare?.label ?? null };
  }

  const rows = results.map(({ store, res, waitTarget }) => rowFor(store, res, waitTarget, posByStore.get(store.id) || []));

  // Totals: only stores that measured something. Waits are weighted by the number of measured waits.
  const counting = rows.filter(r => isCounting(r.status));
  const sumOrNull = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const entered = sumOrNull(counting.map(r => r.entered));
  const enteredCompare = sumOrNull(counting.filter(r => r.entered !== null && r.enteredCompare !== null).map(r => r.enteredCompare));
  const enteredBase = sumOrNull(counting.filter(r => r.entered !== null && r.enteredCompare !== null).map(r => r.entered));
  const waitN = counting.reduce((a, r) => a + (r.avgWaitSeconds !== null ? r.waitN : 0), 0);
  const waitWeighted = counting.reduce((a, r) => a + (r.avgWaitSeconds !== null ? r.avgWaitSeconds * r.waitN : 0), 0);
  const covs = counting.map(r => r.counterCoveragePct).filter((x): x is number => x !== null);
  const withPos = rows.filter(r => r.transactions !== null || r.sales !== null);
  // Chain conversion = matched transactions / matched traffic, recomputed from each store's matched hours.
  let mE = 0, mT = 0;
  for (const { store, res } of results) {
    const traffic = new Map(res.enteredByHour.map(h => [new Date(h.hourAt).getTime(), h.entered]));
    for (const p of posByStore.get(store.id) || []) {
      const e = traffic.get(p.hourAt.getTime());
      if (e !== undefined && p.transactions !== null) { mE += e; mT += p.transactions; }
    }
  }

  // Worst hours: store-hours where the line wait was furthest over target (at least 3 measured waits),
  // else the longest average line. Each row says why it is on the list.
  const worst: WorstHour[] = [];
  for (const { store, res, waitTarget } of results) {
    if (!isCounting(statusOf(res))) continue;
    for (const h of res.hourOfDay) {
      const overWait = h.waitAvgSeconds !== null && h.waitN >= 3 && h.waitAvgSeconds > waitTarget;
      const understaffed = h.counterCoveragePct !== null && h.counterCoveragePct < 70 && (h.entered ?? 0) > 0;
      if (!overWait && !understaffed) continue;
      const reasons: string[] = [];
      if (overWait) reasons.push(`average wait ${Math.round(h.waitAvgSeconds! / 6) / 10} min vs ${Math.round(waitTarget / 6) / 10} min target`);
      if (understaffed) reasons.push(`counter at staffing target only ${Math.round(h.counterCoveragePct!)}% of the time`);
      worst.push({
        storeId: store.id, storeName: store.name, hour: h.hour, label: h.label, days: h.days,
        waitAvgSeconds: h.waitAvgSeconds, waitN: h.waitN, waitTargetSeconds: waitTarget, lineAvg: h.lineAvg, linePeak: h.linePeak,
        counterCoveragePct: h.counterCoveragePct, entered: h.entered, reason: reasons.join('; '),
      });
    }
  }
  const severity = (w: WorstHour) => (w.waitAvgSeconds !== null && w.waitN >= 3 ? w.waitAvgSeconds / w.waitTargetSeconds : 0) + (w.counterCoveragePct !== null ? (100 - w.counterCoveragePct) / 100 : 0);
  worst.sort((a, b) => severity(b) - severity(a));

  // Chain by local hour of day.
  const hours = new Map<number, { stores: Set<string>; entered: number; hasEntered: boolean; waitSum: number; waitN: number; line: number[]; covSum: number; covN: number }>();
  for (const { store, res } of results) {
    if (!isCounting(statusOf(res))) continue;
    for (const h of res.hourOfDay) {
      let a = hours.get(h.hour);
      if (!a) { a = { stores: new Set(), entered: 0, hasEntered: false, waitSum: 0, waitN: 0, line: [], covSum: 0, covN: 0 }; hours.set(h.hour, a); }
      a.stores.add(store.id);
      if (h.entered !== null) { a.entered += h.entered; a.hasEntered = true; }
      if (h.waitAvgSeconds !== null) { a.waitSum += h.waitAvgSeconds * h.waitN; a.waitN += h.waitN; }
      if (h.lineAvg !== null) a.line.push(h.lineAvg);
      if (h.counterCoveragePct !== null) { a.covSum += h.counterCoveragePct; a.covN++; }
    }
  }
  const byHour: ChainHour[] = [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, a]) => ({
    hour, label: hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`, stores: a.stores.size,
    entered: a.hasEntered ? a.entered : null, waitAvgSeconds: a.waitN ? Math.round(a.waitSum / a.waitN) : null, waitN: a.waitN,
    lineAvg: a.line.length ? r1(a.line.reduce((x, y) => x + y, 0) / a.line.length) : null,
    counterCoveragePct: a.covN ? r1(a.covSum / a.covN) : null,
  }));

  const salesVals = withPos.map(r => r.sales).filter((x): x is number => x !== null);
  const txVals = withPos.map(r => r.transactions).filter((x): x is number => x !== null);
  return {
    range: rangeInfo,
    hoursLabel: hoursText,
    generatedAt: now.toISOString(),
    totals: {
      stores: rows.length, storesCounting: counting.length, entered, enteredCompare,
      enteredDeltaPct: enteredBase !== null && enteredCompare ? Math.round(((enteredBase - enteredCompare) / enteredCompare) * 100) : null,
      avgWaitSeconds: waitN ? Math.round(waitWeighted / waitN) : null, waitN,
      walkaways: sumOrNull(counting.map(r => r.walkaways)), queuers: counting.reduce((a, r) => a + r.queuers, 0),
      counterCoveragePct: covs.length ? r1(covs.reduce((a, b) => a + b, 0) / covs.length) : null,
      sales: salesVals.length ? r2(salesVals.reduce((a, b) => a + b, 0)) : null,
      transactions: txVals.length ? txVals.reduce((a, b) => a + b, 0) : null,
      conversionPct: mE > 0 ? r1((mT / mE) * 100) : null, storesWithPos: withPos.length,
    },
    stores: rows,
    worstHours: worst.slice(0, 15),
    byHour,
  };
}

/** Measurable areas per store (for the store list). */
export async function countingSetup(storeIds: string[]): Promise<Map<string, { areas: number; measurable: number }>> {
  const zones = await countingStore.getZonesForStores(storeIds);
  return new Map([...zones.entries()].map(([id, zs]) => [id, { areas: zs.length, measurable: zs.filter(isZoneMeasurable).length }]));
}
