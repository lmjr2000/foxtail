/**
 * /mirror — Omni staff "See what they see" for a prospect link. Opened from the Omni dashboard with
 * #t=<read-only 2h session of that link>&f=<follow key>&to=<their current page>. The session lives in this tab only
 * (sessionStorage), usage tracking is off here, and every write is refused server-side (demo login).
 */
import { useEffect, useState } from 'react';
import { MIRROR_KEY } from '../lib/api';
import { Loading } from '../components/ui';

export const MIRROR_FOLLOW_KEY = 'foxtail_mirror_follow';

export default function Mirror() {
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const t = h.get('t'), f = h.get('f');
    const to = h.get('to') || '/';
    history.replaceState(null, '', '/mirror'); // drop the session from the address bar
    if (!t) { setBad(true); return; }
    try {
      sessionStorage.setItem(MIRROR_KEY, '1');
      sessionStorage.setItem('foxtail_token', t);
      sessionStorage.setItem('foxtail_demo', '1');
      if (f) sessionStorage.setItem(MIRROR_FOLLOW_KEY, f);
    } catch { setBad(true); return; }
    const safe = to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/d/') && !to.startsWith('/mirror') ? to : '/';
    window.location.replace(safe);
  }, []);
  if (!bad) return <div className="min-h-screen flex items-center justify-center bg-black"><Loading label="Opening their view…" /></div>;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-black px-6 text-center">
      <img src="/foxtail-wordmark-white.png" alt="Foxtail Coffee Co." className="h-10 w-auto" />
      <h1 className="text-xl font-semibold text-white">This view link is not valid</h1>
      <p className="text-sm text-neutral-400 max-w-xs">Open “See what they see” again from the Omni dashboard.</p>
    </div>
  );
}
