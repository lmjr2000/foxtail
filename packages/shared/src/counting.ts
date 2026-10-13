/**
 * Counting configuration for a Foxtail Coffee store (carried over from Eye of Omni's COFFEE_SHOP
 * business template; the other templates were left behind).
 *
 * A store has counting AREAS (zones) drawn on its cameras. The engine
 * (apps/api/src/services/counting/engine.ts) only understands each area's ROLE (entry, line,
 * register, pickup, seating, staff); it never invents a number. This file decides which areas exist,
 * which metrics there are and how they are labelled, which rules produce key moments, and the
 * default targets. A store's saved counting profile only holds overrides; resolveCountingConfig()
 * merges them over these defaults.
 */

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

export const ZONE_TYPES = ['ENTRY', 'EXIT', 'QUEUE', 'REGISTER', 'PICKUP', 'INDOOR_SEATING', 'PATIO', 'BACK_OF_HOUSE'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export function isZoneType(v: unknown): v is ZoneType {
  return typeof v === 'string' && (ZONE_TYPES as readonly string[]).includes(v);
}

/**
 * What an area means to the engine:
 *  entry    – new people seen here count as entered
 *  exit     – new people seen here count as exited
 *  queue    – waiting in line; time here is the wait; leaving without reaching the register = walkaway
 *  service  – the register / ordering spot
 *  pickup   – waiting for the order at the handoff
 *  seating  – seats with a capacity (utilization)
 *  staff    – staff-only area (back of house)
 */
export type ZoneRole = 'entry' | 'exit' | 'queue' | 'service' | 'pickup' | 'seating' | 'staff';
export type Audience = 'customer' | 'staff';

export interface ZoneTypeDef {
  type: ZoneType;
  label: string;
  role: ZoneRole;
  defaultAudience: Audience;
  hasCapacity: boolean;
  description: string;
}

function zt(type: ZoneType, label: string, role: ZoneRole, defaultAudience: Audience, hasCapacity: boolean, description: string): ZoneTypeDef {
  return { type, label, role, defaultAudience, hasCapacity, description };
}

export const ZONE_TYPE_DEFS: Record<ZoneType, ZoneTypeDef> = {
  ENTRY: zt('ENTRY', 'Entrance', 'entry', 'customer', false, 'Just inside the door. New people seen here count as entered.'),
  EXIT: zt('EXIT', 'Exit', 'exit', 'customer', false, 'A separate exit door. New people seen here count as exited.'),
  QUEUE: zt('QUEUE', 'Line', 'queue', 'customer', false, 'Where customers stand in line. Time here is the wait.'),
  REGISTER: zt('REGISTER', 'Register / Front Counter', 'service', 'customer', false, 'Customer side: the ordering spot. Staff side: behind the counter (set audience to Staff).'),
  PICKUP: zt('PICKUP', 'Pickup', 'pickup', 'customer', false, 'Where orders are handed over. Customer side measures pickup wait; staff side measures handoff staffing.'),
  INDOOR_SEATING: zt('INDOOR_SEATING', 'Indoor Seating', 'seating', 'customer', true, 'Indoor tables and chairs. Set the number of seats.'),
  PATIO: zt('PATIO', 'Patio', 'seating', 'customer', true, 'Outdoor seating. Set the number of seats.'),
  BACK_OF_HOUSE: zt('BACK_OF_HOUSE', 'Back of House', 'staff', 'staff', false, 'Staff-only prep area.'),
};

/** The areas a new store is offered in setup. */
export const SUGGESTED_ZONES: Array<{ type: ZoneType; label: string; audience: Audience; capacity?: number; staffTargetMin?: number; staffTargetMax?: number }> = [
  { type: 'ENTRY', label: 'Entrance', audience: 'customer' },
  { type: 'QUEUE', label: 'Register Line', audience: 'customer' },
  { type: 'REGISTER', label: 'Ordering Spot', audience: 'customer' },
  { type: 'REGISTER', label: 'Front Counter / Register', audience: 'staff', staffTargetMin: 2, staffTargetMax: 4 },
  { type: 'PICKUP', label: 'Pickup (customers)', audience: 'customer' },
  { type: 'PICKUP', label: 'Pickup Area', audience: 'staff', staffTargetMin: 1, staffTargetMax: 3 },
  { type: 'INDOOR_SEATING', label: 'Indoor Seating', audience: 'customer', capacity: 20 },
  { type: 'PATIO', label: 'Patio Seating', audience: 'customer', capacity: 16 },
  { type: 'BACK_OF_HOUSE', label: 'Back of House', audience: 'staff', staffTargetMin: 1, staffTargetMax: 3 },
];

// ---------------------------------------------------------------------------------------------
// Sections (dashboard modules) and metrics
// ---------------------------------------------------------------------------------------------

export const MODULES = ['traffic', 'queue', 'pickup', 'staffing', 'seating', 'customerFlow', 'insights'] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  traffic: 'Traffic',
  queue: 'Line & wait',
  pickup: 'Pickup',
  staffing: 'Staffing',
  seating: 'Seating',
  customerFlow: 'Customer flow',
  insights: 'Key moments & recommendations',
};

