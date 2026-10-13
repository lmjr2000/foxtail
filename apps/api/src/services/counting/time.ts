/**
 * Timezone helpers for Business Insights (no dependencies). The API container runs in UTC, but
 * "today", hour buckets and operating hours belong to the location's own timezone.
 */
import type { Day, OperatingHours } from '@foxtail/shared';

const DAY_KEYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number; dow: number }

export function tzParts(d: Date, tz: string): LocalParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) out[p.type] = p.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(out.weekday);
  return {
    year: +out.year, month: +out.month, day: +out.day,
    hour: +out.hour % 24, minute: +out.minute, second: +out.second, dow,
  };
}

/** Local wall-clock minus UTC, in ms, at instant d. */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = tzParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant a local wall-clock time happens in tz. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

export function startOfLocalDay(d: Date, tz: string): Date {
  const p = tzParts(d, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

export function addLocalDays(dayStart: Date, days: number, tz: string): Date {
  const p = tzParts(new Date(dayStart.getTime() + 12 * 3600_000), tz);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, tz);
}

export function localDateKey(d: Date, tz: string): string {
  const p = tzParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function fmtTime(d: Date, tz: string): string {
  const p = tzParts(d, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

export function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}

export function weekdayName(d: Date, tz: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][tzParts(d, tz).dow];
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function hhmmToMin(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

/** Is instant d inside the location's operating hours? null hours = always open. Handles past-midnight closes. */
export function isOpenAt(d: Date, tz: string, hours: OperatingHours | null): boolean {
  if (!hours) return true;
  const p = tzParts(d, tz);
  const mins = p.hour * 60 + p.minute;
  const today = hours[DAY_KEYS[p.dow]];
  if (today) {
    const o = hhmmToMin(today.open), c = hhmmToMin(today.close);
    if (c > o ? (mins >= o && mins < c) : mins >= o) return true;
  }
  // Yesterday's hours spilling past midnight (e.g. 18:00-02:00).
  const y = hours[DAY_KEYS[(p.dow + 6) % 7]];
  if (y) {
    const o = hhmmToMin(y.open), c = hhmmToMin(y.close);
    if (c <= o && mins < c) return true;
  }
  return false;
}

/** Open/close hours (local, 0-24) for the day containing d; null = closed; no hours = 0..24. */
export function openWindowHours(d: Date, tz: string, hours: OperatingHours | null): { from: number; to: number } | null {
  if (!hours) return { from: 0, to: 24 };
  const today = hours[DAY_KEYS[tzParts(d, tz).dow]];
  if (!today) return null;
  const o = hhmmToMin(today.open), c = hhmmToMin(today.close);
  return { from: Math.floor(o / 60), to: c > o ? Math.ceil(c / 60) : 24 };
}
