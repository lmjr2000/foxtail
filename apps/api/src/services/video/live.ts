/**
 * On-demand live video (adapted from Eye of Omni's scripts/hls-remux.mjs).
 *
 * The first viewer of a camera starts one ffmpeg that pulls the recorder's RTSP sub-stream and writes a
 * short rolling HLS playlist into HLS_DIR/<cameraId>/. Every playlist/segment request counts as "still
 * watching"; a camera nobody has asked for in VIEW_TTL_MS is stopped. Uniview sub-streams are usually
 * HEVC, which browsers cannot play, so non-H.264 sources are re-encoded to H.264 at 640px / 12 fps
 * (cheap enough for a small server); H.264 sources are copied.
 *
 * Video is only ever served through the signed-in, store-scoped API (routes/stores.ts); RTSP
 * credentials never leave the server. Nothing is recorded: segments roll over and are deleted.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactRtsp } from '@foxtail/shared';
import type { Camera } from '../recorders/recorders.js';
import { setCameraStatus } from '../recorders/recorders.js';

const HLS_DIR = process.env.HLS_DIR || join(tmpdir(), 'foxtail-hls');
const VIEW_TTL_MS = Number(process.env.LIVE_VIEW_TTL_MS || 45_000);
const MAX_STREAMS = Number(process.env.MAX_LIVE_STREAMS || 16);
const OUT_WIDTH = Number(process.env.LIVE_OUT_WIDTH || 640);
const OUT_FPS = Number(process.env.LIVE_OUT_FPS || 12);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/i, (_m, ext) => `ffprobe${ext || ''}`);
const isWin = process.platform === 'win32';

export type LiveState = 'starting' | 'running' | 'unreachable' | 'auth' | 'no-camera' | 'busy' | 'error';

interface Worker { cameraId: string; proc: ChildProcess; dir: string; state: LiveState; lastError: string | null; lastView: number; startedAt: number }

const workers = new Map<string, Worker>();
const starting = new Map<string, Promise<Worker>>();
const codecCache = new Map<string, string>();

function classify(line: string): LiveState | null {
  if (/404 Not Found|Server returned 404|Stream not found|454 Session Not Found/i.test(line)) return 'no-camera';
  if (/Server returned 5\d\d|DESCRIBE failed: 5\d\d/i.test(line)) return 'busy';
  if (/Connection timed out|timed out|Connection refused|No route to host|Network is unreachable|getaddrinfo|I\/O error/i.test(line)) return 'unreachable';
  if (/401|Unauthorized|403|Forbidden/i.test(line)) return 'auth';
  return null;
}

export const LIVE_HINTS: Record<LiveState, string> = {
  starting: 'Starting video…',
  running: '',
  unreachable: 'The store recorder could not be reached. Check that it is online and that its RTSP port is forwarded.',
  auth: 'The store recorder rejected the login saved in Foxtail.',
  'no-camera': 'The recorder has no video on this channel.',
  busy: 'The recorder is busy (too many people watching at once). Try again in a minute.',
  error: 'The video stream failed. Foxtail will retry when you reopen it.',
};

/** Video codec of the camera's stream (async: never blocks the server while the recorder answers). */
function probeCodec(cameraId: string, url: string): Promise<string> {
  const hit = codecCache.get(cameraId);
  if (hit) return Promise.resolve(hit);
  return new Promise(resolve => {
    let out = '';
    let proc: ChildProcess;
    try {
      proc = spawn(FFPROBE, ['-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '10000000', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', url], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { resolve('unknown'); return; }
    const timer = setTimeout(() => kill(proc), 15_000);
    proc.stdout?.on('data', d => { out += d.toString(); });
    proc.on('error', () => { clearTimeout(timer); resolve('unknown'); });
    proc.on('close', () => {
      clearTimeout(timer);
      const codec = out.trim().split(/\r?\n/)[0] || 'unknown';
      if (codec !== 'unknown') codecCache.set(cameraId, codec);
      resolve(codec);
    });
  });
}

function kill(proc: ChildProcess): void {
  if (proc.exitCode !== null) return;
  if (isWin && proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGTERM');
}

function stop(cameraId: string): void {
  const w = workers.get(cameraId);
  if (!w) return;
  workers.delete(cameraId);
  kill(w.proc);
  setTimeout(() => { try { rmSync(w.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* still flushing */ } }, 1500).unref();
}

function start(camera: Camera, rtspUrl: string, codec: string): Worker {
  const dir = join(HLS_DIR, camera.id);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* reuse */ }
  mkdirSync(dir, { recursive: true });
  // Unknown codec: re-encode (always plays; costs some CPU).
  const transcode = codec !== 'h264';
  const shrink = [OUT_FPS > 0 ? `fps=${OUT_FPS}` : '', OUT_WIDTH > 0 ? `scale='min(${OUT_WIDTH},iw)':-2` : ''].filter(Boolean).join(',');
  const video = transcode
    ? [...(shrink ? ['-vf', shrink] : []), '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '24', '-sc_threshold', '0', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy'];
  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning', '-nostdin', '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-fflags', '+genpts', '-use_wallclock_as_timestamps', '1', '-i', rtspUrl,
    ...video, '-an', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
    '-hls_segment_filename', join(dir, 'seg%06d.ts'), join(dir, 'index.m3u8'),
  ];
  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const w: Worker = { cameraId: camera.id, proc, dir, state: 'starting', lastError: null, lastView: Date.now(), startedAt: Date.now() };
  workers.set(camera.id, w);
  let buf = '';
  proc.stderr?.on('data', d => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const l of lines) { const c = classify(l); if (c) { w.state = c; w.lastError = redactRtsp(l.trim()).slice(0, 300); } }
  });
  proc.on('error', err => { w.state = 'error'; w.lastError = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'ffmpeg is not installed on the server' : err.message; });
  proc.on('exit', () => {
    if (w.state === 'starting' || w.state === 'running') w.state = 'error';
    if (w.state !== 'error' && w.state !== 'busy') setCameraStatus(camera.id, 'offline').catch(() => {});
    // Leave the failed worker in the map briefly so the viewer sees why; the reaper clears it.
  });
  return w;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, w] of workers) {
    const dead = w.proc.exitCode !== null;
    if (now - w.lastView > VIEW_TTL_MS || (dead && now - w.lastView > 10_000)) stop(id);
  }
}, 5_000).unref();

