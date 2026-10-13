import { Navigate, Route, Routes } from 'react-router-dom';
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

export default function App() {
  const { user, ready, isCorporate, canManage } = useAuth();
  if (!ready) return <div className="p-8"><Loading /></div>;
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
