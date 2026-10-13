/**
 * Person detector: Roboflow hosted inference returning people boxes (carried over from Eye of Omni).
 *
 * Env: ROBOFLOW_API_KEY and PERSON_MODEL_ID (e.g. a COCO-style model that has a "person" class).
 * Only boxes whose class is in PERSON_CLASSES (default "person") count. Fails closed: no key, no model
 * or any error = no detections and an error string, never a guessed count. Every call costs money on
 * the Roboflow account, so nothing runs until an admin turns counting on for a store.
 */
import type { PersonBox } from './tracking.js';

const TIMEOUT_MS = 15000;

export interface PeopleResult { ok: boolean; boxes: PersonBox[]; width: number; height: number; error: string | null; model: string; latencyMs: number }

export function personModelId(): string {
  return (process.env.PERSON_MODEL_ID || '').trim();
}
function personClasses(): string[] {
  return (process.env.PERSON_CLASSES || 'person').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function minConfidence(): number {
  const v = parseFloat(process.env.PERSON_MIN_CONFIDENCE || '0.35');
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.35;
}
export function detectorConfigured(): boolean {
  return !!(process.env.ROBOFLOW_API_KEY || '').trim() && !!personModelId() && process.env.DETECTOR_ENABLED !== 'false';
}

function redact(s: string): string {
  const k = (process.env.ROBOFLOW_API_KEY || '').trim();
  return k.length >= 4 ? s.split(k).join('[REDACTED]') : s;
}

export async function detectPeople(jpeg: Buffer): Promise<PeopleResult> {
  const start = Date.now();
  const model = personModelId();
  const key = (process.env.ROBOFLOW_API_KEY || '').trim();
  if (!detectorConfigured()) {
    return { ok: false, boxes: [], width: 0, height: 0, error: 'Person detection is not configured on this server (ROBOFLOW_API_KEY, PERSON_MODEL_ID)', model, latencyMs: 0 };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const conf = minConfidence();
    const url = `https://detect.roboflow.com/${model}?api_key=${encodeURIComponent(key)}&confidence=${Math.floor(conf * 100)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: jpeg.toString('base64'), signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, boxes: [], width: 0, height: 0, error: redact(`HTTP ${res.status}: ${txt.slice(0, 160)}`), model, latencyMs: Date.now() - start };
    }
    const data = await res.json() as { image?: { width: number; height: number }; predictions?: Array<{ class: string; confidence: number; x: number; y: number; width: number; height: number }> };
    const classes = personClasses();
    const boxes = (data.predictions || [])
      .filter(p => p.confidence >= conf && classes.includes(String(p.class).toLowerCase()))
      .map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height, confidence: p.confidence }));
    return { ok: true, boxes, width: data.image?.width || 0, height: data.image?.height || 0, error: null, model, latencyMs: Date.now() - start };
  } catch (err) {
    const abort = err instanceof Error && err.name === 'AbortError';
    return { ok: false, boxes: [], width: 0, height: 0, error: abort ? 'Person detector timed out' : redact(err instanceof Error ? err.message : String(err)), model, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}
