/**
 * Camera tiles and the live player (adapted from Eye of Omni's Live wall). Pictures and video come
 * only through the signed-in, store-scoped API; hls.js sends the session header with every request.
 */
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { fetchImage, getToken, type Camera, type VideoMode } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { Modal, Pill } from './ui';

export function StatusPill({ status, at }: { status: Camera['status']; at?: string | null }) {
  const tone = status === 'online' ? 'ok' : status === 'offline' ? 'bad' : 'neutral';
  const text = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown';
  return <Pill tone={tone} title={at ? `Last checked ${fmtAgo(at)}` : undefined}>{text}</Pill>;
}

/** Latest picture of a camera, refreshed every `refreshMs` while the tile is on screen. */
export function CameraPicture({ storeId, camera, refreshMs = 30_000, className = '' }: { storeId: string; camera: Camera; refreshMs?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true, current: string | null = null, timer = 0;
    const load = async () => {
      if (!ref.current || document.visibilityState !== 'visible') return;
      const r = ref.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // off screen: don't ask the recorder
      try {
        const url = await fetchImage(`/stores/${storeId}/cameras/${camera.id}/picture.jpg`);
        if (!alive) { URL.revokeObjectURL(url); return; }
        if (current) URL.revokeObjectURL(current);
        current = url; setSrc(url); setError(null);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : 'No picture'); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    timer = window.setInterval(load, refreshMs);
    return () => { alive = false; window.clearInterval(timer); if (current) URL.revokeObjectURL(current); };
  }, [storeId, camera.id, refreshMs]);
  return (
    <div ref={ref} className={`relative bg-black overflow-hidden ${className}`} style={{ aspectRatio: '16 / 9' }}>
      {src ? <img src={src} alt={camera.name} className="absolute inset-0 w-full h-full object-cover" />
        : <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-white/60">{loading ? 'Getting picture…' : error}</div>}
    </div>
  );
}

/** Live HLS video. Retries while the server is starting the camera's stream. */
export function LivePlayer({ storeId, camera }: { storeId: string; camera: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'loading' | 'playing' | 'error'>('loading');
  const [message, setMessage] = useState('Starting video…');
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const src = `/api/stores/${storeId}/cameras/${camera.id}/live/index.m3u8`;
    let hls: Hls | null = null;
    let tries = 0, stopped = false, retry = 0;
    const startHls = () => {
      if (stopped) return;
      hls?.destroy();
      hls = new Hls({
        liveSyncDurationCount: 2,
        xhrSetup: xhr => { xhr.setRequestHeader('Authorization', `Bearer ${getToken() ?? ''}`); },
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { setState('playing'); void video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        const status = (data.response as { code?: number } | undefined)?.code;
        const text = (data.response as { text?: string } | undefined)?.text;
        let reason = '';
        try { reason = text ? JSON.parse(text).message : ''; } catch { /* not JSON */ }
        // 503 = the stream is still starting; keep trying for ~40 s.
        if ((status === 503 || data.type === Hls.ErrorTypes.NETWORK_ERROR && !status) && tries < 8) {
          tries++; setMessage(reason || 'Starting video…');
          retry = window.setTimeout(startHls, 4000);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls?.recoverMediaError(); return; }
        setState('error'); setMessage(reason || 'Live video is not available right now.');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    };
    if (Hls.isSupported()) startHls();
    else { setState('error'); setMessage('This browser cannot play live video. Try Chrome, Edge or Firefox.'); }
    return () => { stopped = true; window.clearTimeout(retry); hls?.destroy(); };
  }, [storeId, camera.id]);
  return (
    <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" muted playsInline autoPlay controls={state === 'playing'} />
      {state !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/80">
          {state === 'loading' && <span className="w-6 h-6 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
          <span>{message}</span>
        </div>
      )}
      {state === 'playing' && <span className="absolute top-2 left-2 badge bg-bad-fill text-white">● LIVE</span>}
    </div>
  );
}

/** Camera tile: picture (or a status card when there is no video yet) + name + status. Click to open. */
export function CameraTile({ storeId, camera, video, onOpen }: { storeId: string; camera: Camera; video: VideoMode; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="card overflow-hidden text-left hover:shadow-card-hover hover:border-accent transition-colors" data-testid="camera-tile">
      {video === 'none'
        ? <div className="bg-surface-2 flex flex-col items-center justify-center gap-1 text-center px-3" style={{ aspectRatio: '16 / 9' }}>
            <span className="text-2xl text-ink-4">▣</span>
            <span className="text-[11px] text-ink-3">Video not connected yet</span>
          </div>
        : <CameraPicture storeId={storeId} camera={camera} />}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink truncate">{camera.name}</div>
          <div className="text-[11px] text-ink-4">Ch {camera.channel}{camera.statusAt ? ` · ${fmtAgo(camera.statusAt)}` : ''}</div>
        </div>
        <StatusPill status={camera.status} at={camera.statusAt} />
      </div>
    </button>
  );
}

/** Full view of one camera: live video, latest pictures (edge), or why there is no video yet. */
export function CameraModal({ storeId, storeName, camera, video, reason, onClose }: { storeId: string; storeName: string; camera: Camera; video: VideoMode; reason: string | null; onClose: () => void }) {
  return (
    <Modal title={`${storeName} · ${camera.name}`} open onClose={onClose} wide>
      {video === 'live' ? <LivePlayer storeId={storeId} camera={camera} />
        : video === 'pictures' ? <><CameraPicture storeId={storeId} camera={camera} refreshMs={10_000} className="rounded-lg" /><p className="mt-2 text-xs text-ink-3">{reason}</p></>
        : <div className="callout callout-info">{reason || 'Video is not connected for this store yet.'}</div>}
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div><dt className="text-ink-4">Status</dt><dd className="mt-0.5"><StatusPill status={camera.status} at={camera.statusAt} /></dd></div>
        <div><dt className="text-ink-4">Channel</dt><dd className="text-ink">{camera.channel}</dd></div>
        <div><dt className="text-ink-4">Last checked</dt><dd className="text-ink">{camera.statusAt ? `${fmtAgo(camera.statusAt)}${camera.statusSource === 'ezcloud' ? ' (EZCloud)' : ''}` : '—'}</dd></div>
        <div><dt className="text-ink-4">Serial</dt><dd className="text-ink truncate">{camera.serialNo || '—'}</dd></div>
      </dl>
    </Modal>
  );
}
