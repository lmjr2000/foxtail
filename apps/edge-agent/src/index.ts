/**
 * Foxtail edge agent: runs on a small computer inside a store whose recorder the cloud cannot reach.
 * It asks Foxtail which cameras to count and how often, grabs one JPEG per camera from the recorder on
 * the store network (ffmpeg over RTSP), and sends it to Foxtail. Counting happens in the cloud.
 *
 * The recorder login stays on this machine (environment variables below); Foxtail never sends it.
 * Nothing is stored here, and nothing is sent while the store is closed or counting is off.
 *
 * Environment:
 *   FOXTAIL_URL          e.g. https://foxtail.example.com
 *   EDGE_TOKEN           the store's edge token (Store settings → Recorder → Create edge token)
 *   RECORDER_HOST        recorder IP on the store network, e.g. 192.168.1.50
 *   RECORDER_USER / RECORDER_PASSWORD
 *   RECORDER_VENDOR      uniview (default) | hikvision | dahua | generic | custom
 *   RECORDER_PORT        RTSP port (default 554)
 *   RECORDER_PATH        stream path for "custom", e.g. /live/{ch}
 *   RECORDER_STREAM      sub (default) | main
 */
import { spawn } from 'node:child_process';
import { buildRtspUrl, redactRtsp, RECORDER_VENDORS, type RecorderVendor } from '@foxtail/shared';

const VERSION = '0.1.0';
const BASE = (process.env.FOXTAIL_URL || '').replace(/\/$/, '');
const TOKEN = process.env.EDGE_TOKEN || '';

interface EdgeConfig { storeName: string; openNow: boolean; countingEnabled: boolean; intervalSeconds: number; cameras: Array<{ id: string; name: string; channel: number; counting: boolean }> }

function env(name: string, fallback = ''): string { return (process.env[name] ?? fallback).trim(); }

function recorderUrl(channel: number): string {
  const vendor = env('RECORDER_VENDOR', 'uniview') as RecorderVendor;
  if (!(RECORDER_VENDORS as readonly string[]).includes(vendor)) throw new Error(`RECORDER_VENDOR must be one of ${RECORDER_VENDORS.join(', ')}`);
  return buildRtspUrl({
    vendor, host: env('RECORDER_HOST'), port: Number(env('RECORDER_PORT', '554')), username: env('RECORDER_USER'), password: process.env.RECORDER_PASSWORD || '',
    channel, profile: env('RECORDER_STREAM') === 'main' ? 'main' : 'sub', pathTemplate: env('RECORDER_PATH') || null,
  });
}

function grab(url: string, timeoutMs = 10_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-frames:v', '1', '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(chunks);
      if (code === 0 && jpeg.length > 1000) resolve(jpeg);
      else reject(new Error(redactRtsp(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`)));
    });
  });
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), 'X-Edge-Token': TOKEN, 'X-Edge-Version': VERSION } });
}

async function loadConfig(): Promise<EdgeConfig | null> {
  try {
    const res = await call('/api/edge/config');
    if (res.status === 401) { console.error('[edge] Foxtail rejected the edge token. Create a new one in Store settings → Recorder.'); return null; }
    if (!res.ok) { console.error(`[edge] config request failed: HTTP ${res.status}`); return null; }
    return (await res.json()) as EdgeConfig;
  } catch (err) {
    console.error('[edge] cannot reach Foxtail:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function sendFrames(cfg: EdgeConfig): Promise<void> {
  for (const cam of cfg.cameras.filter(c => c.counting)) {
    try {
      const jpeg = await grab(recorderUrl(cam.channel));
      const res = await call(`/api/edge/frames/${encodeURIComponent(cam.id)}`, { method: 'POST', body: new Uint8Array(jpeg), headers: { 'Content-Type': 'image/jpeg', 'X-Captured-At': new Date().toISOString() } });
      if (!res.ok) console.error(`[edge] ${cam.name}: upload failed (HTTP ${res.status})`);
    } catch (err) {
      console.error(`[edge] ${cam.name} (channel ${cam.channel}):`, err instanceof Error ? err.message : err);
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!BASE || !TOKEN) throw new Error('Set FOXTAIL_URL and EDGE_TOKEN.');
  if (!env('RECORDER_HOST') || !env('RECORDER_USER')) throw new Error('Set RECORDER_HOST, RECORDER_USER and RECORDER_PASSWORD.');
  console.log(`[edge] Foxtail edge agent ${VERSION} starting`);
  let cfg: EdgeConfig | null = null;
  let cfgAt = 0;
  for (;;) {
    if (!cfg || Date.now() - cfgAt > 60_000) {
      const next = await loadConfig();
      if (next) {
        if (!cfg) console.log(`[edge] connected for "${next.storeName}", ${next.cameras.filter(c => c.counting).length} counting camera(s)`);
        cfg = next;
        cfgAt = Date.now();
      }
    }
    const started = Date.now();
    if (cfg && cfg.openNow && cfg.countingEnabled) await sendFrames(cfg);
    const interval = (cfg?.intervalSeconds ?? 60) * 1000;
    await sleep(Math.max(1000, interval - (Date.now() - started)));
  }
}

main().catch(err => { console.error('[edge]', err instanceof Error ? err.message : err); process.exit(1); });
