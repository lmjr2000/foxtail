/**
 * Assemble one store's dashboard payload for a range from real samples (carried over from Eye of Omni).
 * Pure: no I/O. The caller loads samples and passes them in; tests call this directly.
 */
import { ZONE_TYPE_DEFS, type MetricDef, type ResolvedMetric, type ZoneType } from '@foxtail/shared';
import {
  buildCtx, computeEntered, computeOccupancy, computeExited, computeZoneCount, computeWait, computeWalkaways,
  computeCoverage, computeUtilization, computeFlow, computeFlowScore, hourBuckets,
  seriesFor, customerZones, staffZones, zoneRole, mean, round1, fmtDuration, fmtTime, localDateKey,
  type Ctx, type EngineInput, type MetricValue, type Computed, type WaitResult, type WalkawayResult,
  type FlowStageValue, type CoverageZone, type UtilZone,
} from './engine.js';
import { runRules, peakWindows, type HourValue, type Moment, type Insight, type Recommendation } from './rules.js';
import { hourLabel, tzParts, zonedToUtc } from './time.js';

export interface InsightsResult {
  generatedAt: string;
  timezone: string;
  range: { start: string; end: string; label: string; singleDay: boolean };
  compare: { start: string; end: string; label: string } | null;
  dataStatus: {
    configured: boolean; zonesTotal: number; zonesMeasurable: number; samplingEnabled: boolean;
    rounds: number; lastRoundAt: string | null; fresh: boolean; hasData: boolean;
    /** The period runs up to now ("today"). Past periods show end-of-period values instead of "now". */
    live: boolean;
  };
  kpis: MetricValue[];
  metrics: Record<string, MetricValue>;
  chart: {
    granularity: 'hour' | 'day';
    buckets: Array<HourValue & { compareEntered: number | null }>;
    has: { entered: boolean; occupancy: boolean; wait: boolean };
    waitLabel: string;
    needs: string | null;
  };
  queue: {
    available: boolean; needs: string | null; label: string; current: number | null; status: 'Normal' | 'Busy' | 'Long' | null;
    avg: number | null; avgCompare: number | null; peak: number | null; peakAt: string | null;
    avgWait: number | null; avgWaitCompare: number | null; longestWait: number | null; longestAt: string | null; waitN: number;
    walkaways: number | null; walkawaysCompare: number | null; walkawaysNeeds: string | null; queuers: number; threshold: number;
  };
  pickup: { available: boolean; needs: string | null; current: number | null; avgWait: number | null; longest: number | null; n: number; overTarget: number; target: number; coveragePct: number | null };
  staffing: { available: boolean; needs: string | null; estimate: true; zones: CoverageZone[]; coveragePct: number | null; peakPct: number | null; alert: { title: string; detail: string; timeLabel: string } | null };
  utilization: { available: boolean; needs: string | null; zones: UtilZone[]; avgPct: number | null; currentPct: number | null; overallOccupancy: number | null };
  flow: { stages: FlowStageValue[]; score: number | null; scoreCompare: number | null; scoreParts: Array<{ name: string; score: number; weight: number }> };
  keyMoments: Moment[];
  insights: Insight[];
  recommendations: Recommendation[];
  /** Local hour of day (0-23) over the whole range; only hours that had camera samples. */
  hourOfDay: HourOfDay[];
  /** Customers entered per local clock hour (hours with samples only), for matching POS hours. */
  enteredByHour: Array<{ hourAt: string; entered: number }>;
  notes: string[];
}

export interface HourOfDay {
  hour: number; label: string; days: number; rounds: number;
  entered: number | null; waitAvgSeconds: number | null; waitN: number; lineAvg: number | null; linePeak: number | null;
  counterStaffAvg: number | null; counterCoveragePct: number | null;
}

type Cache = Map<string, Computed>;

export function fmtValue(unit: MetricDef['unit'], v: number | null): string {
  if (v === null) return '—';
  switch (unit) {
    case 'seconds': return fmtDuration(v);
    case 'percent': return `${Math.round(v)}%`;
    default: return String(Math.round(v));
  }
}

