import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';
import Account from './pages/Account';
import Security from './pages/Security';
import Overview from './pages/Overview';
import Stores from './pages/Stores';
import StoreDetail from './pages/StoreDetail';
import StoreSettings from './pages/StoreSettings';
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import Cameras from './pages/Cameras';
import ProspectLink from './pages/ProspectLink';
import Mirror from './pages/Mirror';
import { startTracking, trackPage } from './lib/track';
import { isInvitePath } from '@foxtail/shared';

/** Friendly page names for the activity timeline (the page itself adds store names as separate events). */
function pageTitle(p: string): string {
  if (p === '/') return 'Overview';
  if (/^\/stores\/[^/]+\/settings/.test(p)) return 'Store settings';
  if (/^\/stores\/[^/]+/.test(p)) return 'Store detail';
  const m: Record<string, string> = { '/stores': 'Stores', '/cameras': 'Cameras', '/reports': 'Reports', '/security': 'Security', '/admin': 'Admin', '/account': 'Account' };
  return m[p] ?? p;
}

export default function App() {
  const { user, ready, isCorporate, canManage } = useAuth();
  const location = useLocation();
  // First-party usage tracking (Omni staff see it under Prospect & owner activity). Off in "See what they see" tabs.
  useEffect(() => { if (user) startTracking(); }, [user]);
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => trackPage(location.pathname + location.search, pageTitle(location.pathname)), 400);
    return () => window.clearTimeout(t);
  }, [user, location.pathname, location.search]);
  if (location.pathname === '/mirror') return <Mirror />;
  if (!ready) return <div className="p-8"><Loading /></div>;
  if (isInvitePath(location.pathname)) return <ProspectLink />;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <Account forced />;
  return (
    <Layout>
      <Routes>
        <Route path="/security" element={<Security />} />
        <Route path="/" element={<Overview />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/stores/:storeId" element={<StoreDetail />} />
        {isCorporate && <Route path="/stores/:storeId/settings" element={<StoreSettings />} />}
        <Route path="/cameras" element={<Cameras />} />
        <Route path="/reports" element={<Reports />} />
        {canManage && <Route path="/admin" element={<Admin />} />}
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
