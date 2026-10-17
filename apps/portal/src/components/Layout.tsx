import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ROLE_LABELS } from '@foxtail/shared';
import { useAuth } from '../lib/auth';
import AskEye from './AskEye';
import MirrorBanner from './MirrorBanner';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Foxtail home">
      <img src="/foxtail-wordmark-white.png" alt="Foxtail Coffee Co." className="h-6 w-auto" />
      <span className="hidden lg:inline text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 border-l border-white/25 pl-2">Store performance</span>
    </Link>
  );
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('foxtail_theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
}

const isPreview = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const TAB_ICONS: Record<string, { outline: ReactNode; solid: ReactNode }> = {
  security: {
    outline: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
    solid: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 00-.722-.516l-.143.001c-2.996 0-5.717-1.17-7.734-3.08zm3.094 8.016a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" /></svg>,
  },
  overview: {
    outline: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" /></svg>,
    solid: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M2.25 2.25a.75.75 0 000 1.5H3v10.5a3 3 0 003 3h1.21l-.17.51a.75.75 0 00.711.99h8.5a.75.75 0 00.71-.99l-.17-.51H18a3 3 0 003-3V3.75h.75a.75.75 0 000-1.5H2.25zm6.04 16.5l.5-1.5h6.42l.5 1.5H8.29zm7.46-12a.75.75 0 00-1.06.04l-2.548 2.746-1.088-1.09a.75.75 0 10-1.06 1.06l1.62 1.62a.75.75 0 001.064-.02l3.08-3.32a.75.75 0 00-.018-1.056z" clipRule="evenodd" /></svg>,
  },
  stores: {
    outline: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></svg>,
    solid: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M5.223 2.25c-.497 0-.974.198-1.325.55l-1.3 1.298A3.75 3.75 0 007.5 9.75c.627.47 1.406.75 2.25.75.844 0 1.624-.28 2.25-.75.626.47 1.406.75 2.25.75.844 0 1.623-.28 2.25-.75a3.75 3.75 0 004.902-5.652l-1.3-1.299a1.875 1.875 0 00-1.325-.549H5.223z" /><path fillRule="evenodd" d="M3 20.25v-8.755c1.42.674 3.08.673 4.5 0A5.234 5.234 0 009.75 12c.804 0 1.568-.182 2.25-.506a5.234 5.234 0 002.25.506c.804 0 1.567-.182 2.25-.506 1.42.674 3.08.675 4.5.001v8.755h.75a.75.75 0 010 1.5H2.25a.75.75 0 010-1.5H3zm3 0h4.5v-3.75a.75.75 0 01.75-.75h3a.75.75 0 01.75.75v3.75H18v-4.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v4.5z" clipRule="evenodd" /></svg>,
  },
  cameras: {
    outline: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>,
    solid: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" /></svg>,
  },
  more: {
    outline: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>,
    solid: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M3 6.75A.75.75 0 013.75 6h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 6.75zM3 12a.75.75 0 01.75-.75h16.5a.75.75 0 010 1.5H3.75A.75.75 0 013 12zm0 5.25a.75.75 0 01.75-.75h16.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z" clipRule="evenodd" /></svg>,
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  const { user, isCorporate, canManage, isDemo, signOut } = useAuth();
  const [moreMenu, setMoreMenu] = useState(false);
  const loc = useLocation();

  const desktopItems: Array<{ to: string; label: string; end?: boolean }> = [
    { to: '/security', label: 'Security' },
    { to: '/', label: isCorporate ? 'Overview' : 'My stores', end: true },
    { to: '/stores', label: 'Stores' },
    { to: '/cameras', label: 'Cameras' },
    { to: '/reports', label: 'Reports' },
  ];
  if (canManage && !isDemo) desktopItems.push({ to: '/admin', label: 'Admin' });

  const mobileTabItems = [
    { to: '/security', label: 'Security', key: 'security' },
    { to: '/', label: 'Overview', key: 'overview', end: true },
    { to: '/stores', label: 'Stores', key: 'stores' },
    { to: '/cameras', label: 'Cameras', key: 'cameras' },
  ];

  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-control text-sm font-medium transition-colors ${isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:text-white hover:bg-white/10'}`;

  const mobileTabClass = (isActive: boolean) =>
    `flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[64px] transition-colors ${isActive ? 'text-accent' : 'text-ink-3'}`;

  const currentPath = loc.pathname;
  const isMoreActive = ['/reports', '/admin', '/account'].some(p => currentPath.startsWith(p));

  return (
    <div className="min-h-screen flex flex-col">
      <MirrorBanner />
      {/* Demo banner */}
      {isDemo && (
        <div className="bg-accent text-white text-center py-2.5 px-4 text-sm font-semibold flex items-center justify-center gap-4 safe-top">
          <span>DEMO — viewing as {user ? ROLE_LABELS[user.role] : 'demo user'}<span className="block sm:inline sm:ml-2 text-[11px] font-normal opacity-80" data-testid="usage-notice">Usage is recorded to improve the service.</span></span>
          <button type="button" onClick={signOut} className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold min-h-[32px]">
            Exit demo
          </button>
        </div>
      )}

      {/* Preview banner */}
      {isPreview && !isDemo && (
        <div className="bg-amber-500 text-black text-center py-2 px-4 text-sm font-semibold safe-top">
          ⚠️ PREVIEW — SAMPLE DATA ONLY
        </div>
      )}

      {/* Desktop header */}
      <header className="bg-brand border-b border-black/20 hidden md:block">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <Logo />
          <nav className="flex items-center gap-1" aria-label="Main">
            {desktopItems.map(i => <NavLink key={i.to} to={i.to} end={i.end} className={link}>{i.label}</NavLink>)}
          </nav>
          <div className="ml-auto relative">
            <button type="button" className="flex items-center gap-2 text-sm text-white/85 hover:text-white px-2 py-1 rounded-control hover:bg-white/10 min-h-[40px]" onClick={() => setMoreMenu(m => !m)} aria-expanded={moreMenu} aria-haspopup="menu">
              <span className="w-8 h-8 rounded-full bg-accent text-white grid place-items-center text-sm font-bold">{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</span>
              <span className="hidden lg:inline max-w-[14rem] truncate">{user?.name || user?.email}</span>
            </button>
            {moreMenu && (
              <>
                <button type="button" tabIndex={-1} aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMoreMenu(false)} />
                <div role="menu" className="absolute right-0 mt-2 w-60 card shadow-elevated py-1 z-20">
                  <div className="px-4 py-3 border-b border-line">
                    <div className="text-sm text-ink truncate">{user?.email}</div>
                    <div className="text-xs text-ink-3">{user ? ROLE_LABELS[user.role] : ''}</div>
                  </div>
                  <Link role="menuitem" to="/account" className="block px-4 py-3 text-sm text-ink hover:bg-surface-2 min-h-[44px] flex items-center" onClick={() => setMoreMenu(false)}>Change password</Link>
                  <button role="menuitem" type="button" className="w-full text-left px-4 py-3 text-sm text-ink hover:bg-surface-2 min-h-[44px] flex items-center" onClick={() => { toggleTheme(); setMoreMenu(false); }}>Light / dark</button>
                  <button role="menuitem" type="button" className="w-full text-left px-4 py-3 text-sm text-ink hover:bg-surface-2 min-h-[44px] flex items-center" onClick={signOut}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile header */}
      <header className="bg-brand md:hidden safe-top">
        <div className="px-4 h-12 flex items-center justify-between">
          <Link to="/" aria-label="Home">
            <img src="/foxtail-wordmark-white.png" alt="Foxtail" className="h-5 w-auto" />
          </Link>
          <button type="button" onClick={() => setMoreMenu(m => !m)} className="w-10 h-10 flex items-center justify-center text-white/80 hover:text-white rounded-full hover:bg-white/10">
            <span className="w-8 h-8 rounded-full bg-accent text-white grid place-items-center text-sm font-bold">{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</span>
          </button>
        </div>
      </header>

      {/* Main content - with padding for mobile bottom nav */}
      <main key={loc.pathname.split('/')[1]} className="flex-1 w-full max-w-7xl mx-auto px-4 py-5 md:py-6 pb-24 md:pb-6 animate-fadeIn">
        {children}
      </main>

      {/* Desktop footer */}
      <footer className="hidden md:block text-center text-xs text-ink-4 py-6">
        Foxtail Coffee Co. · store performance · counts only, no recordings kept
      </footer>

      <AskEye />

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line safe-bottom z-40" aria-label="Main">
        <div className="flex justify-around items-stretch">
          {mobileTabItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => mobileTabClass(isActive)}
            >
              {({ isActive }) => (
                <>
                  {isActive ? TAB_ICONS[item.key].solid : TAB_ICONS[item.key].outline}
                  <span className="text-[10px] font-medium">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreMenu(true)}
            className={mobileTabClass(isMoreActive)}
          >
            {isMoreActive ? TAB_ICONS.more.solid : TAB_ICONS.more.outline}
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile "More" menu (full screen) */}
      {moreMenu && (
        <div className="md:hidden fixed inset-0 z-50 bg-page safe-top safe-bottom animate-slideUp">
          <div className="h-14 px-4 flex items-center justify-between border-b border-line">
            <h2 className="text-lg font-semibold text-ink">More</h2>
            <button type="button" onClick={() => setMoreMenu(false)} className="w-10 h-10 flex items-center justify-center text-ink-2 hover:text-ink rounded-full hover:bg-surface-2">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="p-4 space-y-2">
            <div className="card p-4 mb-4">
              <div className="text-sm text-ink truncate">{user?.email}</div>
              <div className="text-xs text-ink-3">{user ? ROLE_LABELS[user.role] : ''}</div>
            </div>
            <Link to="/reports" onClick={() => setMoreMenu(false)} className="flex items-center gap-4 px-4 py-4 rounded-xl hover:bg-surface-2 active:bg-surface-3">
              <svg className="w-6 h-6 text-ink-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
              <span className="text-base text-ink">Reports</span>
            </Link>
            {canManage && !isDemo && (
              <Link to="/admin" onClick={() => setMoreMenu(false)} className="flex items-center gap-4 px-4 py-4 rounded-xl hover:bg-surface-2 active:bg-surface-3">
                <svg className="w-6 h-6 text-ink-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                <span className="text-base text-ink">Admin</span>
              </Link>
            )}
            <Link to="/account" onClick={() => setMoreMenu(false)} className="flex items-center gap-4 px-4 py-4 rounded-xl hover:bg-surface-2 active:bg-surface-3">
              <svg className="w-6 h-6 text-ink-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
              <span className="text-base text-ink">Change password</span>
            </Link>
            <button type="button" onClick={() => { toggleTheme(); setMoreMenu(false); }} className="w-full flex items-center gap-4 px-4 py-4 rounded-xl hover:bg-surface-2 active:bg-surface-3">
              <svg className="w-6 h-6 text-ink-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>
              <span className="text-base text-ink">Light / dark mode</span>
            </button>
            <button type="button" onClick={signOut} className="w-full flex items-center gap-4 px-4 py-4 rounded-xl hover:bg-surface-2 active:bg-surface-3 text-bad">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>
              <span className="text-base">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
