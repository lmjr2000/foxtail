/**
 * First-party usage tracking for Foxtail logins and prospect links (Omni staff dashboard: Prospect & owner activity).
 * No third-party trackers. Sends page views, time on page, taps on buttons/links (their visible text only),
 * errors, downloads, and a heartbeat (online now) to POST /api/v1/activity/beat. Never reads form fields or
 * what is typed. Staff sessions are ignored by the server; "See what they see" mirror tabs turn this off.
 * Kept 180 days on the server.
 */
import { API_BASE, MIRROR_KEY, getToken, isMirrorSession } from './api';

type Ev = { type: 'page' | 'store' | 'camera' | 'report' | 'export' | 'error' | 'tap'; at: string; path?: string; label?: string; durationMs?: number; detail?: Record<string, string | number | boolean> };

let cfg: { app: 'omni' | 'foxtail'; getToken: () => string | null; endpoint: string } | null = null;
let sid = '';
let queue: Ev[] = [];
let page: { path: string; title: string; since: number; visibleMs: number; visibleSince: number | null } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const now = () => new Date().toISOString();
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
export const trackingOff = () => isMirrorSession();
export const markMirrorView = () => { try { sessionStorage.setItem(MIRROR_KEY, '1'); } catch { /* ignore */ } };

function newSid(): string {
  try {
    const k = 'foxtail_activity_sid'; const v = sessionStorage.getItem(k);
    if (v) return v;
    const n = `s_${Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('')}`;
    sessionStorage.setItem(k, n); return n;
  } catch { return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; }
}

function send(final = false): void {
  if (!cfg || trackingOff()) { queue = []; return; }
  const token = cfg.getToken();
  if (!token) { queue = []; return; }
  const events = queue.splice(0, 50);
  const body = JSON.stringify({ sid, app: cfg.app, path: page?.path ?? location.pathname + location.search, title: page?.title ?? document.title, visible: visible() && !final, events });
  fetch(cfg.endpoint, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body }).catch(() => undefined);
}

function closePage(): void {
  if (!page) return;
  const ms = page.visibleMs + (page.visibleSince ? Date.now() - page.visibleSince : 0);
  queue.push({ type: 'page', at: new Date(page.since).toISOString(), path: page.path, label: page.title, durationMs: ms });
  page = null;
}

/** Call on every route change. */
export function trackPage(path: string, title?: string): void {
  if (!cfg || trackingOff()) return;
  if (page && page.path === path) { if (title) page.title = title; return; }
  closePage();
  page = { path, title: (title || document.title || path).slice(0, 120), since: Date.now(), visibleMs: 0, visibleSince: visible() ? Date.now() : null };
  send();
}
/** Store / camera / report opened, export downloaded, error shown. Label is short visible text only. */
export function trackEvent(type: Ev['type'], label?: string, detail?: Ev['detail']): void {
  if (!cfg || trackingOff()) return;
  queue.push({ type, at: now(), path: page?.path, label: label?.slice(0, type === 'error' ? 200 : 120), detail });
  if (type !== 'tap' || queue.length >= 20) send();
}

function onClick(e: MouseEvent): void {
  const el = (e.target as Element | null)?.closest?.('button, a, [role="button"], [role="tab"]') as HTMLElement | null;
  if (!el || el.closest('[data-no-track], input, textarea, select, [contenteditable="true"]')) return;
  const label = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText || '').trim().split('\n')[0] || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!label) return;
  trackEvent('tap', label, el.tagName === 'A' ? { link: true } : undefined);
}
function onVisibility(): void {
  if (!page) return;
  if (visible()) page.visibleSince = Date.now();
  else { if (page.visibleSince) page.visibleMs += Date.now() - page.visibleSince; page.visibleSince = null; send(true); }
}
function onHide(): void { closePage(); send(true); }

/** Start once after sign-in. Safe to call again (no-op). */
export function startTracking(): void {
  if (cfg || typeof window === 'undefined' || trackingOff()) return;
  cfg = { app: 'foxtail', getToken, endpoint: `${API_BASE}/activity/beat` };
  sid = newSid();
  document.addEventListener('click', onClick, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('error', ev => trackEvent('error', String(ev.message || 'Script error')));
  timer = setInterval(() => { if (visible()) send(); }, 20000);
}
export function stopTracking(): void {
  if (!cfg) return;
  onHide();
  document.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onHide);
  if (timer) clearInterval(timer);
  cfg = null; timer = null; page = null; queue = [];
}
