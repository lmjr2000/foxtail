/** Top banner in a "See what they see" tab: read-only notice + follow the prospect's current page. */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_BASE, isMirrorSession } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MIRROR_FOLLOW_KEY } from '../pages/Mirror';

export default function MirrorBanner() {
  const { user } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();
  const [follow, setFollow] = useState(true);
  const [state, setState] = useState<{ online: boolean; path: string | null; title: string | null } | null>(null);
  const [expired, setExpired] = useState(false);
  const fk = (() => { try { return sessionStorage.getItem(MIRROR_FOLLOW_KEY); } catch { return null; } })();
  const mirror = isMirrorSession();

  useEffect(() => {
    if (!mirror || !fk) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/activity/follow/${encodeURIComponent(fk)}`, { cache: 'no-store' });
        if (r.status === 404) { if (!stop) setExpired(true); return; }
        if (r.ok && !stop) setState(await r.json());
      } catch { /* offline */ }
    };
    void tick(); const i = window.setInterval(tick, 4000);
    return () => { stop = true; window.clearInterval(i); };
  }, [mirror, fk]);

  useEffect(() => {
    if (!follow || !state?.online || !state.path || state.path.startsWith('/d/') || state.path.startsWith('/mirror')) return;
    if (state.path !== loc.pathname + loc.search) navigate(state.path);
  }, [follow, state, loc.pathname, loc.search, navigate]);

  if (!mirror) return null;
  return (
    <div className="sticky top-0 z-[70] bg-[#c8102e] text-white text-xs sm:text-sm px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="mirror-banner">
      <b className="font-semibold">Viewing as {user?.name ?? 'prospect'} · read-only</b>
      <span className="opacity-90">
        {expired ? 'This view expired. Open it again from Omni.' : !fk ? 'Their page is not followed.' : state?.online ? `They are on ${state.title || state.path || 'the app'}` : 'They are offline right now'}
      </span>
      {fk && !expired && (
        <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer select-none" data-no-track>
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} className="accent-white" /> Follow their screen
        </label>
      )}
    </div>
  );
}