/** How the engine computes a metric. It only references area types, never a store. */
export type MetricCalc =
  | { kind: 'entered' }
  | { kind: 'exited' }
  | { kind: 'occupancy' }
  | { kind: 'peakOccupancy' }
  | { kind: 'zoneCount'; zoneTypes: ZoneType[] }
  | { kind: 'wait'; zoneTypes: ZoneType[] }
  | { kind: 'walkaways' }
  | { kind: 'coverage'; zoneTypes: ZoneType[] | 'all' }
  | { kind: 'utilization'; zoneTypes: ZoneType[] }
  | { kind: 'flowScore' };

export type Unit = 'count' | 'seconds' | 'percent' | 'score';

export interface MetricDef {
  key: string;
  label: string;
  unit: Unit;
  calc: MetricCalc;
  module: Module;
  betterWhen: 'higher' | 'lower' | 'neutral';
  description: string;
}

function m(key: string, label: string, unit: Unit, calc: MetricCalc, module: Module, betterWhen: MetricDef['betterWhen'], description: string): MetricDef {
  return { key, label, unit, calc, module, betterWhen, description };
}

export const METRICS: Record<string, MetricDef> = {
  customersEntered: m('customersEntered', 'Customers Entered', 'count', { kind: 'entered' }, 'traffic', 'higher', 'New people seen at the entrance (or first seen inside, whichever is higher).'),
  customersExited: m('customersExited', 'Customers Exited', 'count', { kind: 'exited' }, 'traffic', 'neutral', 'New people seen at an exit (or entered minus still inside when there is no exit area).'),
  inStoreNow: m('inStoreNow', 'In Store Now', 'count', { kind: 'occupancy' }, 'traffic', 'neutral', 'Customers in customer areas in the latest camera sample.'),
  peakInStore: m('peakInStore', 'Peak In Store', 'count', { kind: 'peakOccupancy' }, 'traffic', 'neutral', 'Most customers in customer areas at one time.'),
  lineNow: m('lineNow', 'Line Right Now', 'count', { kind: 'zoneCount', zoneTypes: ['QUEUE'] }, 'queue', 'lower', 'Customers in the line area in the latest sample.'),
  waitTime: m('waitTime', 'Average Wait', 'seconds', { kind: 'wait', zoneTypes: ['QUEUE'] }, 'queue', 'lower', 'Average time customers spent in the line area.'),
  walkaways: m('walkaways', 'Left Before Service', 'count', { kind: 'walkaways' }, 'queue', 'lower', 'Customers who waited in line, then left without reaching the register.'),
  pickupWait: m('pickupWait', 'Pickup Wait', 'seconds', { kind: 'wait', zoneTypes: ['PICKUP'] }, 'pickup', 'lower', 'Average time customers waited at pickup.'),
  counterCoverage: m('counterCoverage', 'Front-Counter Staffing', 'percent', { kind: 'coverage', zoneTypes: ['REGISTER'] }, 'staffing', 'higher', 'Share of the time the front counter had at least its target staff.'),
  pickupCoverage: m('pickupCoverage', 'Pickup Staffing', 'percent', { kind: 'coverage', zoneTypes: ['PICKUP'] }, 'staffing', 'higher', 'Share of the time the pickup handoff had at least its target staff.'),
  staffingCoverage: m('staffingCoverage', 'All-Area Staffing', 'percent', { kind: 'coverage', zoneTypes: 'all' }, 'staffing', 'higher', 'Share of the time every staff area met its target.'),
  seatingUtilization: m('seatingUtilization', 'Seating Used', 'percent', { kind: 'utilization', zoneTypes: ['INDOOR_SEATING', 'PATIO'] }, 'seating', 'neutral', 'Average share of seats in use.'),
  flowScore: m('flowScore', 'Customer Flow Score', 'score', { kind: 'flowScore' }, 'customerFlow', 'higher', '0-100 from wait vs target, walkaway rate and counter staffing.'),
};