/**
 * The playlist for a camera, starting video if nobody is watching it yet. Waits up to ~15 s for the
 * first segments. Returns the playlist text, or the reason there is no video.
 */
export async function livePlaylist(camera: Camera, rtspUrl: string): Promise<{ ok: true; body: string } | { ok: false; state: LiveState; message: string; detail: string | null }> {
  let w = workers.get(camera.id);
  if (w && w.proc.exitCode !== null && Date.now() - w.startedAt > 15_000) { stop(camera.id); w = undefined; }
  if (!w) {
    if (workers.size + starting.size >= MAX_STREAMS) return { ok: false, state: 'busy', message: 'Too many cameras are being watched right now. Close another camera and try again.', detail: null };
    let p = starting.get(camera.id);
    if (!p) {
      p = probeCodec(camera.id, rtspUrl).then(codec => start(camera, rtspUrl, codec)).finally(() => starting.delete(camera.id));
      starting.set(camera.id, p);
    }
    w = await p;
  }
  w.lastView = Date.now();
  const file = join(w.dir, 'index.m3u8');
  const until = Date.now() + 15_000;
  while (!existsSync(file) && Date.now() < until && w.proc.exitCode === null) await new Promise(r => setTimeout(r, 250));
  if (!existsSync(file)) {
    const state = w.state === 'starting' ? (w.proc.exitCode === null ? 'starting' : 'error') : w.state;
    return { ok: false, state, message: LIVE_HINTS[state] || LIVE_HINTS.error, detail: w.lastError };
  }
  if (w.state !== 'running') { w.state = 'running'; setCameraStatus(camera.id, 'online').catch(() => {}); }
  return { ok: true, body: readFileSync(file, 'utf8') };
}

/** One HLS segment of a camera that is being watched (null when it is not, or the segment rolled off). */
export function liveSegment(cameraId: string, name: string): Buffer | null {
  if (!/^seg\d{6}\.ts$/.test(name)) return null;
  const w = workers.get(cameraId);
  if (!w) return null;
  w.lastView = Date.now();
  try { return readFileSync(join(w.dir, name)); } catch { return null; }
}

export function liveStatus(): Array<{ cameraId: string; state: LiveState; since: string }> {
  return [...workers.values()].map(w => ({ cameraId: w.cameraId, state: w.state, since: new Date(w.startedAt).toISOString() }));
}

export function stopAllLive(): void {
  for (const id of [...workers.keys()]) stop(id);
}
