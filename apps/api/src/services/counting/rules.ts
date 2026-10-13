/**
 * Key moments, insights and recommendations (carried over from Eye of Omni, coffee-shop rules only).
 *
 * Every sentence here is built from a computed fact (a window of samples above a target, a staffing
 * shortfall, a comparison with the same weekday last week). Rules only run when the store's counting
 * profile enables them, and only when the areas behind the fact exist.
 */
import type { Rule, Zone } from '@foxtail/shared';
import {
  sustainedWindows, fmtRange as fmtRangeBase, fmtDuration, fmtTime, mean, customerZones, seriesFor, zoneRole,
  type Ctx, type WaitResult, type WalkawayResult, type CoverageResult, type UtilResult, type Window,
} from './engine.js';
import { isOpenAt } from './time.js';

export interface HourValue {
  label: string; hour: number | null; start: Date; end: Date;
  entered: number | null; occupancyAvg: number | null; occupancyPeak: number | null;
  waitAvgSeconds: number | null; queueAvg: number | null; staffAvg: number | null;
  queuePeak?: number | null; walkaways?: number | null;
}

export interface Moment {
  id: string; rule: Rule; start: Date; end: Date; timeLabel: string; title: string; detail: string;
  severity: 'high' | 'medium' | 'ok' | 'info'; zoneIds: string[];
}
export interface Insight { id: string; rule: Rule; tone: 'up' | 'down' | 'bad' | 'warn' | 'ok' | 'info'; text: string; basis: string }
export interface Recommendation { id: string; rule: Rule; text: string; basis: string }

export interface RuleInput {
  ctx: Ctx;
  cmp: Ctx | null;
  compareLabel: string | null;
  hourly: HourValue[];
  cmpHourly: HourValue[] | null;
  entered: number | null;
  cmpEntered: number | null;
  wait: WaitResult | null;
  waitLabel: string;
  queueSeries: Array<{ at: Date; total: number }>;
  queueZones: Zone[];
  walk: WalkawayResult | null;
  pickupSeries: Array<{ at: Date; total: number }>;
  pickupWait: WaitResult | null;
  frontCoverage: CoverageResult | null;
  frontZones: Zone[];
  util: UtilResult | null;
}

function on(r: RuleInput, rule: Rule): boolean { return r.ctx.cfg.rules.includes(rule); }

function waitsIn(wait: WaitResult | null, w: { start: Date; end: Date }): number | null {
  if (!wait) return null;
  const ds = wait.durations.filter(d => d.end >= w.start && d.start <= w.end).map(d => d.seconds);
  return ds.length ? mean(ds) : null;
}
function walksIn(walk: WalkawayResult | null, w: { start: Date; end: Date }): number {
  return walk ? walk.events.filter(e => e.at >= w.start && e.at <= new Date(w.end.getTime() + 60_000)).length : 0;
}

/** Busiest hours: the top hour and neighbours within 80% of it (by entered, or occupancy without an entrance area). */
export function peakWindows(hourly: HourValue[]): Array<{ start: Date; end: Date }> {
  const val = (h: HourValue) => h.entered ?? h.occupancyAvg ?? 0;
  const vals = hourly.map(val);
  const max = Math.max(0, ...vals);
  if (max <= 0) return [];
  const i = vals.indexOf(max);
  let a = i, b = i;
  while (a > 0 && vals[a - 1] >= max * 0.8) a--;
  while (b < vals.length - 1 && vals[b + 1] >= max * 0.8) b++;
  return [{ start: hourly[a].start, end: hourly[b].end }];
}

