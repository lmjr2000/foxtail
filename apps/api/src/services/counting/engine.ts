/**
 * Counting engine (carried over from Eye of Omni's business-insights engine, coffee-shop parts only).
 *
 * Input: a store's resolved counting config, its areas, and REAL data only: people samples per area
 * per round (from the sampler: person detections on the area's camera, assigned to the area polygon).
 * Output: every metric plus the per-card payloads. A metric whose areas are not set up comes back with
 * status 'needs_zones' and value null — the engine never invents a number.
 *
 * The engine only looks at area ROLES (entry, queue, service, pickup, seating, staff).
 */
import {
  ZONE_TYPE_DEFS, isZoneMeasurable,
  type CountingConfig, type Zone, type ZoneType, type ZoneRole, type MetricDef,
} from '@foxtail/shared';
import { buildTracks, presenceSeconds, type Track } from './tracking.js';
import { tzParts, isOpenAt, openWindowHours, hourLabel, fmtTime, fmtDuration, localDateKey, addLocalDays, startOfLocalDay, zonedToUtc } from './time.js';

export interface EngineSample {
  roundAt: Date;
  zoneId: string;
  cameraId: string | null;
  count: number;
  points: Array<[number, number]> | null;
}
export type HoursFilter = { mode: 'all' } | { mode: 'open' } | { mode: 'custom'; fromHour: number; toHour: number };

export interface EngineRange { start: Date; end: Date; label: string }

export interface EngineInput {
  config: CountingConfig;
  zones: Zone[];
  range: EngineRange & { singleDay: boolean };
  compare: EngineRange | null;
  samples: EngineSample[];
  compareSamples: EngineSample[];
  hours: HoursFilter;
  now: Date;
}

export type MetricStatus = 'ok' | 'needs_zones' | 'no_data';

export interface MetricValue {
  key: string;
  label: string;
  unit: MetricDef['unit'];
  value: number | null;
  display: string;
  compare: number | null;
  compareDisplay: string | null;
  deltaPct: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  /** true = change is good, false = bad, null = neutral / unknown */
  good: boolean | null;
  status: MetricStatus;
  /** Plain-language reason when status is not ok (e.g. which area to set up). */
  needs: string | null;
  estimate: boolean;
  sub: string | null;
}

// ---------------------------------------------------------------------------------------------
// Context: one period (current or comparison) of samples, rounds and tracks
// ---------------------------------------------------------------------------------------------

export interface Round { at: Date; byZone: Map<string, number> }

export interface Ctx {
  cfg: CountingConfig;
  zones: Zone[];
  zoneById: Map<string, Zone>;
  start: Date;
  end: Date;
  now: Date;
  live: boolean;
  interval: number;
  rounds: Round[];
  tracks: Map<string, Track[]>;
  lastRoundAt: Date | null;
  fresh: boolean;
}

export function zoneRole(z: Zone): ZoneRole { return ZONE_TYPE_DEFS[z.zoneType]?.role ?? 'staff'; }

function inHours(d: Date, cfg: CountingConfig, hours: HoursFilter): boolean {
  if (hours.mode === 'all') return true;
  if (hours.mode === 'open') return isOpenAt(d, cfg.timezone, cfg.operatingHours);
  const h = tzParts(d, cfg.timezone).hour;
  return hours.fromHour <= hours.toHour ? h >= hours.fromHour && h < hours.toHour : h >= hours.fromHour || h < hours.toHour;
}

