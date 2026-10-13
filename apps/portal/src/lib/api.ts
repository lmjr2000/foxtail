/**
 * Talking to the Foxtail API. The session token lives in localStorage; every call sends it as a
 * Bearer header. The server decides what each login may see — the portal never filters stores itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperatingHours, Role } from '@foxtail/shared';

const TOKEN_KEY = 'foxtail_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string | null): void {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let code = 'ERROR', message = `Request failed (${res.status})`;
    try { const b = await res.json(); code = b.error || code; message = b.message || message; } catch { /* not JSON */ }
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.();
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiPost = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const apiPut = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const apiPatch = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const apiDelete = <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' });

/** Download a file the API produces (PDF/CSV) using the session header, then save it in the browser. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try { message = (await res.json()).message || message; } catch { /* binary */ }
    throw new Error(message);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Load a GET endpoint; reloads when the path changes and optionally on an interval. */
export function useApi<T>(path: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef(path);
  const load = useCallback(async () => {
    if (!path) return;
    current.current = path;
    setLoading(true);
    try {
      const d = await apiFetch<T>(path);
      if (current.current === path) { setData(d); setError(null); }
    } catch (e) {
      if (current.current === path) setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);
  useEffect(() => { setData(null); setError(null); void load(); }, [load]);
  useEffect(() => {
    if (!refreshMs || !path) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, refreshMs);
    return () => window.clearInterval(t);
  }, [load, refreshMs, path]);
  return { data, error, loading, reload: load, setData };
}

// ------------------------------------------------------------------------------------- types

export interface SessionUser { id: string; email: string; name: string; role: Role; franchiseeId: string | null; mustChangePassword: boolean }

export interface Store {
  id: string; storeNumber: string | null; name: string; address: string | null; city: string | null; state: string | null; postalCode: string | null;
  timezone: string; openingHours: OperatingHours; franchiseeId: string | null; franchiseeName: string | null;
  sourceDeviceName?: string | null; recorderModel?: string | null;
}
export interface StoreListItem extends Store {
  counting: { areas: number; measurable: number; enabled: boolean; lastSampleAt: string | null };
  cameras: { total: number; online: number; offline: number; statusAt: string | null; video: VideoMode };
}

/** live = direct recorder (video), pictures = edge agent (latest pictures), none = recorder login not set up yet. */
export type VideoMode = 'live' | 'pictures' | 'none';

export interface Camera {
  id: string; storeId: string; name: string; channel: number; enabled: boolean;
  source: 'manual' | 'ezcloud'; model: string | null; serialNo: string | null;
  status: 'online' | 'offline' | 'unknown'; statusAt: string | null; statusSource: string | null;
}

/** Fetch an image the API protects (session header) and return an object URL for <img>. */
export async function fetchImage(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    let message = `No picture (${res.status})`;
    try { message = (await res.json()).message || message; } catch { /* binary */ }
    throw new Error(message);
  }
  return URL.createObjectURL(await res.blob());
}

export interface MetricValue {
  key: string; label: string; unit: 'count' | 'seconds' | 'percent' | 'score'; value: number | null; display: string;
  compare: number | null; compareDisplay: string | null; deltaPct: number | null; direction: 'up' | 'down' | 'flat' | null;
  good: boolean | null; status: 'ok' | 'needs_zones' | 'no_data'; needs: string | null; estimate: boolean; sub: string | null;
}

export interface Bucket {
  label: string; hour: number | null; start: string; end: string; entered: number | null; compareEntered: number | null;
  occupancyAvg: number | null; occupancyPeak: number | null; waitAvgSeconds: number | null; queueAvg: number | null; queuePeak?: number | null;
  staffAvg: number | null; walkaways?: number | null;
}

export interface HourOfDay { hour: number; label: string; days: number; rounds: number; entered: number | null; waitAvgSeconds: number | null; waitN: number; lineAvg: number | null; linePeak: number | null; counterStaffAvg: number | null; counterCoveragePct: number | null }