interface PeriodCalc {
  ctx: Ctx;
  cache: Cache;
  entered: ReturnType<typeof computeEntered>;
  occ: ReturnType<typeof computeOccupancy>;
  exited: Computed;
  walk: WalkawayResult;
  peaks: Array<{ start: Date; end: Date }>;
  hourly: HourValue[];
}

function primaryMetric(cfg: Ctx['cfg'], kind: string): ResolvedMetric | null {
  return cfg.kpis.find(m => m.def.calc.kind === kind) || cfg.metrics.find(m => m.def.calc.kind === kind) || null;
}

function calcMetric(def: MetricDef, p: PeriodCalc, flowScore: () => Computed): Computed {
  const c = def.calc;
  const key = JSON.stringify(c);
  if (p.cache.has(key)) return p.cache.get(key)!;
  let out: Computed;
  const t = p.ctx.cfg.thresholds;
  switch (c.kind) {
    case 'entered': out = p.entered; break;
    case 'exited': out = p.exited; break;
    case 'occupancy': out = p.occ.current; break;
    case 'peakOccupancy': out = p.occ.peak; break;
    case 'zoneCount': out = computeZoneCount(p.ctx, c.zoneTypes); break;
    case 'wait': {
      const isPickup = c.zoneTypes.every(z => ZONE_TYPE_DEFS[z].role === 'pickup');
      out = computeWait(p.ctx, c.zoneTypes, isPickup ? t.pickupTargetSeconds : t.waitTargetSeconds);
      break;
    }
    case 'walkaways': out = p.walk; break;
    case 'coverage': {
      const cov = computeCoverage(p.ctx, c.zoneTypes, p.peaks);
      const word = cov.peakPct === null ? null : cov.peakPct < 70 ? 'Low' : cov.peakPct < 90 ? 'Fair' : 'Good';
      out = { ...cov, sub: cov.peakPct !== null && p.peaks.length ? `${word} during the rush (${fmtTime(p.peaks[0].start, p.ctx.cfg.timezone)}–${fmtTime(p.peaks[0].end, p.ctx.cfg.timezone)}): ${Math.round(cov.peakPct)}%` : cov.value !== null ? 'Estimate: people seen in staff areas' : null };
      break;
    }
    case 'utilization': {
      const u = computeUtilization(p.ctx, c.zoneTypes);
      const seats = u.zones.reduce((a, z) => a + z.capacity, 0);
      const now = u.zones.reduce((a, z) => a + (z.current ?? 0), 0);
      out = { ...u, sub: u.zones.length && u.currentPct !== null ? `Now ${now} / ${seats} (${Math.round(u.currentPct)}%)` : null };
      break;
    }
    case 'flowScore': out = flowScore(); break;
    default: out = { value: null, needs: 'Not available' };
  }
  p.cache.set(key, out);
  return out;
}

function buildHourly(p: Omit<PeriodCalc, 'hourly' | 'peaks'>, singleDay: boolean, input: EngineInput, waitTypes: ZoneType[] | null, queueTypes: ZoneType[] | null): HourValue[] {
  const ctx = p.ctx;
  const buckets = hourBuckets(ctx, singleDay, input.hours);
  const occSeries = p.occ.series;
  const queueSeries = queueTypes ? seriesFor(ctx, customerZones(ctx, z => queueTypes.includes(z.zoneType))) : [];
  const counterStaff = seriesFor(ctx, staffZones(ctx, z => zoneRole(z) === 'service'));
  const staffS = counterStaff.length ? counterStaff : seriesFor(ctx, staffZones(ctx));
  const waits = waitTypes ? computeWait(ctx, waitTypes, ctx.cfg.thresholds.waitTargetSeconds).durations : [];
  const hasEntry = p.entered.value !== null;
  return buckets.map(b => {
    const inB = <T extends { at: Date }>(xs: T[]) => xs.filter(x => x.at >= b.start && x.at < b.end);
    const occ = inB(occSeries).map(x => x.total);
    const qv = inB(queueSeries).map(x => x.total);
    const st = inB(staffS).map(x => x.total);
    const w = waits.filter(d => d.start >= b.start && d.start < b.end).map(d => d.seconds);
    const anyRound = ctx.rounds.some(r => r.at >= b.start && r.at < b.end);
    return {
      label: b.label, hour: b.hour, start: b.start, end: b.end,
      entered: hasEntry && anyRound ? p.entered.tracks.filter(t => t.start >= b.start && t.start < b.end).length : null,
      occupancyAvg: round1(mean(occ)), occupancyPeak: occ.length ? Math.max(...occ) : null,
      waitAvgSeconds: w.length ? Math.round(mean(w)!) : null,
      queueAvg: round1(mean(qv)), staffAvg: round1(mean(st)), queuePeak: qv.length ? Math.max(...qv) : null,
      walkaways: p.walk.value === null || !anyRound ? null : p.walk.events.filter(e => e.at >= b.start && e.at < b.end).length,
    };
  });
}