export function buildCtx(cfg: CountingConfig, zones: Zone[], samples: EngineSample[], start: Date, end: Date, hours: HoursFilter, now: Date): Ctx {
  const activeZones = zones.filter(z => isZoneMeasurable(z) && cfg.zoneTypes.includes(z.zoneType));
  const zoneById = new Map(activeZones.map(z => [z.id, z]));
  const interval = cfg.sampleIntervalSeconds;
  const inRange = samples.filter(s => s.roundAt >= start && s.roundAt <= end && inHours(s.roundAt, cfg, hours));
  const roundMap = new Map<number, Map<string, number>>();
  const perZone = new Map<string, EngineSample[]>();
  for (const s of inRange) {
    if (!zoneById.has(s.zoneId)) continue;
    const t = s.roundAt.getTime();
    if (!roundMap.has(t)) roundMap.set(t, new Map());
    roundMap.get(t)!.set(s.zoneId, s.count);
    if (!perZone.has(s.zoneId)) perZone.set(s.zoneId, []);
    perZone.get(s.zoneId)!.push(s);
  }
  const rounds: Round[] = [...roundMap.entries()].sort((a, b) => a[0] - b[0]).map(([t, byZone]) => ({ at: new Date(t), byZone }));
  const tracks = new Map<string, Track[]>();
  const opts = { maxDistance: cfg.thresholds.trackMaxDistance, maxGapMs: interval * 2500 };
  for (const [zid, ss] of perZone) {
    tracks.set(zid, buildTracks(ss.map(s => ({ roundAt: s.roundAt, targetId: zid, points: s.points || [], count: s.count })), opts));
  }
  const lastRoundAt = rounds.length ? rounds[rounds.length - 1].at : null;
  const live = end.getTime() >= now.getTime() - 60_000;
  const fresh = !!lastRoundAt && now.getTime() - lastRoundAt.getTime() <= (interval * 3 + 60) * 1000;
  return { cfg, zones: activeZones, zoneById, start, end, now, live, interval, rounds, tracks, lastRoundAt, fresh };
}

// ---------------------------------------------------------------------------------------------
// Area selection helpers
// ---------------------------------------------------------------------------------------------

export function customerZones(ctx: Ctx, pred: (z: Zone) => boolean = () => true): Zone[] {
  return ctx.zones.filter(z => z.audience === 'customer' && pred(z));
}
export function staffZones(ctx: Ctx, pred: (z: Zone) => boolean = () => true): Zone[] {
  return ctx.zones.filter(z => z.audience === 'staff' && pred(z));
}
function ofTypes(types: ZoneType[]) { return (z: Zone) => types.includes(z.zoneType); }
function ofRoles(roles: ZoneRole[]) { return (z: Zone) => roles.includes(zoneRole(z)); }

function zoneTracks(ctx: Ctx, zones: Zone[]): Track[] {
  return zones.flatMap(z => ctx.tracks.get(z.id) || []);
}

