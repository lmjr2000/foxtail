/**
 * Counting sampler (carried over from Eye of Omni). For every store with counting switched on, every
 * N seconds inside its opening hours: grab one frame per camera that has areas drawn, detect people,
 * assign them to the areas on that camera, and store one count row per area (zeros included).
 *
 * No frame = no row: the engine treats a missing round as a gap, never as zero customers.
 * Cost brake: one detector call per camera per round, a global hourly budget (MAX_DETECTIONS_PER_HOUR,
 * default 3000), and nothing at all runs until an admin turns counting on for a store.
 */
import { isZoneMeasurable, type Zone } from '@foxtail/shared';
import { storeForSystem } from '../stores.js';
import { getCamera, type Camera } from '../recorders/recorders.js';
import { grabFrame } from '../recorders/capture.js';
import { detectPeople, detectorConfigured } from './detector.js';
import { assignPeopleToZones, type PersonBox } from './tracking.js';
import { isOpenAt } from './time.js';
import * as countingStore from './store.js';
import type { EngineSample } from './engine.js';

export interface CameraStatus { cameraId: string; at: string; ok: boolean; people: number | null; error: string | null }
export interface StoreSamplerStatus { storeId: string; lastRoundAt: string | null; lastAttemptAt: string | null; lastError: string | null; cameras: CameraStatus[]; skipped: string | null }

const status = new Map<string, StoreSamplerStatus>();
const lastRun = new Map<string, number>();
const running = new Set<string>();
let hourWindow = { hour: -1, calls: 0 };

export function samplerStatus(storeId: string): StoreSamplerStatus | null { return status.get(storeId) ?? null; }

function budgetOk(): boolean {
  const h = Math.floor(Date.now() / 3600_000);
  if (hourWindow.hour !== h) hourWindow = { hour: h, calls: 0 };
  return hourWindow.calls < parseInt(process.env.MAX_DETECTIONS_PER_HOUR || '3000', 10);
}

export interface CameraDetection {
  cameraId: string; ok: boolean; error: string | null; boxes: PersonBox[]; width: number; height: number;
  zoneCounts: Map<string, Array<[number, number]>>; jpeg?: Buffer;
}

/** One camera: frame -> people -> areas. Shared by the sampler and the setup "Test" button. */
export async function detectForCamera(storeId: string, camera: Camera, zones: Zone[]): Promise<CameraDetection> {
  const empty = { boxes: [], width: 0, height: 0, zoneCounts: new Map<string, Array<[number, number]>>() };
  const frame = await grabFrame(storeId, camera);
  if (!frame.ok || !frame.jpeg) return { cameraId: camera.id, ok: false, error: frame.error || 'No picture', ...empty };
  hourWindow.calls++;
  const people = await detectPeople(frame.jpeg);
  if (!people.ok) return { cameraId: camera.id, ok: false, error: people.error, ...empty, jpeg: frame.jpeg };
  const zc = assignPeopleToZones(people.boxes, people.width, people.height, zones.filter(z => z.cameraId === camera.id && z.polygon).map(z => ({ id: z.id, polygon: z.polygon! })));
  return { cameraId: camera.id, ok: true, error: null, boxes: people.boxes, width: people.width, height: people.height, zoneCounts: zc, jpeg: frame.jpeg };
}

export async function runRound(storeId: string, now = new Date()): Promise<{ rows: number; cameras: CameraStatus[] }> {
  const zones = (await countingStore.getZones(storeId)).filter(isZoneMeasurable);
  const cameraIds = [...new Set(zones.map(z => z.cameraId!))];
  const rows: EngineSample[] = [];
  const camStatus: CameraStatus[] = [];
  for (const cameraId of cameraIds) {
    const camera = await getCamera(storeId, cameraId);
    if (!camera || !camera.enabled) continue;
    if (!budgetOk()) { camStatus.push({ cameraId, at: new Date().toISOString(), ok: false, people: null, error: 'Hourly detection budget reached' }); continue; }
    const d = await detectForCamera(storeId, camera, zones);
    camStatus.push({ cameraId, at: new Date().toISOString(), ok: d.ok, people: d.ok ? d.boxes.length : null, error: d.error });
    if (!d.ok) continue;
    for (const [zoneId, pts] of d.zoneCounts) rows.push({ roundAt: now, zoneId, cameraId, count: pts.length, points: pts });
  }
  await countingStore.insertSamples(storeId, rows);
  const okAny = camStatus.some(s => s.ok);
  status.set(storeId, {
    storeId, lastRoundAt: okAny ? now.toISOString() : status.get(storeId)?.lastRoundAt ?? null, lastAttemptAt: now.toISOString(),
    lastError: camStatus.find(s => !s.ok)?.error ?? null, cameras: camStatus, skipped: null,
  });
  return { rows: rows.length, cameras: camStatus };
}

let storeCache: { at: number; ids: string[] } = { at: 0, ids: [] };

export async function samplerTick(now = new Date()): Promise<void> {
  if (!detectorConfigured()) return;
  if (Date.now() - storeCache.at > 60_000) storeCache = { at: Date.now(), ids: await countingStore.samplingStoreIds() };
  for (const storeId of storeCache.ids) {
    const store = await storeForSystem(storeId);
    if (!store) continue;
    const cfg = await countingStore.loadConfig(store);
    if (!cfg.samplingEnabled) continue;
    const due = (lastRun.get(storeId) ?? 0) + cfg.sampleIntervalSeconds * 1000 <= now.getTime();
    if (!due || running.has(storeId)) continue;
    if (!isOpenAt(now, cfg.timezone, cfg.operatingHours)) {
      const s = status.get(storeId);
      status.set(storeId, { ...(s || { storeId, lastRoundAt: null, lastAttemptAt: null, lastError: null, cameras: [] }), skipped: 'Store is closed' });
      continue;
    }
    lastRun.set(storeId, now.getTime());
    running.add(storeId);
    // A round that never finishes (a camera or the detector hanging) must not stop this store's
    // counting until the next restart: after a few intervals the store is released for the next round.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const limitMs = Math.max(300_000, cfg.sampleIntervalSeconds * 5000);
    Promise.race([
      runRound(storeId, new Date()),
      new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error(`Round did not finish within ${Math.round(limitMs / 1000)}s; skipped`)), limitMs); }),
    ]).catch(err => {
      status.set(storeId, { storeId, lastRoundAt: status.get(storeId)?.lastRoundAt ?? null, lastAttemptAt: new Date().toISOString(), lastError: err instanceof Error ? err.message : String(err), cameras: [], skipped: null });
    }).finally(() => { if (watchdog) clearTimeout(watchdog); running.delete(storeId); });
  }
}

/** Forget cached store list (after an admin saves) so changes apply on the next tick. */
export function invalidateSampler(): void { storeCache.at = 0; }

const timers: Array<ReturnType<typeof setInterval>> = [];

export function startSampler(): void {
  if (process.env.SAMPLER_ENABLED === 'false') return;
  const safe = (name: string, fn: () => Promise<void>) => () => { fn().catch(err => console.error(`[${name}]`, err)); };
  timers.push(setInterval(safe('sampler', () => samplerTick()), 5000));
  timers.push(setInterval(safe('retention', () => countingStore.cleanupSamples()), 6 * 3600_000));
}

export function stopSampler(): void {
  while (timers.length) clearInterval(timers.pop()!);
}
