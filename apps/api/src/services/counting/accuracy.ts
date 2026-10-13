/**
 * Accuracy spot checks (carried over from Eye of Omni): someone counts customers (or times waits) at the
 * store for a window, enters the number, and we store it next to what the system measured for the
 * same window. Targets: entered within 10%, average wait within 60 seconds.
 */
import type { CountingConfig, Zone } from '@foxtail/shared';
import { q } from '../../db/pool.js';
import { newId } from '../../lib/ids.js';
import { buildCtx, computeEntered, computeWait } from './engine.js';
import * as countingStore from './store.js';

export const COUNT_TARGET_PCT = 10;
export const WAIT_TARGET_SEC = 60;

export interface Measured { entered: number | null; waitAvgSeconds: number | null; waitN: number; coveragePct: number | null }

/** What the system measured in [start, end). Tracks get 2h of lead-in so people already inside are not re-counted. */
export async function measureWindow(storeId: string, cfg: CountingConfig, zones: Zone[], start: Date, end: Date, now = new Date()): Promise<Measured> {
  const cs = new Date(start.getTime() - 2 * 3600_000);
  const ce = new Date(Math.min(now.getTime(), end.getTime() + 30 * 60_000));
  const samples = await countingStore.querySamples(storeId, cs, ce);
  const ctx = buildCtx(cfg, zones, samples, cs, ce, { mode: 'all' }, now);
  const inW = (d: Date) => d >= start && d < end;
  const rounds = ctx.rounds.filter(r => inW(r.at)).length;
  const expected = Math.max(1, Math.floor((Math.min(end.getTime(), now.getTime()) - start.getTime()) / 1000 / ctx.interval));
  const coveragePct = rounds ? Math.min(100, Math.round((rounds / expected) * 100)) : 0;
  if (!rounds) return { entered: null, waitAvgSeconds: null, waitN: 0, coveragePct };
  const ent = computeEntered(ctx);
  const entered = ent.value === null ? null : ent.tracks.filter(t => inW(t.start)).length;
  const durs = computeWait(ctx, ['QUEUE'], cfg.thresholds.waitTargetSeconds).durations.filter(d => inW(d.start));
  const hasLine = zones.some(z => z.zoneType === 'QUEUE' && z.audience === 'customer');
  const waitAvgSeconds = durs.length ? Math.round(durs.reduce((a, d) => a + d.seconds, 0) / durs.length) : (hasLine ? 0 : null);
  return { entered, waitAvgSeconds, waitN: durs.length, coveragePct };
}

export interface AccuracyCheck {
  id: string; kind: 'count' | 'wait'; startAt: string; minutes: number;
  manualValue: number; manualN: number | null; systemValue: number | null; systemN: number | null; coveragePct: number | null;
  errorPct: number | null; errorSeconds: number | null; pass: boolean | null; notes: string; createdAt: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function grade(kind: 'count' | 'wait', manual: number, system: number | null) {
  if (system === null) return { errorPct: null, errorSeconds: null, pass: null };
  if (kind === 'count') {
    const errorPct = manual > 0 ? r1((Math.abs(system - manual) / manual) * 100) : (system === 0 ? 0 : 100);
    return { errorPct, errorSeconds: null, pass: errorPct <= COUNT_TARGET_PCT };
  }
  const errorSeconds = Math.round(Math.abs(system - manual));
  return { errorPct: manual > 0 ? r1((errorSeconds / manual) * 100) : null, errorSeconds, pass: errorSeconds <= WAIT_TARGET_SEC };
}

function rowToCheck(x: Record<string, unknown>): AccuracyCheck {
  const kind = x.kind as 'count' | 'wait';
  const manual = Number(x.manual_value), system = x.system_value === null ? null : Number(x.system_value);
  return {
    id: String(x.id), kind, startAt: new Date(String(x.start_at)).toISOString(), minutes: Number(x.minutes),
    manualValue: manual, manualN: x.manual_n === null ? null : Number(x.manual_n), systemValue: system, systemN: x.system_n === null ? null : Number(x.system_n),
    coveragePct: x.coverage_pct === null ? null : Number(x.coverage_pct), ...grade(kind, manual, system), notes: String(x.notes ?? ''),
    createdAt: new Date(String(x.created_at)).toISOString(),
  };
}

export async function addCheck(storeId: string, c: { kind: 'count' | 'wait'; startAt: Date; minutes: number; manualValue: number; manualN: number | null; notes: string }, m: Measured, userId: string | null): Promise<AccuracyCheck> {
  const sys = c.kind === 'count' ? m.entered : m.waitAvgSeconds;
  const r = await q(
    `INSERT INTO accuracy_checks (id, store_id, kind, start_at, minutes, manual_value, manual_n, system_value, system_n, coverage_pct, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [newId('acc'), storeId, c.kind, c.startAt, c.minutes, c.manualValue, c.manualN, sys, c.kind === 'count' ? null : m.waitN, m.coveragePct, c.notes.slice(0, 500), userId],
  );
  return rowToCheck(r.rows[0]);
}

export async function listChecks(storeId: string, since: Date | null): Promise<AccuracyCheck[]> {
  const r = await q('SELECT * FROM accuracy_checks WHERE store_id = $1 AND ($2::timestamptz IS NULL OR start_at >= $2) ORDER BY start_at DESC LIMIT 500', [storeId, since]);
  return r.rows.map(rowToCheck);
}

export async function deleteCheck(storeId: string, id: string): Promise<boolean> {
  const r = await q('DELETE FROM accuracy_checks WHERE store_id = $1 AND id = $2', [storeId, id]);
  return (r.rowCount ?? 0) > 0;
}

export function accuracySummary(checks: AccuracyCheck[]) {
  const part = (kind: 'count' | 'wait') => {
    const xs = checks.filter(c => c.kind === kind && c.pass !== null);
    const errs = xs.map(c => (kind === 'count' ? c.errorPct! : c.errorSeconds!));
    return {
      n: xs.length, target: kind === 'count' ? COUNT_TARGET_PCT : WAIT_TARGET_SEC, unit: kind === 'count' ? '%' : 's',
      avgError: errs.length ? r1(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
      passRatePct: xs.length ? Math.round((xs.filter(c => c.pass).length / xs.length) * 100) : null,
    };
  };
  return { count: part('count'), wait: part('wait') };
}
