import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, useApi, type Alert, type AlertCounts, type AlertDetail, type CameraHealth } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Loading, ErrorNote, Empty } from '../components/ui';

type AlertFilter = 'open' | 'acknowledged' | 'all';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-blue-500 text-white',
  info: 'bg-gray-400 text-white',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${SEVERITY_COLORS[severity] || 'bg-gray-300'}`}>
      {severity}
    </span>
  );
}

function AlertCountCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`card p-4 ${count > 0 ? color : 'opacity-60'}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-sm text-ink-3 capitalize">{label}</div>
    </div>
  );
}

function AlertRow({ alert, onSelect }: { alert: Alert; onSelect: () => void }) {
  const age = formatAge(alert.createdAt);
  return (
    <tr className="border-b border-line hover:bg-surface-2 cursor-pointer" onClick={onSelect}>
      <td className="py-3 px-4"><SeverityBadge severity={alert.severity} /></td>
      <td className="py-3 px-4">{alert.title}</td>
      <td className="py-3 px-4 text-ink-3">{alert.storeName}</td>
      <td className="py-3 px-4 text-ink-3 text-sm">{alert.cameraName || '—'}</td>
      <td className="py-3 px-4 text-ink-3 text-sm whitespace-nowrap">{age}</td>
      <td className="py-3 px-4">
        {alert.status === 'acknowledged' ? (
          <span className="text-xs text-ink-3 bg-surface-2 px-2 py-1 rounded">Ack</span>
        ) : (
          <span className="text-xs text-accent font-medium">Open</span>
        )}
      </td>
    </tr>
  );
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function AlertDetailModal({ alertId, onClose }: { alertId: string; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<AlertDetail>(`/foxtail/alerts/${alertId}`);
  const { canManage } = useAuth();
  const [acking, setAcking] = useState(false);
  const [notes, setNotes] = useState('');

  const doAck = async () => {
    setAcking(true);
    try {
      await apiFetch(`/foxtail/alerts/${alertId}/acknowledge`, { method: 'POST', body: JSON.stringify({ notes: notes || undefined }) });
      reload();
    } catch { /* ignore */ }
    setAcking(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="card w-full max-w-lg mx-4 p-6 shadow-elevated" onClick={e => e.stopPropagation()}>
        {loading && <Loading />}
        <ErrorNote error={error} />
        {data && (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <SeverityBadge severity={data.severity} />
                <h2 className="text-lg font-semibold mt-2">{data.title}</h2>
                <div className="text-sm text-ink-3 mt-1">{data.storeName} {data.cameraName ? `· ${data.cameraName}` : ''}</div>
              </div>
              <button type="button" className="text-ink-3 hover:text-ink text-xl" onClick={onClose}>×</button>
            </div>

            {data.snapshotUrl && (
              <div className="mb-4 rounded overflow-hidden bg-black">
                <img src={data.snapshotUrl} alt="Alert snapshot" className="w-full" />
              </div>
            )}

            {data.detail && <p className="text-sm text-ink-2 mb-4">{data.detail}</p>}

            <div className="text-xs text-ink-3 mb-4">
              Created {new Date(data.createdAt).toLocaleString()}
              {data.acknowledgedAt && (
                <> · Acknowledged {new Date(data.acknowledgedAt).toLocaleString()} by {data.acknowledgedBy}</>
              )}
            </div>

            {data.notes && (
              <div className="bg-surface-2 rounded p-3 text-sm mb-4">
                <div className="text-xs text-ink-3 mb-1">Notes</div>
                {data.notes}
              </div>
            )}

            {canManage && data.status === 'open' && (
              <div className="border-t border-line pt-4 mt-4">
                <label className="block text-sm font-medium mb-1">Acknowledge with notes (optional)</label>
                <textarea
                  className="input w-full h-20 mb-2"
                  placeholder="Notes..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
                <button type="button" className="btn-primary" onClick={doAck} disabled={acking}>{acking ? 'Acknowledging...' : 'Acknowledge Alert'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CameraHealthSection() {
  const { data, loading, error } = useApi<CameraHealth>('/foxtail/camera-health');

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  const hasOffline = data.totals.offline > 0;

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold mb-4">Camera Health</h2>
      <div className="flex gap-6 mb-4">
        <div>
          <span className="text-2xl font-bold text-green-600">{data.totals.online}</span>
          <span className="text-sm text-ink-3 ml-1">online</span>
        </div>
        <div>
          <span className={`text-2xl font-bold ${hasOffline ? 'text-red-600' : 'text-ink-3'}`}>{data.totals.offline}</span>
          <span className="text-sm text-ink-3 ml-1">offline</span>
        </div>
      </div>

      {hasOffline && (
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium mb-2 text-ink-2">Offline Cameras</h3>
          <div className="space-y-2">
            {data.stores.filter(s => s.offline > 0).map(store => (
              <div key={store.siteId} className="text-sm">
                <Link to={`/stores/${store.siteId}`} className="font-medium hover:text-accent">{store.name}</Link>
                <span className="text-ink-3 ml-2">
                  {store.cameras.filter(c => c.status === 'offline').map(c => c.name).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasOffline && (
        <p className="text-sm text-ink-3">All cameras are online.</p>
      )}
    </div>
  );
}

export default function Security() {
  const [filter, setFilter] = useState<AlertFilter>('open');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<{ alerts: Alert[]; counts: AlertCounts }>(`/foxtail/alerts?status=${filter}`, 30000);

  const counts = data?.counts || { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const totalOpen = counts.critical + counts.high + counts.medium + counts.low + counts.info;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Security</h1>
        <div className="flex gap-2">
          {(['open', 'acknowledged', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              className={`px-3 py-1 rounded text-sm font-medium ${filter === f ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}
              onClick={() => setFilter(f)}
            >
              {f === 'open' ? `Open (${totalOpen})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <AlertCountCard label="Critical" count={counts.critical} color="bg-red-50 dark:bg-red-900/20" />
        <AlertCountCard label="High" count={counts.high} color="bg-orange-50 dark:bg-orange-900/20" />
        <AlertCountCard label="Medium" count={counts.medium} color="bg-yellow-50 dark:bg-yellow-900/20" />
        <AlertCountCard label="Low" count={counts.low} color="bg-blue-50 dark:bg-blue-900/20" />
        <AlertCountCard label="Info" count={counts.info} color="bg-gray-50 dark:bg-gray-900/20" />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 className="font-semibold">Alerts</h2>
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => reload()}>Refresh</button>
        </div>

        {loading && !data && <div className="p-4"><Loading /></div>}
        {error && <div className="p-4"><ErrorNote error={error} /></div>}

        {data && data.alerts.length === 0 && (
          <div className="p-8"><Empty>No {filter === 'all' ? '' : filter + ' '}alerts</Empty></div>
        )}

        {data && data.alerts.length > 0 && (
          <table className="w-full">
            <thead className="bg-surface-2 text-left text-xs text-ink-3 uppercase">
              <tr>
                <th className="py-2 px-4 font-medium">Severity</th>
                <th className="py-2 px-4 font-medium">Alert</th>
                <th className="py-2 px-4 font-medium">Store</th>
                <th className="py-2 px-4 font-medium">Camera</th>
                <th className="py-2 px-4 font-medium">Time</th>
                <th className="py-2 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.alerts.map(alert => (
                <AlertRow key={alert.id} alert={alert} onSelect={() => setSelectedAlertId(alert.id)} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CameraHealthSection />

      {selectedAlertId && (
        <AlertDetailModal alertId={selectedAlertId} onClose={() => { setSelectedAlertId(null); reload(); }} />
      )}
    </div>
  );
}
