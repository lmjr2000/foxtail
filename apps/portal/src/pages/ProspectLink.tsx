/** /d/:token — prospect link: exchange for a read-only demo session, then drop into the app. */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { inviteTokenFromPath } from '@foxtail/shared';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/ui';

type State = 'working' | 'expired' | 'busy' | 'error';

export default function ProspectLink() {
  const { inviteLogin, signOut } = useAuth();
  const [state, setState] = useState<State>('working');
  const ran = useRef(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    const token = inviteTokenFromPath(pathname);
    if (!token) { setState('expired'); return; }
    signOut();
    inviteLogin(token)
      .then(() => navigate('/', { replace: true }))
      .catch(err => setState(err instanceof ApiError && (err.status === 410 || err.status === 404) ? 'expired' : err instanceof ApiError && err.status === 429 ? 'busy' : 'error'));
  }, [inviteLogin, signOut, navigate, pathname]);

  if (state === 'working') return <div className="min-h-screen flex items-center justify-center bg-black"><div className="text-center"><Loading label="Opening…" /><p className="mt-3 text-[11px] text-neutral-500">Usage is recorded to improve the service.</p></div></div>;
  const title = state === 'expired' ? 'This link has expired' : state === 'busy' ? 'Please try again in a few minutes' : 'Something went wrong';
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-black px-6 text-center" data-testid="prospect-expired">
      <img src="/foxtail-wordmark-white.png" alt="Foxtail Coffee Co." className="h-10 w-auto" />
      <h1 className="text-xl font-semibold text-white">{title}</h1>
      {state === 'expired' && <p className="text-sm text-neutral-400 max-w-xs">Ask your Foxtail contact for a new link.</p>}
      <a href="/" className="btn-primary">Sign in</a>
    </div>
  );
}
