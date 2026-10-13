import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ROLE_LABELS } from '@foxtail/shared';
import { useAuth } from '../lib/auth';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Foxtail home">
      <img src="/foxtail-wordmark-white.png" alt="Foxtail Coffee Co." className="h-6 w-auto" />
      <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 border-l border-white/25 pl-2">Store performance</span>
    </Link>
  );
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('foxtail_theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, isCorporate, canManage, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const items: Array<{ to: string; label: string; end?: boolean }> = [
    { to: '/', label: isCorporate ? 'Overview' : 'My stores', end: true },
    { to: '/stores', label: 'Stores' },
    { to: '/reports', label: 'Reports' },
  ];
  if (canManage) items.push({ to: '/admin', label: 'Admin' });
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-control text-sm font-medium transition-colors ${isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:text-white hover:bg-white/10'}`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand border-b border-black/20">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <Logo />
          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {items.map(i => <NavLink key={i.to} to={i.to} end={i.end} className={link}>{i.label}</NavLink>)}
          </nav>
          <div className="ml-auto relative">
            <button type="button" className="flex items-center gap-2 text-sm text-white/85 hover:text-white px-2 py-1 rounded-control hover:bg-white/10" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu">
              <span className="w-7 h-7 rounded-full bg-accent text-white grid place-items-center text-xs font-bold">{(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}</span>
              <span className="hidden sm:inline max-w-[14rem] truncate">{user?.name || user?.email}</span>
            </button>
            {menu && (
              <>
                <button type="button" tabIndex={-1} aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
                <div role="menu" className="absolute right-0 mt-2 w-60 card shadow-elevated py-1 z-20">
                  <div className="px-3 py-2 border-b border-line">
                    <div className="text-sm text-ink truncate">{user?.email}</div>
                    <div className="text-xs text-ink-3">{user ? ROLE_LABELS[user.role] : ''}</div>
                  </div>
                  <Link role="menuitem" to="/account" className="block px-3 py-2 text-sm text-ink hover:bg-surface-2" onClick={() => setMenu(false)}>Change password</Link>
                  <button role="menuitem" type="button" className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-surface-2" onClick={() => { toggleTheme(); setMenu(false); }}>Light / dark</button>
                  <button role="menuitem" type="button" className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-surface-2" onClick={signOut}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
        <nav className="md:hidden flex gap-1 px-3 pb-2 overflow-x-auto" aria-label="Main">
          {items.map(i => <NavLink key={i.to} to={i.to} end={i.end} className={link}>{i.label}</NavLink>)}
        </nav>
      </header>
      <main key={loc.pathname.split('/')[1]} className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>
      <footer className="text-center text-xs text-ink-4 py-6">Foxtail Coffee Co. · store performance · counts only, no recordings kept</footer>
    </div>
  );
}