/** Hour-of-day profile and per-clock-hour entered counts for the whole range. */
function byHour(p: Omit<PeriodCalc, 'hourly' | 'peaks'>, waitTypes: ZoneType[] | null): { hourOfDay: HourOfDay[]; enteredByHour: Array<{ hourAt: string; entered: number }> } {
  const ctx = p.ctx;
  const tz = ctx.cfg.timezone;
  const hourStart = (d: Date) => { const x = tzParts(d, tz); return zonedToUtc(x.year, x.month, x.day, x.hour, 0, tz).getTime(); };
  const hourOf = (d: Date) => tzParts(d, tz).hour;
  type Acc = { days: Set<string>; rounds: number; entered: number; waits: number[]; line: number[]; staff: number[]; covMet: number; covN: number };
  const acc = new Map<number, Acc>();
  const get = (h: number) => { let a = acc.get(h); if (!a) { a = { days: new Set(), rounds: 0, entered: 0, waits: [], line: [], staff: [], covMet: 0, covN: 0 }; acc.set(h, a); } return a; };
  const clockHours = new Map<number, number>();
  for (const r of ctx.rounds) {
    const a = get(hourOf(r.at));
    a.rounds++;
    a.days.add(localDateKey(r.at, tz));
    clockHours.set(hourStart(r.at), clockHours.get(hourStart(r.at)) ?? 0);
  }
  const hasEntry = p.entered.value !== null;
  if (hasEntry) for (const t of p.entered.tracks) {
    const k = hourStart(t.start);
    if (clockHours.has(k)) clockHours.set(k, clockHours.get(k)! + 1);
    get(hourOf(t.start)).entered++;
  }
  if (waitTypes) for (const d of computeWait(ctx, waitTypes, ctx.cfg.thresholds.waitTargetSeconds).durations) get(hourOf(d.start)).waits.push(d.seconds);
  for (const s of seriesFor(ctx, customerZones(ctx, z => z.zoneType === 'QUEUE'))) get(hourOf(s.at)).line.push(s.total);
  const counter = staffZones(ctx, z => zoneRole(z) === 'service');
  for (const s of seriesFor(ctx, counter)) get(hourOf(s.at)).staff.push(s.total);
  const targets = counter.filter(z => (z.staffTargetMin ?? 0) > 0);
  for (const z of targets) for (const s of seriesFor(ctx, [z])) { const a = get(hourOf(s.at)); a.covN++; if (s.total >= (z.staffTargetMin ?? 0)) a.covMet++; }
  const hourOfDay: HourOfDay[] = [...acc.entries()].filter(([, a]) => a.rounds > 0).sort((x, y) => x[0] - y[0]).map(([h, a]) => ({
    hour: h, label: hourLabel(h), days: a.days.size, rounds: a.rounds,
    entered: hasEntry ? a.entered : null,
    waitAvgSeconds: a.waits.length ? Math.round(mean(a.waits)!) : null, waitN: a.waits.length,
    lineAvg: round1(mean(a.line)), linePeak: a.line.length ? Math.max(...a.line) : null,
    counterStaffAvg: round1(mean(a.staff)), counterCoveragePct: a.covN ? Math.round((a.covMet / a.covN) * 1000) / 10 : null,
  }));
  const enteredByHour = hasEntry ? [...clockHours.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ hourAt: new Date(t).toISOString(), entered: n })) : [];
  return { hourOfDay, enteredByHour };
}