function typeNames(types: ZoneType[]): string {
  const names = [...new Set(types.map(t => ZONE_TYPE_DEFS[t].label))];
  return names.length <= 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** Per-round total for a set of areas (only rounds where at least one of them was sampled). */
export function seriesFor(ctx: Ctx, zones: Zone[]): Array<{ at: Date; total: number }> {
  const ids = new Set(zones.map(z => z.id));
  const out: Array<{ at: Date; total: number }> = [];
  for (const r of ctx.rounds) {
    let seen = false, total = 0;
    for (const [zid, c] of r.byZone) if (ids.has(zid)) { seen = true; total += c; }
    if (seen) out.push({ at: r.at, total });
  }
  return out;
}

/** Latest value (null when the live feed of samples is stale). */
function latest(ctx: Ctx, series: Array<{ at: Date; total: number }>): { value: number | null; at: Date | null; stale: boolean } {
  if (!series.length) return { value: null, at: null, stale: false };
  const last = series[series.length - 1];
  if (ctx.live && !ctx.fresh) return { value: null, at: last.at, stale: true };
  return { value: last.total, at: last.at, stale: false };
}

function mean(xs: number[]): number | null { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function round1(v: number | null): number | null { return v === null ? null : Math.round(v * 10) / 10; }
function pct(v: number | null): number | null { return v === null ? null : Math.round(v * 1000) / 10; }

// ---------------------------------------------------------------------------------------------
// Core computations (all return null + reason when the areas are missing)
// ---------------------------------------------------------------------------------------------

export interface Computed { value: number | null; needs: string | null; estimate?: boolean; sub?: string | null; extra?: Record<string, unknown> }

const NEEDS = (what: string) => `Set up ${what.replace(/\ba (?=[AEIOUaeiou])/g, 'an ')} to see this`;

/**
 * Door, line and counter areas: people pass through in a minute or two, so a single sighting is a real visit there.
 * For these, only a one-round dip between two sightings is filled in (a missed detection is not a new person);
 * seating keeps the median, which also drops one-off phantom detections.
 */
const TRANSIT_ROLES: ZoneRole[] = ['entry', 'queue', 'service', 'pickup'];
const isTransit = (zones: Zone[]) => zones.length > 0 && zones.every(z => TRANSIT_ROLES.includes(zoneRole(z)));

/**
 * People first seen inside the customer areas. Per camera: people in its customer areas each round,
 * smoothed with the neighbouring rounds (median, so one missed or one phantom detection never counts),
 * and every rise is that many new arrivals. Someone walking from one area to another on the same camera
 * is not a rise. A passer-by seen in a single round is not counted. This is a floor on visitors that
 * does not depend on catching someone in the doorway in the second they walk through.
 * Cameras are not added together (one person walking past two cameras would count twice); the camera that saw the
 * most arrivals is used, so this stays a floor of the real number.
 */
export function computeArrivals(ctx: Ctx, zones: Zone[] = customerZones(ctx), transit = false): Array<{ at: Date; n: number }> {
  const byCam = new Map<string, Zone[]>();
  for (const z of zones) { const k = z.cameraId || z.id; if (!byCam.has(k)) byCam.set(k, []); byCam.get(k)!.push(z); }
  const gap = ctx.interval * 2500;
  let out: Array<{ at: Date; n: number }> = [];
  let best = -1;
  for (const camZones of byCam.values()) {
    const s = seriesFor(ctx, camZones);
    const cam: Array<{ at: Date; n: number }> = [];
    let prev = 0;
    for (let i = 0; i < s.length; i++) {
      const t = s[i].at.getTime();
      const near = (j: number) => (j >= 0 && j < s.length && Math.abs(s[j].at.getTime() - t) <= gap ? s[j].total : null);
      const a = near(i - 1), b = s[i].total, c = near(i + 1);
      const v = transit ? (a !== null && c !== null ? Math.max(b, Math.min(a, c)) : b) : a !== null && c !== null ? [a, b, c].sort((x, y) => x - y)[1] : a !== null ? Math.min(a, b) : c !== null ? Math.min(b, c) : 0;
      if (v > prev) cam.push({ at: s[i].at, n: v - prev });
      prev = v;
    }
    const total = cam.reduce((acc, e) => acc + e.n, 0);
    if (total > best) { best = total; out = cam; }
  }
  return out.sort((x, y) => x.at.getTime() - y.at.getTime());
}

/** Entered = the larger of the entrance-area count and the people first seen inside (never a guess). */
export function computeEntered(ctx: Ctx): Computed & { tracks: Track[] } {
  const zs = customerZones(ctx, ofRoles(['entry']));
  if (!zs.length && !customerZones(ctx).length) return { value: null, needs: NEEDS('an Entrance area'), tracks: [] };
  if (!ctx.rounds.length) return { value: null, needs: null, tracks: [] };
  const door = zoneTracks(ctx, zs);
  let arrivals = computeArrivals(ctx);
  const transitZones = customerZones(ctx, ofRoles(TRANSIT_ROLES));
  if (isTransit(transitZones)) {
    const t = computeArrivals(ctx, transitZones, true);
    if (t.reduce((a, e) => a + e.n, 0) > arrivals.reduce((a, e) => a + e.n, 0)) arrivals = t;
  }
  const seen = arrivals.reduce((a, e) => a + e.n, 0);
  if (seen <= door.length) return { value: door.length, needs: null, tracks: door };
  const tracks: Track[] = arrivals.flatMap(e => Array.from({ length: e.n }, () => ({ targetId: 'arrival', start: e.at, end: e.at, samples: 1, open: false, lastPoint: [0.5, 0.5] as [number, number] })));
  return { value: seen, needs: null, tracks, extra: { doorCount: door.length, seenInside: seen } };
}

export function computeOccupancy(ctx: Ctx): { current: Computed; peak: Computed & { at: Date | null }; series: Array<{ at: Date; total: number }> } {
  const zs = customerZones(ctx);
  if (!zs.length) {
    const n = NEEDS('customer areas');
    return { current: { value: null, needs: n }, peak: { value: null, needs: n, at: null }, series: [] };
  }
  const series = seriesFor(ctx, zs);
  const l = latest(ctx, series);
  let peak: { at: Date; total: number } | null = null;
  for (const p of series) if (!peak || p.total > peak.total) peak = p;
  return {
    current: { value: l.value, needs: null, sub: l.stale ? 'No camera sample in the last few minutes' : (!ctx.live && l.at ? 'At end of period' : null) },
    peak: { value: peak ? peak.total : null, needs: null, at: peak ? peak.at : null, sub: peak ? `at ${fmtTime(peak.at, ctx.cfg.timezone)}` : null },
    series,
  };
}

export function computeExited(ctx: Ctx, entered: Computed, occupancyNow: number | null, occupancyEnd: number | null): Computed {
  const exits = customerZones(ctx, ofRoles(['exit']));
  if (exits.length) return { value: ctx.rounds.length ? zoneTracks(ctx, exits).length : null, needs: null };
  if (entered.value === null) return { value: null, needs: NEEDS('an Entrance or Exit area') };
  const inside = occupancyNow ?? occupancyEnd ?? 0;
  return { value: Math.max(0, entered.value - inside), needs: null, estimate: true, sub: 'Estimated: entered minus still inside' };
}

export function computeZoneCount(ctx: Ctx, types: ZoneType[]): Computed & { avg: number | null; peak: number | null; peakAt: Date | null; series: Array<{ at: Date; total: number }> } {
  const zs = customerZones(ctx, ofTypes(types));
  if (!zs.length) return { value: null, needs: NEEDS(`a customer-side ${typeNames(types)} area`), avg: null, peak: null, peakAt: null, series: [] };
  const series = seriesFor(ctx, zs);
  const l = latest(ctx, series);
  let peak: { at: Date; total: number } | null = null;
  for (const p of series) if (!peak || p.total > peak.total) peak = p;
  return { value: l.value, needs: null, avg: round1(mean(series.map(s => s.total))), peak: peak?.total ?? null, peakAt: peak?.at ?? null, series, sub: l.stale ? 'No recent camera sample' : null };
}

export interface WaitResult extends Computed { longest: number | null; longestAt: Date | null; n: number; overTarget: number; durations: Array<{ start: Date; end: Date; seconds: number; zoneId: string }> }

export function computeWait(ctx: Ctx, types: ZoneType[], targetSeconds: number): WaitResult {
  const zs = customerZones(ctx, ofTypes(types));
  const empty = { longest: null, longestAt: null, n: 0, overTarget: 0, durations: [] };
  if (!zs.length) return { value: null, needs: NEEDS(`a customer-side ${typeNames(types)} area`), ...empty };
  const lineLike = zs.some(z => zoneRole(z) === 'queue');
  const minSec = lineLike ? ctx.cfg.thresholds.walkawayMinQueueSeconds : 0;
  const durations = zs.flatMap(z => (ctx.tracks.get(z.id) || []).map(t => ({ start: t.start, end: t.end, seconds: presenceSeconds(t, ctx.interval), zoneId: z.id })))
    .filter(d => d.seconds >= minSec);
  if (!durations.length) return { value: ctx.rounds.length ? 0 : null, needs: null, ...empty, sub: ctx.rounds.length ? 'Nobody waited long enough to count' : null };
  let longest = durations[0];
  for (const d of durations) if (d.seconds > longest.seconds) longest = d;
  return {
    value: Math.round(mean(durations.map(d => d.seconds))!), needs: null,
    longest: Math.round(longest.seconds), longestAt: longest.start, n: durations.length,
    overTarget: durations.filter(d => d.seconds > targetSeconds).length, durations,
  };
}

export interface WalkawayResult extends Computed { queuers: number; served: number; pending: number; events: Array<{ at: Date; zoneId: string; seconds: number }> }

export function computeWalkaways(ctx: Ctx): WalkawayResult {
  const t = ctx.cfg.thresholds;
  const lines = customerZones(ctx, ofRoles(['queue']));
  const base = { queuers: 0, served: 0, pending: 0, events: [] };
  if (!lines.length) return { value: null, needs: NEEDS('a customer-side Line area'), ...base };
  const targets = customerZones(ctx, ofRoles(['service', 'pickup']));
  if (!targets.length) return { value: null, needs: NEEDS('a customer-side Register or Pickup area'), ...base };
  const used = new Set<Track>();
  const events: WalkawayResult['events'] = [];
  let queuers = 0, served = 0, pending = 0;
  const candidates = lines.flatMap(z => (ctx.tracks.get(z.id) || []).map(tr => ({ tr, z })))
    .filter(c => presenceSeconds(c.tr, ctx.interval) >= t.walkawayMinQueueSeconds)
    .sort((a, b) => a.tr.end.getTime() - b.tr.end.getTime());
  const targetTracks = zoneTracks(ctx, targets).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const { tr, z } of candidates) {
    queuers += 1;
    const from = tr.end.getTime() - ctx.interval * 1500;
    const to = tr.end.getTime() + t.walkawayWindowSeconds * 1000;
    const hit = targetTracks.find(x => !used.has(x) && x.start.getTime() >= from && x.start.getTime() <= to);
    if (hit) { used.add(hit); served += 1; continue; }
    if (tr.open || (ctx.live && to > ctx.now.getTime())) { pending += 1; continue; }
    events.push({ at: tr.end, zoneId: z.id, seconds: presenceSeconds(tr, ctx.interval) });
  }
  return { value: ctx.rounds.length ? events.length : null, needs: null, queuers, served, pending, events };
}

export interface CoverageZone {
  zoneId: string; label: string; zoneType: ZoneType; current: number | null; avg: number | null;
  targetMin: number | null; targetMax: number | null; coveragePct: number | null; status: 'understaffed' | 'ok' | 'over' | 'unknown';
}
export interface CoverageResult extends Computed { peakPct: number | null; zones: CoverageZone[] }

export function computeCoverage(ctx: Ctx, types: ZoneType[] | 'all', peakWindows: Array<{ start: Date; end: Date }>): CoverageResult {
  const zs = staffZones(ctx, z => (types === 'all' || types.includes(z.zoneType)) && (z.staffTargetMin ?? 0) > 0);
  if (!zs.length) {
    const what = types === 'all' ? 'a staff-side area with a staff target' : `a staff-side ${typeNames(types)} area with a staff target`;
    return { value: null, needs: NEEDS(what), peakPct: null, zones: [] };
  }
  let met = 0, total = 0, pMet = 0, pTotal = 0;
  const zones: CoverageZone[] = zs.map(z => {
    const s = seriesFor(ctx, [z]);
    let zm = 0;
    for (const p of s) {
      const ok = p.total >= (z.staffTargetMin ?? 0);
      if (ok) zm++;
      const inPeak = peakWindows.some(w => p.at >= w.start && p.at < w.end);
      if (inPeak) { pTotal++; if (ok) pMet++; }
    }
    met += zm; total += s.length;
    const l = latest(ctx, s);
    const avg = round1(mean(s.map(p => p.total)));
    let status: CoverageZone['status'] = 'unknown';
    const cur = l.value;
    if (cur !== null) status = cur < (z.staffTargetMin ?? 0) ? 'understaffed' : (z.staffTargetMax !== null && cur > z.staffTargetMax ? 'over' : 'ok');
    return { zoneId: z.id, label: z.label, zoneType: z.zoneType, current: cur, avg, targetMin: z.staffTargetMin, targetMax: z.staffTargetMax, coveragePct: s.length ? pct(zm / s.length) : null, status };
  });
  return { value: total ? pct(met / total) : null, needs: null, estimate: true, peakPct: pTotal ? pct(pMet / pTotal) : null, zones };
}

export interface UtilZone { zoneId: string; label: string; zoneType: ZoneType; current: number | null; capacity: number; currentPct: number | null; avgPct: number | null; peakPct: number | null }
export interface UtilResult extends Computed { currentPct: number | null; peakPct: number | null; zones: UtilZone[]; series: Array<{ at: Date; pct: number }> }

export function computeUtilization(ctx: Ctx, types: ZoneType[]): UtilResult {
  const zs = customerZones(ctx, z => types.includes(z.zoneType) && (z.capacity ?? 0) > 0);
  if (!zs.length) return { value: null, needs: NEEDS(`a ${typeNames(types)} area with a seat count`), currentPct: null, peakPct: null, zones: [], series: [] };
  const series: Array<{ at: Date; pct: number }> = [];
  for (const r of ctx.rounds) {
    let cap = 0, n = 0;
    for (const z of zs) if (r.byZone.has(z.id)) { cap += z.capacity!; n += r.byZone.get(z.id)!; }
    if (cap > 0) series.push({ at: r.at, pct: Math.min(1, n / cap) });
  }
  const zones = zs.map(z => {
    const s = seriesFor(ctx, [z]);
    const l = latest(ctx, s);
    const ps = s.map(p => Math.min(1, p.total / z.capacity!));
    return {
      zoneId: z.id, label: z.label, zoneType: z.zoneType, current: l.value, capacity: z.capacity!,
      currentPct: l.value === null ? null : pct(Math.min(1, l.value / z.capacity!)), avgPct: pct(mean(ps)), peakPct: ps.length ? pct(Math.max(...ps)) : null,
    };
  });
  const l = series.length && !(ctx.live && !ctx.fresh) ? series[series.length - 1].pct : null;
  return { value: pct(mean(series.map(s => s.pct))), needs: null, currentPct: pct(l), peakPct: series.length ? pct(Math.max(...series.map(s => s.pct))) : null, zones, series };
}

// ---------------------------------------------------------------------------------------------
// Flow funnel
// ---------------------------------------------------------------------------------------------

export interface FlowStageValue { key: string; label: string; count: number | null; pct: number | null; needs: string | null; estimate: boolean }

export function computeFlow(ctx: Ctx, exitedEstimate: Computed, entered?: Computed): FlowStageValue[] {
  const stages: FlowStageValue[] = ctx.cfg.flow.map(st => {
    if (st.key === 'entered' && entered && !entered.needs) {
      return { key: st.key, label: st.label, count: entered.value, pct: null, needs: null, estimate: false };
    }
    const zs = customerZones(ctx, ofTypes(st.zoneTypes));
    if (!zs.length) {
      if (st.key === 'exited' && exitedEstimate.value !== null) {
        return { key: st.key, label: st.label, count: exitedEstimate.value, pct: null, needs: null, estimate: !!exitedEstimate.estimate };
      }
      return { key: st.key, label: st.label, count: null, pct: null, needs: NEEDS(`a ${typeNames(st.zoneTypes)} area`), estimate: false };
    }
    const minSec = st.minSecondsFrom ? Number(ctx.cfg.thresholds[st.minSecondsFrom]) : 0;
    const tracked = zoneTracks(ctx, zs).filter(t => presenceSeconds(t, ctx.interval) >= minSec).length;
    // A person flickering in and out of detection splits into several tracks; never count more than the people seen arriving there.
    const n = Math.min(tracked, computeArrivals(ctx, zs, isTransit(zs)).reduce((a, e) => a + e.n, 0));
    return { key: st.key, label: st.label, count: ctx.rounds.length ? n : null, pct: null, needs: null, estimate: false };
  });
  const base = stages.find(s => s.count !== null && s.count > 0);
  for (const s of stages) if (s.count !== null && base) s.pct = Math.min(100, Math.round((s.count / base.count!) * 100)); // later stages can out-count a missed entrance; never show >100%
  return stages;
}

export function computeFlowScore(wait: WaitResult | null, waitTarget: number, walk: WalkawayResult | null, coverage: CoverageResult | null): { value: number | null; parts: Array<{ name: string; score: number; weight: number }> } {
  const parts: Array<{ name: string; score: number; weight: number }> = [];
  if (wait && wait.value !== null && wait.n > 0) {
    const over = Math.max(0, wait.value - waitTarget) / waitTarget;
    parts.push({ name: 'Wait vs target', score: Math.max(0, Math.min(100, 100 * (1 - over))), weight: 0.4 });
  }
  if (walk && walk.value !== null && walk.queuers > 0) {
    parts.push({ name: 'Walkaway rate', score: Math.max(0, 100 * (1 - 2 * (walk.value / walk.queuers))), weight: 0.3 });
  }
  if (coverage && coverage.value !== null) parts.push({ name: 'Counter staffing', score: coverage.value, weight: 0.3 });
  if (!parts.length) return { value: null, parts };
  const w = parts.reduce((a, p) => a + p.weight, 0);
  return { value: Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / w), parts };
}