/** The numbers a store shows by default, in order (brief: entered, line, wait, counter staffing first). */
export const DEFAULT_KPIS = ['customersEntered', 'lineNow', 'waitTime', 'counterCoverage', 'walkaways'];
export const DEFAULT_METRICS = Object.keys(METRICS);
export const DEFAULT_MODULES: Module[] = [...MODULES];

// ---------------------------------------------------------------------------------------------
// Rules (key moments, insights, recommendations) and targets
// ---------------------------------------------------------------------------------------------

export const RULES = [
  'queueSustained', 'longWait', 'walkawaysHigh', 'understaffedPeak', 'overstaffedLowTraffic', 'strongFlow',
  'trafficVsLastWeek', 'pickupCongestion', 'seatingLow', 'seatingFull', 'cameraGap',
] as const;
export type Rule = (typeof RULES)[number];

export const RULE_LABELS: Record<Rule, string> = {
  queueSustained: 'Line above target for a while',
  longWait: 'Average wait above target',
  walkawaysHigh: 'Customers leaving the line',
  understaffedPeak: 'Understaffed during busy periods',
  overstaffedLowTraffic: 'Many staff in front during slow periods',
  strongFlow: 'Busy and moving well',
  trafficVsLastWeek: 'Traffic vs same weekday last week',
  pickupCongestion: 'Pickup area crowded',
  seatingLow: 'Seating mostly empty',
  seatingFull: 'Seating full',
  cameraGap: 'Camera samples missing',
};

export interface Thresholds {
  /** Line length that counts as "long". */
  queueAlertSize: number;
  /** How long the line must stay long before it is a key moment (minutes). */
  queueAlertMinutes: number;
  /** Target wait in line (seconds). */
  waitTargetSeconds: number;
  /** Minimum time in line before someone counts as waiting (filters people walking past). */
  walkawayMinQueueSeconds: number;
  /** After leaving the line, how long they have to reach the register before it counts as a walkaway. */
  walkawayWindowSeconds: number;
  /** Target pickup wait (seconds). */
  pickupTargetSeconds: number;
  /** Customers at pickup that count as crowded. */
  pickupCongestionCount: number;
  /** Seating at or above this is "full" (percent). */
  utilizationHighPct: number;
  /** Seating at or below this is "mostly empty" (percent). */
  utilizationLowPct: number;
  /** Traffic change vs same weekday worth mentioning (percent). */
  trafficChangePct: number;
  /** Understaffed must last this long before it is reported (minutes). */
  understaffedMinutes: number;
  /** Time in a seating area before someone counts as "sat down" (seconds). */
  seatedMinSeconds: number;
  /** Tracking: max normalized distance a person may move between samples and stay the same track. */
  trackMaxDistance: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  queueAlertSize: 6, queueAlertMinutes: 10, waitTargetSeconds: 240, walkawayMinQueueSeconds: 30, walkawayWindowSeconds: 180,
  pickupTargetSeconds: 300, pickupCongestionCount: 5, utilizationHighPct: 90, utilizationLowPct: 25, trafficChangePct: 15,
  understaffedMinutes: 15, seatedMinSeconds: 180, trackMaxDistance: 0.12,
};

export const THRESHOLD_LIMITS: Record<keyof Thresholds, [number, number]> = {
  queueAlertSize: [1, 200], queueAlertMinutes: [1, 240], waitTargetSeconds: [10, 7200], walkawayMinQueueSeconds: [0, 1800],
  walkawayWindowSeconds: [10, 3600], pickupTargetSeconds: [10, 7200], pickupCongestionCount: [1, 200], utilizationHighPct: [10, 100],
  utilizationLowPct: [0, 90], trafficChangePct: [1, 500], understaffedMinutes: [1, 480], seatedMinSeconds: [0, 3600], trackMaxDistance: [0.02, 0.5],
};