export interface Insights {
  store: Store; hoursLabel: string;
  config: { kpis: string[]; modules: string[]; thresholds: Record<string, number>; terms: Record<string, string> };
  timezone: string;
  range: { start: string; end: string; label: string; singleDay: boolean };
  compare: { start: string; end: string; label: string } | null;
  dataStatus: { configured: boolean; zonesTotal: number; zonesMeasurable: number; samplingEnabled: boolean; rounds: number; lastRoundAt: string | null; fresh: boolean; hasData: boolean; live: boolean; openNow: boolean };
  kpis: MetricValue[];
  metrics: Record<string, MetricValue>;
  chart: { granularity: 'hour' | 'day'; buckets: Bucket[]; has: { entered: boolean; occupancy: boolean; wait: boolean }; waitLabel: string; needs: string | null };
  queue: { available: boolean; needs: string | null; label: string; current: number | null; status: 'Normal' | 'Busy' | 'Long' | null; avg: number | null; avgCompare: number | null; peak: number | null; peakAt: string | null; avgWait: number | null; avgWaitCompare: number | null; longestWait: number | null; longestAt: string | null; waitN: number; walkaways: number | null; walkawaysCompare: number | null; walkawaysNeeds: string | null; queuers: number; threshold: number };
  pickup: { available: boolean; needs: string | null; current: number | null; avgWait: number | null; longest: number | null; n: number; overTarget: number; target: number; coveragePct: number | null };
  staffing: { available: boolean; needs: string | null; zones: Array<{ zoneId: string; label: string; current: number | null; avg: number | null; targetMin: number | null; targetMax: number | null; coveragePct: number | null; status: string }>; coveragePct: number | null; peakPct: number | null; alert: { title: string; detail: string; timeLabel: string } | null };
  utilization: { available: boolean; needs: string | null; zones: Array<{ zoneId: string; label: string; current: number | null; capacity: number; currentPct: number | null; avgPct: number | null; peakPct: number | null }>; avgPct: number | null; currentPct: number | null; overallOccupancy: number | null };
  flow: { stages: Array<{ key: string; label: string; count: number | null; pct: number | null; needs: string | null; estimate: boolean }>; score: number | null; scoreCompare: number | null };
  keyMoments: Array<{ id: string; rule: string; timeLabel: string; title: string; detail: string; severity: 'high' | 'medium' | 'ok' | 'info' }>;
  insights: Array<{ id: string; tone: string; text: string; basis: string }>;
  recommendations: Array<{ id: string; text: string; basis: string }>;
  hourOfDay: HourOfDay[];
  notes: string[];
}

export type CountingStatus = 'not_set_up' | 'off' | 'no_data' | 'stale' | 'ok';

export interface OverviewStore {
  storeId: string; name: string; storeNumber: string | null; city: string | null; state: string | null; franchiseeName: string | null; timezone: string;
  status: CountingStatus; statusText: string; lastSampleAt: string | null;
  entered: number | null; enteredCompare: number | null; enteredDeltaPct: number | null;
  avgWaitSeconds: number | null; waitN: number; waitTargetSeconds: number; peakLine: number | null; peakLineAt: string | null; lineNow: number | null;
  counterCoveragePct: number | null; walkaways: number | null; queuers: number;
  sales: number | null; transactions: number | null; conversionPct: number | null; matchedHours: number;
}

export interface Overview {
  range: { key: string; label: string; compareLabel: string | null }; hoursLabel: string; generatedAt: string;
  totals: { stores: number; storesCounting: number; entered: number | null; enteredCompare: number | null; enteredDeltaPct: number | null; avgWaitSeconds: number | null; waitN: number; walkaways: number | null; queuers: number; counterCoveragePct: number | null; sales: number | null; transactions: number | null; conversionPct: number | null; storesWithPos: number };
  stores: OverviewStore[];
  worstHours: Array<{ storeId: string; storeName: string; hour: number; label: string; days: number; waitAvgSeconds: number | null; waitN: number; waitTargetSeconds: number; lineAvg: number | null; linePeak: number | null; counterCoveragePct: number | null; entered: number | null; reason: string }>;
  byHour: Array<{ hour: number; label: string; stores: number; entered: number | null; waitAvgSeconds: number | null; waitN: number; lineAvg: number | null; counterCoveragePct: number | null }>;
}

export interface Franchisee { id: string; name: string; contactName: string | null; contactEmail: string | null; phone: string | null; storeCount: number; loginCount: number }
export interface AdminUser { id: string; email: string; name: string; role: Role; franchiseeId: string | null; disabled: boolean; mustChangePassword: boolean; googleLinked: boolean; lastLoginAt: string | null; createdAt: string }