export function runRules(r: RuleInput): { moments: Moment[]; insights: Insight[]; recommendations: Recommendation[]; understaffed: Array<{ zone: Zone; window: Window; avgStaff: number; trafficPct: number | null }> } {
  const tz = r.ctx.cfg.timezone;
  const multiDay = r.ctx.end.getTime() - r.ctx.start.getTime() > 26 * 3600_000;
  const fmtRange = (w: { start: Date; end: Date }, z: string) => fmtRangeBase(w, z, multiDay);
  const t = r.ctx.cfg.thresholds;
  const terms = r.ctx.cfg.terms;
  const iv = r.ctx.interval;
  const moments: Moment[] = [];
  const insights: Insight[] = [];
  const recs: Recommendation[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const lowerCustomers = terms.customers.toLowerCase();
  const waitWord = r.waitLabel.replace(/^(average|avg\.?)\s+/i, '').toLowerCase();

  // --- Line held above target -----------------------------------------------------------------
  const longLines = r.queueSeries.length ? sustainedWindows(r.queueSeries, v => v >= t.queueAlertSize, t.queueAlertMinutes, iv) : [];
  if (on(r, 'queueSustained')) {
    for (const w of longLines) {
      const aw = waitsIn(r.wait, w);
      const wk = walksIn(r.walk, w);
      moments.push({
        id: id('line'), rule: 'queueSustained', start: w.start, end: w.end, timeLabel: fmtRange(w, tz),
        title: `Long ${terms.queue.toLowerCase()}`,
        detail: [`Up to ${w.peak} ${lowerCustomers} waiting`, aw !== null ? `average ${waitWord} ${fmtDuration(aw)}` : null, wk ? `${wk} likely walkaway${wk === 1 ? '' : 's'}` : null].filter(Boolean).join('. ') + '.',
        severity: 'high', zoneIds: r.queueZones.map(z => z.id),
      });
    }
    if (longLines.length) {
      const mins = longLines.reduce((a, w) => a + w.minutes, 0);
      const pk = Math.max(...longLines.map(w => w.peak));
      insights.push({ id: id('ins'), rule: 'queueSustained', tone: 'bad', text: `${terms.queue} reached ${pk} ${lowerCustomers} and stayed at ${t.queueAlertSize}+ for ${mins} minutes in total.`, basis: `${longLines.length} window(s) with ${t.queueAlertSize}+ people for at least ${t.queueAlertMinutes} minutes.` });
    }
  }

  // --- Average wait vs target -----------------------------------------------------------------
  if (on(r, 'longWait') && r.wait && r.wait.value !== null && r.wait.n >= 3 && r.wait.value > t.waitTargetSeconds) {
    insights.push({ id: id('ins'), rule: 'longWait', tone: 'warn', text: `Average ${waitWord} was ${fmtDuration(r.wait.value)}, above the ${fmtDuration(t.waitTargetSeconds)} target (${r.wait.overTarget} of ${r.wait.n} waited longer).`, basis: `${r.wait.n} measured waits.` });
  }

  // --- Walkaways ------------------------------------------------------------------------------
  if (on(r, 'walkawaysHigh') && r.walk && r.walk.value !== null && r.walk.value >= 3 && r.walk.queuers > 0) {
    const rate = Math.round((r.walk.value / r.walk.queuers) * 100);
    if (rate >= 10) {
      insights.push({ id: id('ins'), rule: 'walkawaysHigh', tone: 'bad', text: `${r.walk.value} ${lowerCustomers} (${rate}% of those who waited) left before reaching the ${terms.servicePoint.toLowerCase()}.`, basis: `Waited at least ${t.walkawayMinQueueSeconds}s, then not seen at the ${terms.servicePoint.toLowerCase()} within ${fmtDuration(t.walkawayWindowSeconds)}.` });
      if (longLines.length) {
        recs.push({ id: id('rec'), rule: 'walkawaysHigh', text: `Open a second ${terms.servicePoint.toLowerCase()} or send someone down the line when it passes ${t.queueAlertSize} ${lowerCustomers}.`, basis: `${r.walk.value} walkaways, ${longLines.length} long-line window(s).` });
      }
    }
  }

  // --- Understaffed during busy periods -------------------------------------------------------
  const understaffed: Array<{ zone: Zone; window: Window; avgStaff: number; trafficPct: number | null }> = [];
  const peaks = peakWindows(r.hourly);
  const avgEnteredPerHour = mean(r.hourly.filter(h => (h.entered ?? 0) > 0).map(h => h.entered!));
  if (on(r, 'understaffedPeak')) {
    for (const z of r.frontZones.filter(zz => (zz.staffTargetMin ?? 0) > 0)) {
      const s = seriesFor(r.ctx, [z]);
      const wins = sustainedWindows(s, v => v < (z.staffTargetMin ?? 0), t.understaffedMinutes, iv);
      for (const w of wins) {
        const busy = longLines.some(l => l.start < w.end && l.end > w.start) || peaks.some(p => p.start < w.end && p.end > w.start);
        if (!busy) continue;
        const hrs = r.hourly.filter(h => h.start < w.end && h.end > w.start && h.entered !== null);
        const trafficInWin = hrs.length ? mean(hrs.map(h => h.entered!)) : null;
        const trafficPct = trafficInWin !== null && avgEnteredPerHour ? Math.round(((trafficInWin - avgEnteredPerHour) / avgEnteredPerHour) * 100) : null;
        understaffed.push({ zone: z, window: w, avgStaff: w.avg, trafficPct });
      }
    }
    for (const u of understaffed) {
      const shown = Math.round(u.avgStaff);
      moments.push({
        id: id('staff'), rule: 'understaffedPeak', start: u.window.start, end: u.window.end, timeLabel: fmtRange(u.window, tz),
        title: 'Understaffed during a busy period',
        detail: `${u.trafficPct !== null && u.trafficPct > 0 ? `Traffic was ${u.trafficPct}% above normal, but` : 'During a busy period'} ${shown === 0 ? 'no' : `only ${shown}`} ${shown === 1 ? terms.staff.toLowerCase() : terms.staffPlural.toLowerCase()} visible in ${u.zone.label} (target ${u.zone.staffTargetMin}${u.zone.staffTargetMax ? `–${u.zone.staffTargetMax}` : '+'}).`,
        severity: 'high', zoneIds: [u.zone.id],
      });
      const deficit = Math.max(1, Math.ceil((u.zone.staffTargetMin ?? 1) - u.avgStaff));
      const s = new Date(Math.floor(u.window.start.getTime() / 900_000) * 900_000 - 900_000);
      const e = new Date(Math.ceil(u.window.end.getTime() / 900_000) * 900_000 + 900_000);
      recs.push({
        id: id('rec'), rule: 'understaffedPeak',
        text: `Schedule ${deficit === 1 ? 'one' : deficit} more ${u.zone.label.toLowerCase()} ${deficit === 1 ? terms.staff.toLowerCase() : terms.staffPlural.toLowerCase()} between ${fmtTime(s, tz)} and ${fmtTime(e, tz)} to cut waits and serve more ${lowerCustomers}.`,
        basis: `${fmtRange(u.window, tz)}: average ${u.avgStaff.toFixed(1)} visible vs target ${u.zone.staffTargetMin}.`,
      });
    }
    if (r.frontCoverage && r.frontCoverage.peakPct !== null && peaks.length) {
      const targets = r.frontZones.filter(z => (z.staffTargetMin ?? 0) > 0);
      const inPeak = targets.flatMap(z => seriesFor(r.ctx, [z]).filter(p => peaks.some(w => p.at >= w.start && p.at < w.end)).map(p => ({ p, z })));
      if (inPeak.length) {
        const avgShort = mean(inPeak.map(({ p, z }) => Math.max(0, ((z.staffTargetMin ?? 0) - p.total) / (z.staffTargetMin ?? 1))));
        if (avgShort !== null && avgShort >= 0.15) {
          insights.push({ id: id('ins'), rule: 'understaffedPeak', tone: 'warn', text: `${targets.map(z => z.label).join(' + ')} staffing was ${Math.round(avgShort * 100)}% below target during ${multiDay ? 'the busiest hours' : `the rush (${fmtRange(peaks[0], tz)})`}.`, basis: 'People seen in staff-side areas vs the area targets (estimate; no employee identification).' });
        }
      }
    }
  }

  // --- Overstaffed in slow periods -----------------------------------------------------------
  if (on(r, 'overstaffedLowTraffic') && avgEnteredPerHour) {
    for (const z of r.frontZones.filter(zz => zz.staffTargetMax !== null)) {
      const s = seriesFor(r.ctx, [z]);
      const wins = sustainedWindows(s, v => v > (z.staffTargetMax ?? 99), 30, iv);
      for (const w of wins) {
        const hrs = r.hourly.filter(h => h.start < w.end && h.end > w.start && h.entered !== null);
        const traffic = hrs.length ? mean(hrs.map(h => h.entered!)) : null;
        if (traffic === null || traffic > avgEnteredPerHour * 0.5) continue;
        moments.push({ id: id('slow'), rule: 'overstaffedLowTraffic', start: w.start, end: w.end, timeLabel: fmtRange(w, tz), title: 'Slow period, many staff in front', detail: `Low ${lowerCustomers} traffic with ${Math.round(w.avg)} ${terms.staffPlural.toLowerCase()} in ${z.label}.`, severity: 'info', zoneIds: [z.id] });
        recs.push({ id: id('rec'), rule: 'overstaffedLowTraffic', text: `Move one ${terms.staff.toLowerCase()} from ${z.label} to prep or cleaning between ${fmtTime(w.start, tz)} and ${fmtTime(w.end, tz)}.`, basis: `Traffic ${Math.round(traffic)}/hr vs ${Math.round(avgEnteredPerHour)}/hr average; ${Math.round(w.avg)} in ${z.label} (max target ${z.staffTargetMax}).` });
      }
    }
  }

  // --- Strong flow ----------------------------------------------------------------------------
  if (on(r, 'strongFlow') && avgEnteredPerHour && r.wait) {
    for (const h of r.hourly) {
      if (h.entered === null || h.entered < avgEnteredPerHour * 1.2 || h.entered < 5) continue;
      const aw = waitsIn(r.wait, h);
      if (aw === null || aw > t.waitTargetSeconds) continue;
      moments.push({ id: id('flow'), rule: 'strongFlow', start: h.start, end: h.end, timeLabel: fmtRange(h, tz), title: 'Busy and moving well', detail: `${h.entered} ${lowerCustomers} in the hour and the ${waitWord} stayed under ${fmtDuration(t.waitTargetSeconds)} (avg ${fmtDuration(aw)}).`, severity: 'ok', zoneIds: [] });
    }
  }

  // --- Pickup congestion -----------------------------------------------------------------------
  if (on(r, 'pickupCongestion') && r.pickupSeries.length) {
    const wins = sustainedWindows(r.pickupSeries, v => v >= t.pickupCongestionCount, t.queueAlertMinutes, iv);
    const pz = customerZones(r.ctx, z => zoneRole(z) === 'pickup');
    for (const w of wins) {
      const aw = waitsIn(r.pickupWait, w);
      moments.push({ id: id('pick'), rule: 'pickupCongestion', start: w.start, end: w.end, timeLabel: fmtRange(w, tz), title: 'Pickup area crowded', detail: `Up to ${w.peak} ${lowerCustomers} waiting at pickup${aw !== null ? `, average wait ${fmtDuration(aw)}` : ''}.`, severity: 'medium', zoneIds: pz.map(z => z.id) });
    }
    if (wins.length) {
      const w = wins.reduce((a, b) => (b.minutes > a.minutes ? b : a));
      recs.push({ id: id('rec'), rule: 'pickupCongestion', text: `Add a runner at pickup between ${fmtTime(w.start, tz)} and ${fmtTime(w.end, tz)} to hand off orders faster.`, basis: `${wins.length} crowded-pickup window(s), longest ${w.minutes} min.` });
    }
  }

  // --- Seating full / mostly empty -------------------------------------------------------------
  if (r.util && r.util.series.length) {
    // Only judge seating while the store is open — an empty room at 3 AM is not an insight.
    const s = r.util.series.filter(p => isOpenAt(p.at, tz, r.ctx.cfg.operatingHours)).map(p => ({ at: p.at, total: p.pct * 100 }));
    if (on(r, 'seatingFull')) {
      for (const w of sustainedWindows(s, v => v >= t.utilizationHighPct, 15, iv)) {
        const zs = customerZones(r.ctx, z => r.util!.zones.some(u => u.zoneId === z.id));
        moments.push({ id: id('full'), rule: 'seatingFull', start: w.start, end: w.end, timeLabel: fmtRange(w, tz), title: `${terms.seating} full`, detail: `${terms.seating} at ${Math.round(w.avg)}% or more of capacity for ${w.minutes} minutes.`, severity: 'medium', zoneIds: zs.map(z => z.id) });
      }
    }
    if (on(r, 'seatingLow')) {
      const lows = sustainedWindows(s, v => v <= t.utilizationLowPct, 60, iv);
      if (lows.length) {
        const w = lows.reduce((a, b) => (b.minutes > a.minutes ? b : a));
        insights.push({ id: id('ins'), rule: 'seatingLow', tone: 'info', text: `${terms.seating} use was below ${t.utilizationLowPct}% from ${fmtTime(w.start, tz)} to ${fmtTime(w.end, tz)}.`, basis: `Average ${Math.round(w.avg)}% over ${w.minutes} minutes.` });
        if (w.minutes >= 90) recs.push({ id: id('rec'), rule: 'seatingLow', text: `${terms.seating} sits mostly empty ${fmtTime(w.start, tz)}–${fmtTime(w.end, tz)}; consider an afternoon offer or using that time for deep cleaning.`, basis: `${w.minutes} minutes at or below ${t.utilizationLowPct}%.` });
      }
    }
  }

  // --- Traffic vs same weekday last week --------------------------------------------------------
  if (on(r, 'trafficVsLastWeek') && r.entered !== null && r.cmpEntered !== null && r.cmpEntered > 0 && r.compareLabel) {
    const change = Math.round(((r.entered - r.cmpEntered) / r.cmpEntered) * 100);
    let best: { label: string; change: number } | null = null;
    if (!multiDay && r.cmpHourly && r.cmpHourly.length === r.hourly.length) {
      // Find the 1-2 hour span with the biggest change worth mentioning.
      for (let i = 0; i < r.hourly.length; i++) {
        for (const span of [1, 2]) {
          const a = r.hourly.slice(i, i + span), b = r.cmpHourly.slice(i, i + span);
          if (a.length < span || a.some(h => h.entered === null) || b.some(h => h.entered === null)) continue;
          const sa = a.reduce((x, h) => x + h.entered!, 0), sb = b.reduce((x, h) => x + h.entered!, 0);
          if (sb < 5) continue;
          const c = Math.round(((sa - sb) / sb) * 100);
          if (Math.abs(c) >= t.trafficChangePct && (!best || Math.abs(c) > Math.abs(best.change))) best = { label: `${fmtTime(a[0].start, tz)} and ${fmtTime(a[a.length - 1].end, tz)}`, change: c };
        }
      }
    }
    if (best) insights.push({ id: id('ins'), rule: 'trafficVsLastWeek', tone: best.change > 0 ? 'up' : 'down', text: `Traffic ${best.change > 0 ? 'increased' : 'dropped'} ${Math.abs(best.change)}% between ${best.label} compared to ${r.compareLabel}.`, basis: 'Customers entered, same hours, same weekday last week.' });
    if (Math.abs(change) >= t.trafficChangePct) insights.push({ id: id('ins'), rule: 'trafficVsLastWeek', tone: change > 0 ? 'up' : 'down', text: `${terms.customers} entered ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% vs ${r.compareLabel} (${r.entered} vs ${r.cmpEntered}).`, basis: 'Customers entered over the same span of the day.' });
  }

  // --- Missing camera samples ------------------------------------------------------------------
  if (on(r, 'cameraGap') && r.ctx.cfg.samplingEnabled && r.ctx.zones.length) {
    const expected = Math.floor(r.hourly.filter(h => h.end <= r.ctx.now).reduce((a, h) => a + (h.end.getTime() - h.start.getTime()), 0) / (iv * 1000));
    const seen = r.ctx.rounds.length;
    if (expected > 20 && seen < expected * 0.8) {
      insights.push({ id: id('ins'), rule: 'cameraGap', tone: 'warn', text: `Only ${Math.round((seen / expected) * 100)}% of expected camera samples arrived, so totals may be low.`, basis: `${seen} of ~${expected} sampling rounds.` });
    }
  }

  moments.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { moments, insights, recommendations: recs, understaffed };
}