export const THRESHOLD_LABELS: Record<keyof Thresholds, string> = {
  queueAlertSize: 'Long line (customers)', queueAlertMinutes: 'Long line lasts (minutes)', waitTargetSeconds: 'Wait target (seconds)',
  walkawayMinQueueSeconds: 'Counts as in line after (seconds)', walkawayWindowSeconds: 'Walkaway window (seconds)',
  pickupTargetSeconds: 'Pickup wait target (seconds)', pickupCongestionCount: 'Crowded pickup (customers)',
  utilizationHighPct: 'Seating full at (%)', utilizationLowPct: 'Seating mostly empty at (%)', trafficChangePct: 'Traffic change worth noting (%)',
  understaffedMinutes: 'Understaffed lasts (minutes)', seatedMinSeconds: 'Counts as seated after (seconds)',
  trackMaxDistance: 'Tracking distance (0-1 of frame)',
};

export interface Terminology {
  customer: string; customers: string; staff: string; staffPlural: string; queue: string; servicePoint: string; walkaways: string; seating: string;
}

export const TERMS: Terminology = {
  customer: 'Customer', customers: 'Customers', staff: 'Employee', staffPlural: 'Employees', queue: 'Register line',
  servicePoint: 'Register', walkaways: 'Left before service', seating: 'Seating',
};

export interface FlowStage {
  key: string;
  label: string;
  /** Area types whose new tracks count for this stage. */
  zoneTypes: ZoneType[];
  /** Only tracks that stayed at least this threshold long count (e.g. "sat down"). */
  minSecondsFrom?: keyof Thresholds;
}

export const FLOW: FlowStage[] = [
  { key: 'entered', label: 'Entered', zoneTypes: ['ENTRY'] },
  { key: 'queue', label: 'Joined Line', zoneTypes: ['QUEUE'], minSecondsFrom: 'walkawayMinQueueSeconds' },
  { key: 'service', label: 'Reached Register', zoneTypes: ['REGISTER'] },
  { key: 'pickup', label: 'Picked Up Order', zoneTypes: ['PICKUP'] },
  { key: 'seated', label: 'Sat Down', zoneTypes: ['INDOOR_SEATING', 'PATIO'], minSecondsFrom: 'seatedMinSeconds' },
  { key: 'exited', label: 'Exited', zoneTypes: ['EXIT'] },
];

// ---------------------------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------------------------

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];
export type OperatingHours = Record<Day, { open: string; close: string } | null>;

export function sameHoursEveryDay(open: string, close: string, closedDays: Day[] = []): OperatingHours {
  const out = {} as OperatingHours;
  for (const d of DAYS) out[d] = closedDays.includes(d) ? null : { open, close };
  return out;
}

