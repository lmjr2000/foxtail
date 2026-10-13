/**
 * One store's dashboard for a range: load config, areas and samples, run the engine. Shared by the
 * store page, the overview and the reports. Only real samples are ever used.
 */
import type { CountingConfig, Zone } from '@foxtail/shared';
import type { Store } from '../stores.js';
import { computeInsights, type InsightsResult } from './compute.js';
import type { HoursFilter } from './engine.js';
import * as countingStore from './store.js';
import { addLocalDays, startOfLocalDay, weekdayName, zonedToUtc } from './time.js';

export interface RangeSpec { key: string; start: Date; end: Date; label: string; singleDay: boolean; compare: { start: Date; end: Date; label: string } | null }

export const RANGE_HELP = 'range must be today, yesterday, 7d, 30d, YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD (max 31 days, not in the future)';

export function parseRange(raw: unknown, tz: string, now: Date): RangeSpec | null {
  const r = String(raw || 'today');
  const today = startOfLocalDay(now, tz);
  const weekAgo = (d: Date) => addLocalDays(d, -7, tz);
  const shift = (d: Date, from: Date) => new Date(weekAgo(from).getTime() + (d.getTime() - from.getTime()));
  if (r === 'today') {
    return { key: r, start: today, end: now, label: 'Today', singleDay: true, compare: { start: weekAgo(today), end: shift(now, today), label: `last ${weekdayName(today, tz)}` } };
  }
  if (r === 'yesterday') {
    const y = addLocalDays(today, -1, tz);
    return { key: r, start: y, end: new Date(today.getTime() - 1), label: 'Yesterday', singleDay: true, compare: { start: weekAgo(y), end: new Date(weekAgo(today).getTime() - 1), label: `the ${weekdayName(y, tz)} before` } };
  }
  if (r === '7d' || r === '30d') {
    const days = r === '7d' ? 7 : 30;
    const s = addLocalDays(today, -(days - 1), tz);
    return { key: r, start: s, end: now, label: `Last ${days} days`, singleDay: false, compare: { start: addLocalDays(s, -days, tz), end: new Date(s.getTime() - 1), label: `the ${days} days before` } };
  }
  const cr = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/.exec(r);
  if (cr) {
    const s0 = zonedToUtc(Number(cr[1]), Number(cr[2]), Number(cr[3]), 0, 0, tz);
    const e0 = addLocalDays(zonedToUtc(Number(cr[4]), Number(cr[5]), Number(cr[6]), 0, 0, tz), 1, tz);
    if (Number.isNaN(s0.getTime()) || s0.getTime() > now.getTime() || e0.getTime() <= s0.getTime()) return null;
    const days = Math.round((e0.getTime() - s0.getTime()) / 86400_000);
    if (days > 31) return null;
    if (days === 1) return parseRange(`${cr[1]}-${cr[2]}-${cr[3]}`, tz, now);
    const end = e0.getTime() > now.getTime() ? now : new Date(e0.getTime() - 1);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
    return { key: r, start: s0, end, label: `${fmt(s0)} – ${fmt(new Date(e0.getTime() - 1))}`, singleDay: false, compare: { start: addLocalDays(s0, -days, tz), end: new Date(s0.getTime() - 1), label: `the ${days} days before` } };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r);
  if (m) {
    const s = zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, tz);
    if (Number.isNaN(s.getTime()) || s.getTime() > now.getTime()) return null;
    const e = addLocalDays(s, 1, tz);
    const end = e.getTime() > now.getTime() ? now : new Date(e.getTime() - 1);
    const label = s.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    return { key: r, start: s, end, label, singleDay: true, compare: { start: weekAgo(s), end: shift(end, s), label: `the ${weekdayName(s, tz)} before` } };
  }
  return null;
}

export const HOURS_HELP = 'hours must be all, open or HH-HH';

export function parseHours(raw: unknown): HoursFilter | null {
  const h = String(raw || 'open');
  if (h === 'all') return { mode: 'all' };
  if (h === 'open') return { mode: 'open' };
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(h);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 24 && m[1] !== m[2]) return { mode: 'custom', fromHour: Number(m[1]), toHour: Number(m[2]) % 24 };
  return null;
}

export function hoursLabel(h: HoursFilter): string {
  if (h.mode === 'all') return 'All hours';
  if (h.mode === 'open') return 'Opening hours';
  const f = (x: number) => (x === 0 ? '12 AM' : x < 12 ? `${x} AM` : x === 12 ? '12 PM' : `${x - 12} PM`);
  return `${f(h.fromHour)} – ${f(h.toHour)}`;
}

export interface StoreInsights { result: InsightsResult; cfg: CountingConfig; zones: Zone[]; range: RangeSpec; hours: HoursFilter }

// Short cache so the overview, a store page and a report for the same period do not recompute.
const cache = new Map<string, { at: number; value: StoreInsights }>();
const CACHE_MS = Number(process.env.INSIGHTS_CACHE_MS ?? 30_000);

export function clearInsightsCache(storeId?: string): void {
  if (!storeId) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(`${storeId}|`)) cache.delete(k);
}

export async function storeInsights(store: Store, rangeRaw: unknown, hoursRaw: unknown, now = new Date(), preloaded?: { cfg: CountingConfig; zones: Zone[] }): Promise<StoreInsights | { error: string }> {
  const cfg = preloaded?.cfg ?? await countingStore.loadConfig(store);
  const range = parseRange(rangeRaw, cfg.timezone, now);
  if (!range) return { error: RANGE_HELP };
  const hours = parseHours(hoursRaw);
  if (!hours) return { error: HOURS_HELP };
  const key = `${store.id}|${range.key}|${JSON.stringify(hours)}|${store.updatedAt}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const zones = preloaded?.zones ?? await countingStore.getZones(store.id);
  const [samples, compareSamples] = await Promise.all([
    countingStore.querySamples(store.id, range.start, range.end),
    range.compare ? countingStore.querySamples(store.id, range.compare.start, range.compare.end) : Promise.resolve([]),
  ]);
  const result = computeInsights({
    config: cfg, zones, range: { start: range.start, end: range.end, label: range.label, singleDay: range.singleDay },
    compare: range.compare, samples, compareSamples, hours, now,
  });
  const value = { result, cfg, zones, range, hours };
  if (CACHE_MS > 0) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  }
  return value;
}