// ---------------------------------------------------------------------------------------------
// Time buckets & sustained windows
// ---------------------------------------------------------------------------------------------

export interface Bucket { start: Date; end: Date; label: string; hour: number | null }

export function hourBuckets(ctx: Ctx, singleDay: boolean, hours: HoursFilter): Bucket[] {
  const tz = ctx.cfg.timezone;
  if (!singleDay) {
    const out: Bucket[] = [];
    let d = startOfLocalDay(ctx.start, tz);
    while (d < ctx.end) {
      const next = addLocalDays(d, 1, tz);
      const p = tzParts(new Date(d.getTime() + 3600_000), tz);
      out.push({ start: d, end: next, label: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.dow]} ${p.month}/${p.day}`, hour: null });
      d = next;
    }
    return out;
  }
  let from = 0, to = 24;
  if (hours.mode === 'custom') { from = hours.fromHour; to = hours.toHour > hours.fromHour ? hours.toHour : 24; }
  else {
    const w = openWindowHours(ctx.start, tz, ctx.cfg.operatingHours);
    if (w && (hours.mode === 'open' || ctx.cfg.operatingHours)) { from = w.from; to = w.to; }
  }
  const day = startOfLocalDay(ctx.start, tz);
  const p = tzParts(new Date(day.getTime() + 3600_000), tz);
  const out: Bucket[] = [];
  for (let h = from; h < to; h++) {
    const start = zonedToUtc(p.year, p.month, p.day, h, 0, tz);
    out.push({ start, end: zonedToUtc(p.year, p.month, p.day, h + 1 > 23 ? 23 : h + 1, h + 1 > 23 ? 59 : 0, tz), label: hourLabel(h), hour: h });
    if (h === 23) out[out.length - 1].end = addLocalDays(day, 1, tz);
  }
  return out;
}

export interface Window { start: Date; end: Date; peak: number; peakAt: Date; avg: number; minutes: number }

/** Contiguous runs of rounds where pred(total) holds, lasting at least minMinutes. A gap of more than 2.5 intervals breaks a run. */
export function sustainedWindows(series: Array<{ at: Date; total: number }>, pred: (v: number) => boolean, minMinutes: number, intervalSec: number): Window[] {
  const out: Window[] = [];
  let run: Array<{ at: Date; total: number }> = [];
  const flush = () => {
    if (!run.length) return;
    const start = run[0].at, end = new Date(run[run.length - 1].at.getTime() + intervalSec * 1000);
    const minutes = (end.getTime() - start.getTime()) / 60000;
    if (minutes >= minMinutes) {
      let pk = run[0];
      for (const r of run) if (r.total > pk.total) pk = r;
      out.push({ start, end, peak: pk.total, peakAt: pk.at, avg: mean(run.map(r => r.total))!, minutes: Math.round(minutes) });
    }
    run = [];
  };
  for (const p of series) {
    const prev = run[run.length - 1];
    if (prev && p.at.getTime() - prev.at.getTime() > intervalSec * 2500) flush();
    if (pred(p.total)) run.push(p); else flush();
  }
  flush();
  return out;
}

export function fmtRange(w: { start: Date; end: Date }, tz: string, withDate = false): string {
  if (!withDate) return `${fmtTime(w.start, tz)} – ${fmtTime(w.end, tz)}`;
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'numeric', day: 'numeric' });
  const same = day(w.start) === day(w.end);
  return same ? `${day(w.start)} ${fmtTime(w.start, tz)} – ${fmtTime(w.end, tz)}` : `${day(w.start)} ${fmtTime(w.start, tz)} – ${day(w.end)} ${fmtTime(w.end, tz)}`;
}

export { fmtDuration, fmtTime, localDateKey, pct, round1, mean };
