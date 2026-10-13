/**
 * Getting one picture from a store camera (carried over from Eye of Omni's frame capture + RTSP probe).
 *
 *  direct recorders – ffmpeg opens the RTSP sub-stream and returns one JPEG
 *  edge recorders   – the on-site edge agent pushes frames; we use the newest one if it is fresh
 *
 * Frames live in memory only for the next detection; Foxtail never stores camera images.
 */
import { spawn } from 'node:child_process';
import { buildRtspUrl, redactRtsp } from '@foxtail/shared';
import { getRecorderCredentials, type Camera } from './recorders.js';

export interface FrameResult { ok: boolean; jpeg?: Buffer; capturedAt?: Date; error?: string }

const CAPTURE_TIMEOUT_MS = Number(process.env.CAPTURE_TIMEOUT_MS || 10000);

// ------------------------------------------------------------------------------------- edge frames

const edgeFrames = new Map<string, { jpeg: Buffer; capturedAt: Date; receivedAt: number }>();
/** Keep at most this many cameras' latest frames in memory. */
const EDGE_CACHE_MAX = 2000;

export function putEdgeFrame(cameraId: string, jpeg: Buffer, capturedAt: Date): void {
  edgeFrames.delete(cameraId);
  edgeFrames.set(cameraId, { jpeg, capturedAt, receivedAt: Date.now() });
  if (edgeFrames.size > EDGE_CACHE_MAX) edgeFrames.delete(edgeFrames.keys().next().value as string);
}

function edgeFrame(cameraId: string, maxAgeMs: number): FrameResult {
  const f = edgeFrames.get(cameraId);
  if (!f) return { ok: false, error: 'No picture from the edge agent yet' };
  if (Date.now() - f.receivedAt > maxAgeMs) return { ok: false, error: 'The edge agent has not sent a new picture recently' };
  return { ok: true, jpeg: f.jpeg, capturedAt: f.capturedAt };
}

export function clearEdgeFrames(): void { edgeFrames.clear(); }

// ------------------------------------------------------------------------------------- RTSP

export function captureFromRtsp(url: string, timeoutMs = CAPTURE_TIMEOUT_MS): Promise<FrameResult> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let stderr = '';
    let proc;
    try {
      proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-frames:v', '1', '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: `ffmpeg could not start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.code === 'ENOENT' ? 'ffmpeg is not installed on the server' : redactRtsp(e.message) });
    });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(chunks);
      if (code === 0 && jpeg.length > 1000) { resolve({ ok: true, jpeg, capturedAt: new Date() }); return; }
      if (signal === 'SIGKILL') { resolve({ ok: false, error: 'The recorder did not send a picture in time' }); return; }
      resolve({ ok: false, error: friendlyError(stderr) || `ffmpeg exited with code ${code}` });
    });
  });
}

function friendlyError(stderr: string): string | null {
  const s = redactRtsp(stderr);
  if (/401|Unauthorized/i.test(s)) return 'The recorder rejected the username or password';
  if (/404|Not Found|453/i.test(s)) return 'The recorder has no stream on that channel';
  if (/Connection refused|timed out|No route to host|unreachable|getaddrinfo|Name or service not known/i.test(s)) return 'Could not reach the recorder at that address and port';
  const line = s.trim().split('\n').pop();
  return line ? line.slice(0, 200) : null;
}

export type ProbeErrorClass = 'auth' | 'unreachable' | 'no-camera' | 'timeout' | 'ffprobe-missing' | 'unknown';
export interface ProbeResult { ok: boolean; codec?: string; width?: number; height?: number; errorClass?: ProbeErrorClass; error?: string; elapsedMs: number }

export const PROBE_HINTS: Record<ProbeErrorClass, string> = {
  auth: 'The recorder rejected the username or password. Some recorders use a separate RTSP login.',
  unreachable: 'Nothing answered on that address and port. Check the address, that RTSP is forwarded on the store router, and that the recorder is online. If the recorder is only reachable inside the store, use the edge agent.',
  'no-camera': 'The recorder answered but has no stream on that channel. Try another channel number.',
  timeout: 'The recorder did not respond in time. A slow link or a wrong port usually causes this.',
  'ffprobe-missing': 'ffprobe is not installed on the server, so streams cannot be tested here.',
  unknown: 'The stream could not be opened. Check the brand, path and channel.',
};

function classifyProbeError(text: string): ProbeErrorClass {
  if (/401|Unauthorized|403|Forbidden/i.test(text)) return 'auth';
  if (/Server returned 5\d\d|DESCRIBE failed: 5\d\d|404 Not Found|Server returned 404|Stream not found|453/i.test(text)) return 'no-camera';
  if (/Connection timed out|timed out|Connection refused|No route to host|Network is unreachable|getaddrinfo|Name or service not known|I\/O error/i.test(text)) return 'unreachable';
  return 'unknown';
}

/** Open the stream with ffprobe and read the first video stream. Never throws. */
export function probeRtsp(url: string, timeoutMs = 8000): Promise<ProbeResult> {
  const started = Date.now();
  return new Promise(resolve => {
    let proc;
    try {
      proc = spawn('ffprobe', ['-v', 'error', '-rtsp_transport', 'tcp', '-timeout', String(timeoutMs * 1000), '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, errorClass: 'ffprobe-missing', error: String(err), elapsedMs: Date.now() - started });
      return;
    }
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs + 2000);
    proc.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ ok: false, errorClass: e.code === 'ENOENT' ? 'ffprobe-missing' : 'unknown', error: redactRtsp(e.message), elapsedMs: Date.now() - started });
    });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      if (signal === 'SIGKILL') { resolve({ ok: false, errorClass: 'timeout', error: 'Probe timed out', elapsedMs }); return; }
      try {
        const s = JSON.parse(out || '{}').streams?.[0];
        if (code === 0 && s?.codec_name) { resolve({ ok: true, codec: s.codec_name, width: s.width, height: s.height, elapsedMs }); return; }
      } catch { /* fall through */ }
      const text = redactRtsp(err.trim().split('\n').pop() || `ffprobe exited with code ${code}`);
      resolve({ ok: false, errorClass: classifyProbeError(err || text), error: text.slice(0, 300), elapsedMs });
    });
  });
}

// ------------------------------------------------------------------------------------- one entry point

/** A fresh picture from this camera, however the store's recorder is connected. Never guesses. */
export async function grabFrame(storeId: string, camera: Camera, edgeMaxAgeMs = 90_000): Promise<FrameResult> {
  const rec = await getRecorderCredentials(storeId);
  if (!rec) return { ok: false, error: 'No recorder is set up for this store' };
  if (rec.connection === 'edge') return edgeFrame(camera.id, edgeMaxAgeMs);
  if (!rec.host || !rec.username || !rec.password) return { ok: false, error: 'The recorder address or login is incomplete' };
  const url = buildRtspUrl({ vendor: rec.vendor, host: rec.host, port: rec.rtspPort, username: rec.username, password: rec.password, channel: camera.channel, profile: rec.streamProfile, pathTemplate: rec.pathTemplate });
  return captureFromRtsp(url);
}

/** RTSP URL for a test probe (direct recorders only). */
export async function probeUrlFor(storeId: string, channel: number): Promise<string | null> {
  const rec = await getRecorderCredentials(storeId);
  if (!rec || rec.connection !== 'direct' || !rec.host || !rec.username || !rec.password) return null;
  return buildRtspUrl({ vendor: rec.vendor, host: rec.host, port: rec.rtspPort, username: rec.username, password: rec.password, channel, profile: rec.streamProfile, pathTemplate: rec.pathTemplate });
}
