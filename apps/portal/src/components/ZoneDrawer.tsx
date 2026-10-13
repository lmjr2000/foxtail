/**
 * Draw a counting area on a camera's current picture (carried over from Eye of Omni). Click to add
 * corners, drag a corner to move it. Points are stored normalized (0..1). The picture is fetched with
 * the session header and never stored.
 */
import { useEffect, useRef, useState } from 'react';
import { getToken } from '../lib/api';

export type Point = [number, number];
export interface OtherArea { label: string; polygon: Point[] }

function useFrame(url: string) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true, obj: string | null = null;
    setLoading(true); setError(null);
    fetch(url, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
      .then(async r => {
        if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).message || m; } catch { /* binary */ } throw new Error(m); }
        obj = URL.createObjectURL(await r.blob());
        if (alive) setSrc(obj);
      })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'No picture'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [url]);
  return { src, error, loading };
}

export default function ZoneDrawer({ storeId, cameraId, cameraName, label, initial, others, onSave, onClose }: {
  storeId: string; cameraId: string; cameraName: string; label: string; initial: Point[] | null; others: OtherArea[];
  onSave: (polygon: Point[] | null) => void; onClose: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const { src, loading, error } = useFrame(`/api/stores/${storeId}/cameras/${cameraId}/frame.jpg?n=${nonce}`);
  const [pts, setPts] = useState<Point[]>(initial || []);
  const [drag, setDrag] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const toNorm = (e: { clientX: number; clientY: number }): Point => {
    const r = boxRef.current!.getBoundingClientRect();
    return [Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 1000) / 1000, Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 1000) / 1000];
  };

  return (
    <div className="fixed inset-0 z-[80] bg-overlay flex items-center justify-center p-2 sm:p-6">
      <div className="card w-full max-w-4xl max-h-full overflow-auto" role="dialog" aria-label={`Draw ${label}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div>
            <div className="text-sm font-semibold text-ink">Draw “{label}”</div>
            <div className="text-xs text-ink-3">{cameraName} · click the corners of the area on the floor</div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="p-3">
          <div ref={boxRef} className="relative w-full bg-black rounded overflow-hidden select-none touch-none" style={{ aspectRatio: '16 / 9' }}
            onPointerMove={e => { if (drag !== null) { moved.current = true; const p = toNorm(e); setPts(ps => ps.map((q, i) => (i === drag ? p : q))); } }}
            onPointerUp={() => setDrag(null)}
            onClick={e => { if (moved.current) { moved.current = false; return; } if ((e.target as HTMLElement).dataset.vertex) return; setPts(ps => [...ps, toNorm(e)]); }}>
            {src ? <img src={src} alt={cameraName} className="absolute inset-0 w-full h-full object-fill pointer-events-none" />
              : <div className="absolute inset-0 flex items-center justify-center text-xs text-white/70 px-6 text-center">{loading ? 'Getting a picture from the camera…' : `No picture: ${error}. You can still draw on the blank area.`}</div>}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
              {others.map(o => <polygon key={o.label + o.polygon.join()} points={o.polygon.map(p => p.join(',')).join(' ')} fill="#ffffff" fillOpacity={0.08} stroke="#ffffff" strokeOpacity={0.6} strokeDasharray="4 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
              {pts.length >= 2 && <polygon points={pts.map(p => p.join(',')).join(' ')} fill="#69c9cd" fillOpacity={0.3} stroke="#69c9cd" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
            </svg>
            {others.map(o => o.polygon[0] && <span key={'l' + o.label} className="absolute text-[10px] text-white/80 pointer-events-none" style={{ left: `${o.polygon[0][0] * 100}%`, top: `${o.polygon[0][1] * 100}%` }}>{o.label}</span>)}
            {pts.map((p, i) => (
              <div key={i} data-vertex="1" className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-accent cursor-move shadow"
                style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
                onPointerDown={e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); moved.current = false; setDrag(i); }} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPts(ps => ps.slice(0, -1))} disabled={!pts.length}>Undo corner</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPts([])} disabled={!pts.length}>Clear</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPts([[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]])}>Whole picture</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setNonce(n => n + 1)}>New picture</button>
            <span className="text-xs text-ink-3">{pts.length} corner{pts.length === 1 ? '' : 's'}{pts.length > 0 && pts.length < 3 ? ' — need at least 3' : ''}</span>
            <div className="flex-1" />
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={pts.length > 0 && pts.length < 3} onClick={() => onSave(pts.length >= 3 ? pts : null)}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