function period(input: EngineInput, ctx: Ctx, singleDay: boolean, waitTypes: ZoneType[] | null, queueTypes: ZoneType[] | null): PeriodCalc {
  const entered = computeEntered(ctx);
  const occ = computeOccupancy(ctx);
  const exited = computeExited(ctx, entered, occ.current.value, occ.series.length ? occ.series[occ.series.length - 1].total : null);
  const walk = computeWalkaways(ctx);
  const partial = { ctx, cache: new Map() as Cache, entered, occ, exited, walk };
  const hourly = buildHourly(partial, singleDay, input, waitTypes, queueTypes);
  return { ...partial, hourly, peaks: peakWindows(hourly) };
}

export function computeInsights(input: EngineInput): InsightsResult {
  const cfg = input.config;
  const tz = cfg.timezone;
  const ctx = buildCtx(cfg, input.zones, input.samples, input.range.start, input.range.end, input.hours, input.now);
  const cmpCtx = input.compare ? buildCtx(cfg, input.zones, input.compareSamples, input.compare.start, input.compare.end, input.hours, input.now) : null;
  const cmpHas = !!cmpCtx && cmpCtx.rounds.length > 0;

  const waitM = primaryMetric(cfg, 'wait');
  const queueM = primaryMetric(cfg, 'zoneCount');
  const waitTypes = waitM && waitM.def.calc.kind === 'wait' ? waitM.def.calc.zoneTypes : null;
  const queueTypes = queueM && queueM.def.calc.kind === 'zoneCount' ? queueM.def.calc.zoneTypes : null;
  const cur = period(input, ctx, input.range.singleDay, waitTypes, queueTypes);
  const cmp = cmpCtx ? period(input, cmpCtx, input.range.singleDay, waitTypes, queueTypes) : null;

  const coverageM = primaryMetric(cfg, 'coverage');
  const covTypes = coverageM && coverageM.def.calc.kind === 'coverage' ? coverageM.def.calc.zoneTypes : 'all';
  const flowScoreFor = (p: PeriodCalc) => () => {
    const w = waitTypes ? (calcMetric(waitM!.def, p, () => ({ value: null, needs: null })) as WaitResult) : null;
    const cov = computeCoverage(p.ctx, covTypes, p.peaks);
    const fs = computeFlowScore(w, cfg.thresholds.waitTargetSeconds, p.walk.value !== null ? p.walk : null, cov.value !== null ? cov : null);
    return { value: fs.value, needs: fs.value === null ? 'Set up line, register and staff areas to see this' : null, extra: { parts: fs.parts } } as Computed;
  };

  const toValue = (m: ResolvedMetric): MetricValue => {
    const a = calcMetric(m.def, cur, flowScoreFor(cur));
    const b = cmp ? calcMetric(m.def, cmp, flowScoreFor(cmp)) : null;
    const value = a.value === null ? null : Math.round(a.value * 10) / 10;
    const compare = b && b.value !== null && cmpHas ? b.value : null;
    let deltaPct: number | null = null, direction: MetricValue['direction'] = null, good: boolean | null = null;
    if (value !== null && compare !== null) {
      if (compare !== 0) deltaPct = Math.round(((value - compare) / Math.abs(compare)) * 100);
      direction = value > compare ? 'up' : value < compare ? 'down' : 'flat';
      if (direction !== 'flat' && m.def.betterWhen !== 'neutral') good = (direction === 'up') === (m.def.betterWhen === 'higher');
    }
    const status: MetricValue['status'] = a.needs ? 'needs_zones' : value === null ? 'no_data' : 'ok';
    // "Right now" numbers for a past period are the last sample of that period.
    const pointInTime = m.def.calc.kind === 'zoneCount' || m.def.calc.kind === 'occupancy';
    const label = pointInTime && !ctx.live ? m.label.replace(/\s*(Right Now|Now)$/i, ' at Closing') : m.label;
    return {
      key: m.key, label, unit: m.def.unit, value, display: fmtValue(m.def.unit, value), compare,
      compareDisplay: compare === null ? null : fmtValue(m.def.unit, compare), deltaPct, direction, good, status,
      needs: a.needs ?? (value === null ? (cfg.samplingEnabled ? 'No camera samples in this period yet' : 'Counting is turned off for this store') : null),
      estimate: !!a.estimate, sub: a.sub ?? null,
    };
  };

  const metrics: Record<string, MetricValue> = {};
  for (const m of [...cfg.metrics, ...cfg.kpis]) if (!metrics[m.key]) metrics[m.key] = toValue(m);
  const kpis = cfg.kpis.map(m => metrics[m.key] ?? toValue(m));

  // Queue card -------------------------------------------------------------------------------
  const lineTypes: ZoneType[] = ['QUEUE'];
  const qc = computeZoneCount(ctx, lineTypes);
  const qcCmp = cmpCtx ? computeZoneCount(cmpCtx, lineTypes) : null;
  const qWait = computeWait(ctx, lineTypes, cfg.thresholds.waitTargetSeconds);
  const qWaitCmp = cmpCtx ? computeWait(cmpCtx, lineTypes, cfg.thresholds.waitTargetSeconds) : null;
  const thr = cfg.thresholds.queueAlertSize;
  const queue: InsightsResult['queue'] = {
    available: !qc.needs, needs: qc.needs, label: cfg.terms.queue, current: qc.value,
    status: qc.value === null ? null : qc.value >= thr ? 'Long' : qc.value >= Math.ceil(thr / 2) ? 'Busy' : 'Normal',
    avg: qc.avg, avgCompare: qcCmp && cmpHas ? qcCmp.avg : null, peak: qc.peak, peakAt: qc.peakAt ? fmtTime(qc.peakAt, tz) : null,
    avgWait: qWait.value, avgWaitCompare: qWaitCmp && cmpHas ? qWaitCmp.value : null, longestWait: qWait.longest, longestAt: qWait.longestAt ? fmtTime(qWait.longestAt, tz) : null, waitN: qWait.n,
    walkaways: cur.walk.value, walkawaysCompare: cmp && cmpHas ? cmp.walk.value : null, walkawaysNeeds: cur.walk.needs, queuers: cur.walk.queuers, threshold: thr,
  };

  // Pickup card ------------------------------------------------------------------------------
  const pkCount = computeZoneCount(ctx, ['PICKUP']);
  const pkWait = computeWait(ctx, ['PICKUP'], cfg.thresholds.pickupTargetSeconds);
  const pkCov = computeCoverage(ctx, ['PICKUP'], cur.peaks);
  const pickup: InsightsResult['pickup'] = { available: !pkCount.needs, needs: pkCount.needs, current: pkCount.value, avgWait: pkWait.value, longest: pkWait.longest, n: pkWait.n, overTarget: pkWait.overTarget, target: cfg.thresholds.pickupTargetSeconds, coveragePct: pkCov.value };

  // Staffing card ----------------------------------------------------------------------------
  const covAll = computeCoverage(ctx, 'all', cur.peaks);
  const allStaff = staffZones(ctx);
  const staffZonesCov: CoverageZone[] = allStaff.map(z => covAll.zones.find(c => c.zoneId === z.id) || (() => {
    const s = seriesFor(ctx, [z]);
    const last = s.length && !(ctx.live && !ctx.fresh) ? s[s.length - 1].total : null;
    return { zoneId: z.id, label: z.label, zoneType: z.zoneType, current: last, avg: round1(mean(s.map(x => x.total))), targetMin: z.staffTargetMin, targetMax: z.staffTargetMax, coveragePct: null, status: 'unknown' as const };
  })());

  // Seating card -----------------------------------------------------------------------------
  const seatTypes = cfg.zoneTypes.filter(t => ZONE_TYPE_DEFS[t].hasCapacity);
  const util = computeUtilization(ctx, seatTypes);

  // Rules ------------------------------------------------------------------------------------
  const frontTypes = covTypes === 'all' ? null : covTypes;
  const frontZones = allStaff.filter(z => !frontTypes || frontTypes.includes(z.zoneType));
  const queueZonesForRules = customerZones(ctx, z => (queueTypes || ['QUEUE']).includes(z.zoneType));
  const ruleOut = runRules({
    ctx, cmp: cmpCtx, compareLabel: input.compare?.label ?? null, hourly: cur.hourly, cmpHourly: cmp?.hourly ?? null,
    entered: cur.entered.value, cmpEntered: cmp && cmpHas ? cmp.entered.value : null,
    wait: waitTypes ? computeWait(ctx, waitTypes, cfg.thresholds.waitTargetSeconds) : null, waitLabel: waitM?.label || 'Average Wait',
    queueSeries: queueTypes ? seriesFor(ctx, queueZonesForRules) : [], queueZones: queueZonesForRules, walk: cur.walk.value !== null ? cur.walk : null,
    pickupSeries: seriesFor(ctx, customerZones(ctx, z => zoneRole(z) === 'pickup')), pickupWait: pkWait.needs ? null : pkWait,
    frontCoverage: computeCoverage(ctx, covTypes, cur.peaks), frontZones,
    util: util.needs ? null : util,
  });
  const u0 = ruleOut.understaffed[0];
  const staffing: InsightsResult['staffing'] = {
    available: allStaff.length > 0, needs: allStaff.length ? null : 'Set up a staff-side area (behind the counter, back of house) to see this',
    estimate: true, zones: staffZonesCov, coveragePct: covAll.value, peakPct: covAll.peakPct,
    alert: u0 ? { title: 'Understaffed during the rush', timeLabel: `${fmtTime(u0.window.start, tz)} – ${fmtTime(u0.window.end, tz)}`, detail: ruleOut.moments.find(m => m.rule === 'understaffedPeak')?.detail || '' } : null,
  };

  const flowStages = computeFlow(ctx, cur.exited, cur.entered);
  const fs = flowScoreFor(cur)();
  const fsCmp = cmp && cmpHas ? flowScoreFor(cmp)() : null;

  const notes: string[] = [
    `Counts come from person detection on camera snapshots taken every ${cfg.sampleIntervalSeconds}s, assigned to the areas drawn on each camera. Times are accurate to about ± one sampling interval.`,
    'Staffing is an estimate: people seen in staff-side areas. There is no employee identification.',
    'Walkaways are likely, not certain: someone waited in the line area, then was not seen at the register within the window.',
  ];
  if (!cur.exited.needs && cur.exited.estimate) notes.push('Customers exited is estimated (entered minus still inside) because there is no separate Exit area.');
  if (cur.entered.extra && typeof cur.entered.extra.seenInside === 'number') notes.push(`Entered uses people first seen inside (${cur.entered.extra.seenInside}) because the entrance area caught fewer (${cur.entered.extra.doorCount}). People seen in only one snapshot are not counted, so this is a floor.`);

  return {
    generatedAt: input.now.toISOString(),
    timezone: tz,
    range: { start: input.range.start.toISOString(), end: input.range.end.toISOString(), label: input.range.label, singleDay: input.range.singleDay },
    compare: input.compare ? { start: input.compare.start.toISOString(), end: input.compare.end.toISOString(), label: input.compare.label } : null,
    dataStatus: {
      configured: cfg.configured, zonesTotal: input.zones.length, zonesMeasurable: ctx.zones.length, samplingEnabled: cfg.samplingEnabled,
      rounds: ctx.rounds.length, lastRoundAt: ctx.lastRoundAt?.toISOString() ?? null, fresh: ctx.fresh, hasData: ctx.rounds.length > 0, live: ctx.live,
    },
    kpis,
    metrics,
    chart: {
      granularity: input.range.singleDay ? 'hour' : 'day',
      buckets: cur.hourly.map((h, i) => ({ ...h, compareEntered: cmp && cmp.hourly[i] && cmpHas ? cmp.hourly[i].entered : null })),
      has: { entered: cur.entered.value !== null, occupancy: cur.occ.series.length > 0, wait: !!waitTypes && customerZones(ctx, z => waitTypes.includes(z.zoneType)).length > 0 },
      waitLabel: waitM?.label || 'Average Wait',
      needs: ctx.zones.length ? null : 'Set up counting areas to see traffic and wait by hour',
    },
    queue,
    pickup,
    staffing,
    utilization: { available: !util.needs, needs: util.needs, zones: util.zones, avgPct: util.value, currentPct: util.currentPct, overallOccupancy: cur.occ.current.value },
    flow: { stages: flowStages, score: fs.value, scoreCompare: fsCmp?.value ?? null, scoreParts: (fs.extra?.parts as Array<{ name: string; score: number; weight: number }>) || [] },
    keyMoments: ruleOut.moments,
    insights: ruleOut.insights,
    recommendations: ruleOut.recommendations,
    ...byHour(cur, waitTypes),
    notes,
  };
}