export const DEFAULT_HOURS: OperatingHours = sameHoursEveryDay('06:00', '20:00');
export const DEFAULT_TIMEZONE = 'America/New_York';
export const MIN_SAMPLE_INTERVAL = 10;
export const DEFAULT_SAMPLE_INTERVAL = 30;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** null = valid; otherwise the problems. Days may be null (closed). */
export function validateHours(input: unknown): { ok: true; value: OperatingHours } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['openingHours must be an object with sun..sat'] };
  const raw = input as Record<string, unknown>;
  const out = {} as OperatingHours;
  for (const d of DAYS) {
    const v = raw[d] as { open?: unknown; close?: unknown } | null | undefined;
    if (v === null || v === undefined) { out[d] = null; continue; }
    if (typeof v.open !== 'string' || typeof v.close !== 'string' || !HHMM.test(v.open) || !HHMM.test(v.close)) {
      errors.push(`openingHours.${d} must be {open:"HH:MM", close:"HH:MM"} or null (closed)`);
    } else out[d] = { open: v.open, close: v.close };
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Store counting profile (stored overrides) + resolution
// ---------------------------------------------------------------------------------------------

export interface CountingOverrides {
  enabledModules?: Module[] | null;
  kpiMetrics?: string[] | null;
  enabledRules?: Rule[] | null;
  thresholds?: Partial<Thresholds> | null;
  samplingEnabled?: boolean;
  sampleIntervalSeconds?: number;
}

export interface ResolvedMetric { key: string; label: string; def: MetricDef }

export interface CountingConfig {
  modules: Module[];
  zoneTypes: ZoneType[];
  metrics: ResolvedMetric[];
  kpis: ResolvedMetric[];
  terms: Terminology;
  rules: Rule[];
  thresholds: Thresholds;
  flow: FlowStage[];
  operatingHours: OperatingHours | null;
  timezone: string;
  samplingEnabled: boolean;
  sampleIntervalSeconds: number;
  /** True when the store has a saved counting profile (false = defaults only). */
  configured: boolean;
}

function clampThresholds(t: Partial<Thresholds> | null | undefined): Partial<Thresholds> {
  const out: Partial<Thresholds> = {};
  if (!t) return out;
  for (const k of Object.keys(THRESHOLD_LIMITS) as Array<keyof Thresholds>) {
    const v = (t as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [lo, hi] = THRESHOLD_LIMITS[k];
      out[k] = Math.min(hi, Math.max(lo, v));
    }
  }
  return out;
}

function resolveMetric(key: string): ResolvedMetric | null {
  const def = METRICS[key];
  return def ? { key, label: def.label, def } : null;
}

/**
 * Merge a store's saved overrides over the coffee-shop defaults. Hours and timezone always come from
 * the store record (one place to edit them). `null` overrides = defaults, not configured.
 */
export function resolveCountingConfig(overrides: CountingOverrides | null, store: { timezone: string; openingHours: OperatingHours | null }): CountingConfig {
  const modules = (overrides?.enabledModules && overrides.enabledModules.length
    ? overrides.enabledModules.filter(x => (MODULES as readonly string[]).includes(x))
    : [...DEFAULT_MODULES]) as Module[];
  const metrics = DEFAULT_METRICS
    .map(resolveMetric)
    .filter((x): x is ResolvedMetric => !!x)
    .filter(x => modules.includes(x.def.module) || x.def.module === 'traffic');
  const kpiKeys = overrides?.kpiMetrics && overrides.kpiMetrics.length ? overrides.kpiMetrics : DEFAULT_KPIS;
  const kpis = kpiKeys.map(resolveMetric).filter((x): x is ResolvedMetric => !!x).slice(0, 6);
  const rules = (overrides?.enabledRules && overrides.enabledRules.length
    ? overrides.enabledRules.filter(r => (RULES as readonly string[]).includes(r))
    : [...RULES]) as Rule[];
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...clampThresholds(overrides?.thresholds) };
  const interval = Math.max(MIN_SAMPLE_INTERVAL, Math.min(3600, Math.round(overrides?.sampleIntervalSeconds ?? DEFAULT_SAMPLE_INTERVAL)));
  return {
    modules,
    zoneTypes: [...ZONE_TYPES],
    metrics,
    kpis,
    terms: TERMS,
    rules,
    thresholds,
    flow: FLOW,
    operatingHours: store.openingHours,
    timezone: isValidTimezone(store.timezone) ? store.timezone : DEFAULT_TIMEZONE,
    samplingEnabled: overrides?.samplingEnabled === true,
    sampleIntervalSeconds: interval,
    configured: !!overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Areas as the engine / UI see them
// ---------------------------------------------------------------------------------------------

/** A counting area. Polygon points are normalized 0..1 on the camera frame (x right, y down). */
export interface Zone {
  id: string;
  storeId: string;
  zoneType: ZoneType;
  label: string;
  audience: Audience;
  cameraId: string | null;
  polygon: Array<[number, number]> | null;
  capacity: number | null;
  staffTargetMin: number | null;
  staffTargetMax: number | null;
  enabled: boolean;
  sortOrder: number;
}

/** An area is "measurable" when it has a camera and a region drawn on that camera's frame. */
export function isZoneMeasurable(z: Pick<Zone, 'cameraId' | 'polygon' | 'enabled'>): boolean {
  return z.enabled && !!z.cameraId && Array.isArray(z.polygon) && z.polygon.length >= 3;
}

// ---------------------------------------------------------------------------------------------
// Validation (the API uses these before saving)
// ---------------------------------------------------------------------------------------------

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function polygonOrError(raw: unknown, path: string, errors: string[]): Array<[number, number]> | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 40
    || raw.some(pt => !Array.isArray(pt) || pt.length !== 2 || pt.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1))) {
    errors.push(`${path} must be 3-40 [x,y] points between 0 and 1`);
    return null;
  }
  return (raw as number[][]).map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] as [number, number]);
}

