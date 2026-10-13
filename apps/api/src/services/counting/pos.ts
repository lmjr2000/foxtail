/**
 * Register (POS) sales vs measured traffic (carried over from Eye of Omni's pilot validation).
 * Hourly sales + transactions come from CSV uploads (pos-csv.ts). The conversion rate only uses hours
 * where both traffic and POS exist, so a missing upload never looks like a bad rate.
 */
import type { CountingConfig, Zone } from '@foxtail/shared';
import { q, tx } from '../../db/pool.js';
import { buildCtx, computeEntered, computeWait } from './engine.js';
import type { PosHour } from './pos-csv.js';
import * as countingStore from './store.js';
import { hourLabel, tzParts, zonedToUtc } from './time.js';

export interface HourRow {
  hourAt: Date; date: string; hour: number; label: string;
  entered: number | null; waitAvgSeconds: number | null;
  transactions: number | null; sales: number | null;
  conversionPct: number | null; avgTicket: number | null; salesPerVisitor: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function derive(r: Pick<HourRow, 'entered' | 'transactions' | 'sales'>) {
  return {
    conversionPct: r.entered && r.transactions !== null ? r1((r.transactions / r.entered) * 100) : null,
    avgTicket: r.transactions && r.sales !== null ? r2(r.sales / r.transactions) : null,
    salesPerVisitor: r.entered && r.sales !== null ? r2(r.sales / r.entered) : null,
  };
}

/** Traffic per local clock hour in [start, end): only hours that had camera samples. Tracks get 2h of lead-in. */
export async function measuredByHour(storeId: string, cfg: CountingConfig, zones: Zone[], start: Date, end: Date, now = new Date()): Promise<Map<number, { entered: number | null; waitAvgSeconds: number | null }>> {
  const tz = cfg.timezone;
  const cs = new Date(start.getTime() - 2 * 3600_000);
  const ce = new Date(Math.min(now.getTime(), end.getTime()));
  const out = new Map<number, { entered: number | null; waitAvgSeconds: number | null }>();
  if (ce <= cs) return out;
  const samples = await countingStore.querySamples(storeId, cs, ce);
  const ctx = buildCtx(cfg, zones, samples, cs, ce, { mode: 'all' }, now);
  if (!ctx.rounds.length) return out;
  const hourStart = (d: Date) => { const x = tzParts(d, tz); return zonedToUtc(x.year, x.month, x.day, x.hour, 0, tz).getTime(); };
  const ent = computeEntered(ctx);
  for (const r of ctx.rounds) if (r.at >= start && r.at < end) out.set(hourStart(r.at), { entered: ent.value === null ? null : 0, waitAvgSeconds: null });
  if (ent.value !== null) for (const t of ent.tracks) { const h = out.get(hourStart(t.start)); if (h && h.entered !== null) h.entered++; }
  const waits = new Map<number, number[]>();
  for (const d of computeWait(ctx, ['QUEUE'], cfg.thresholds.waitTargetSeconds).durations) {
    const k = hourStart(d.start);
    if (!out.has(k)) continue;
    if (!waits.has(k)) waits.set(k, []);
    waits.get(k)!.push(d.seconds);
  }
  for (const [k, ws] of waits) out.get(k)!.waitAvgSeconds = Math.round(ws.reduce((a, b) => a + b, 0) / ws.length);
  return out;
}

/** One row per local hour that has measured traffic or POS data. */
export async function hourlyComparison(storeId: string, cfg: CountingConfig, zones: Zone[], start: Date, end: Date, now = new Date()): Promise<HourRow[]> {
  const tz = cfg.timezone;
  const [measured, pos] = await Promise.all([measuredByHour(storeId, cfg, zones, start, end, now), listPos(storeId, start, end)]);
  const posBy = new Map(pos.map(p => [p.hourAt.getTime(), p]));
  const keys = [...new Set([...measured.keys(), ...posBy.keys()])].filter(k => k >= start.getTime() && k < end.getTime()).sort((a, b) => a - b);
  return keys.map(k => {
    const hs = new Date(k);
    const p = tzParts(hs, tz);
    const m = measured.get(k);
    const pr = posBy.get(k);
    const base = { entered: m?.entered ?? null, transactions: pr?.transactions ?? null, sales: pr?.sales ?? null };
    return {
      hourAt: hs, date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, hour: p.hour, label: hourLabel(p.hour),
      waitAvgSeconds: m?.waitAvgSeconds ?? null, ...base, ...derive(base),
    };
  });
}

export interface CompareSummary {
  entered: number | null; transactions: number | null; sales: number | null;
  matchedHours: number; conversionPct: number | null; avgTicket: number | null; salesPerVisitor: number | null;
  byHour: Array<{ hour: number; label: string; days: number; entered: number | null; transactions: number | null; sales: number | null; conversionPct: number | null; avgTicket: number | null; salesPerVisitor: number | null }>;
  byDay: Array<{ date: string; entered: number | null; transactions: number | null; sales: number | null; conversionPct: number | null; avgTicket: number | null; salesPerVisitor: number | null }>;
}

const sumN = (xs: Array<number | null>) => (xs.some(x => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

export function summarize(rows: HourRow[]): CompareSummary {
  const agg = (rs: HourRow[]) => {
    const pairT = rs.filter(r => r.entered !== null && r.transactions !== null);
    const pairS = rs.filter(r => r.entered !== null && r.sales !== null);
    const t = sumN(rs.map(r => r.transactions)), s = sumN(rs.map(r => r.sales));
    const pe = sumN(pairT.map(r => r.entered)), pt = sumN(pairT.map(r => r.transactions));
    const se = sumN(pairS.map(r => r.entered)), ss = sumN(pairS.map(r => r.sales));
    return {
      entered: sumN(rs.map(r => r.entered)), transactions: t, sales: s === null ? null : r2(s),
      conversionPct: pe && pt !== null ? r1((pt / pe) * 100) : null,
      avgTicket: t && s !== null ? r2(s / t) : null,
      salesPerVisitor: se && ss !== null ? r2(ss / se) : null,
    };
  };
  const group = <K extends string | number>(key: (r: HourRow) => K) => {
    const m = new Map<K, HourRow[]>();
    for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return m;
  };
  return {
    ...agg(rows),
    matchedHours: rows.filter(r => r.entered !== null && r.transactions !== null).length,
    byHour: [...group(r => r.hour).entries()].sort((a, b) => a[0] - b[0]).map(([h, rs]) => ({ hour: h, label: hourLabel(h), days: new Set(rs.map(r => r.date)).size, ...agg(rs) })),
    byDay: [...group(r => r.date).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rs]) => ({ date, ...agg(rs) })),
  };
}

export function comparisonCsv(rows: HourRow[], storeName: string): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['store', 'date', 'hour', 'customers_entered', 'transactions', 'sales', 'conversion_pct', 'avg_ticket', 'sales_per_visitor', 'avg_wait_seconds'];
  return '﻿' + [head.join(','), ...rows.map(r => [storeName, r.date, String(r.hour).padStart(2, '0') + ':00', r.entered, r.transactions, r.sales, r.conversionPct, r.avgTicket, r.salesPerVisitor, r.waitAvgSeconds].map(esc).join(','))].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------------------------------ POS store

export async function upsertPos(storeId: string, rows: PosHour[], source: string, userId: string | null): Promise<number> {
  await tx(async c => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO pos_hourly (store_id, hour_at, sales, transactions, source, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (store_id, hour_at) DO UPDATE SET sales = EXCLUDED.sales, transactions = EXCLUDED.transactions,
           source = EXCLUDED.source, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = NOW()`,
        [storeId, r.hourAt, r.sales, r.transactions, source, userId],
      );
    }
  });
  return rows.length;
}

export async function listPos(storeId: string, start: Date, end: Date): Promise<PosHour[]> {
  const r = await q('SELECT hour_at, sales, transactions FROM pos_hourly WHERE store_id = $1 AND hour_at >= $2 AND hour_at < $3 ORDER BY hour_at', [storeId, start, end]);
  return r.rows.map(x => ({ hourAt: new Date(x.hour_at as string), sales: x.sales === null ? null : Number(x.sales), transactions: x.transactions === null ? null : Number(x.transactions) }));
}

/** POS rows for many stores at once (overview). */
export async function listPosForStores(storeIds: string[], start: Date, end: Date): Promise<Map<string, PosHour[]>> {
  const out = new Map<string, PosHour[]>(storeIds.map(id => [id, []]));
  if (!storeIds.length) return out;
  const r = await q('SELECT store_id, hour_at, sales, transactions FROM pos_hourly WHERE store_id = ANY($1::text[]) AND hour_at >= $2 AND hour_at < $3', [storeIds, start, end]);
  for (const x of r.rows) out.get(String(x.store_id))?.push({ hourAt: new Date(x.hour_at as string), sales: x.sales === null ? null : Number(x.sales), transactions: x.transactions === null ? null : Number(x.transactions) });
  return out;
}

export async function posUploads(storeId: string, tz: string): Promise<Array<{ date: string; hours: number; sales: number | null; transactions: number | null; source: string; uploadedAt: string }>> {
  const r = await q(
    `SELECT to_char(hour_at AT TIME ZONE $2, 'YYYY-MM-DD') AS d,
            COUNT(*)::int AS hours, SUM(sales) AS sales, SUM(transactions)::int AS tx, MAX(source) AS source, MAX(uploaded_at) AS up
       FROM pos_hourly WHERE store_id = $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 60`, [storeId, tz]);
  return r.rows.map(x => ({ date: String(x.d), hours: Number(x.hours), sales: x.sales === null ? null : Number(x.sales), transactions: x.tx === null ? null : Number(x.tx), source: String(x.source), uploadedAt: new Date(x.up as string).toISOString() }));
}

export async function deletePosDay(storeId: string, start: Date, end: Date): Promise<number> {
  const r = await q('DELETE FROM pos_hourly WHERE store_id = $1 AND hour_at >= $2 AND hour_at < $3', [storeId, start, end]);
  return r.rowCount ?? 0;
}