export function validateCountingOverrides(input: unknown): Validated<CountingOverrides> {
  const errors: string[] = [];
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const listOf = (k: string, allowed: readonly string[]): string[] | null => {
    const v = o[k];
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !allowed.includes(x))) { errors.push(`${k} has unknown values`); return null; }
    return [...new Set(v as string[])];
  };
  const enabledModules = listOf('enabledModules', MODULES) as Module[] | null;
  const kpiMetrics = listOf('kpiMetrics', Object.keys(METRICS));
  if (kpiMetrics && kpiMetrics.length > 6) errors.push('kpiMetrics: at most 6');
  const enabledRules = listOf('enabledRules', RULES) as Rule[] | null;

  let thresholds: Partial<Thresholds> | null = null;
  if (o.thresholds !== undefined && o.thresholds !== null) {
    if (typeof o.thresholds !== 'object') errors.push('thresholds must be an object');
    else {
      const t = o.thresholds as Record<string, unknown>;
      for (const k of Object.keys(t)) {
        if (!(k in THRESHOLD_LIMITS)) { errors.push(`thresholds.${k} is not a known target`); continue; }
        const v = t[k];
        const [lo, hi] = THRESHOLD_LIMITS[k as keyof Thresholds];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) errors.push(`thresholds.${k} must be a number between ${lo} and ${hi}`);
      }
      thresholds = clampThresholds(t as Partial<Thresholds>);
    }
  }
  const sampleIntervalSeconds = o.sampleIntervalSeconds === undefined || o.sampleIntervalSeconds === null ? undefined : Number(o.sampleIntervalSeconds);
  if (sampleIntervalSeconds !== undefined && (!Number.isFinite(sampleIntervalSeconds) || sampleIntervalSeconds < MIN_SAMPLE_INTERVAL || sampleIntervalSeconds > 3600)) {
    errors.push(`sampleIntervalSeconds must be ${MIN_SAMPLE_INTERVAL}-3600`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      enabledModules, kpiMetrics, enabledRules, thresholds,
      samplingEnabled: o.samplingEnabled === true,
      sampleIntervalSeconds: sampleIntervalSeconds === undefined ? DEFAULT_SAMPLE_INTERVAL : Math.round(sampleIntervalSeconds),
    },
  };
}

export function validateZones(input: unknown): Validated<Array<Omit<Zone, 'storeId'>>> {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { ok: false, errors: ['zones must be an array'] };
  if (input.length > 60) return { ok: false, errors: ['at most 60 areas per store'] };
  const out: Array<Omit<Zone, 'storeId'>> = [];
  input.forEach((raw, i) => {
    const z = (raw || {}) as Record<string, unknown>;
    const p = `zones[${i}]`;
    if (!isZoneType(z.zoneType)) { errors.push(`${p}.zoneType is not a known area type`); return; }
    const def = ZONE_TYPE_DEFS[z.zoneType];
    const label = typeof z.label === 'string' && z.label.trim() ? z.label.trim().slice(0, 60) : def.label;
    const audience: Audience = z.audience === 'staff' ? 'staff' : z.audience === 'customer' ? 'customer' : def.defaultAudience;
    const polygon = polygonOrError(z.polygon, `${p}.polygon`, errors);
    const intOrNull = (k: string, max: number): number | null => {
      const v = z[k];
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) { errors.push(`${p}.${k} must be a whole number 0-${max}`); return null; }
      return n;
    };
    const capacity = intOrNull('capacity', 10000);
    const staffTargetMin = intOrNull('staffTargetMin', 100);
    const staffTargetMax = intOrNull('staffTargetMax', 100);
    if (staffTargetMin !== null && staffTargetMax !== null && staffTargetMax < staffTargetMin) errors.push(`${p}.staffTargetMax must be >= staffTargetMin`);
    out.push({
      id: typeof z.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(z.id) ? z.id : '',
      zoneType: z.zoneType, label, audience,
      cameraId: typeof z.cameraId === 'string' && z.cameraId ? z.cameraId : null,
      polygon, capacity, staffTargetMin, staffTargetMax,
      enabled: z.enabled !== false,
      sortOrder: Number.isInteger(z.sortOrder) ? Number(z.sortOrder) : i,
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}
