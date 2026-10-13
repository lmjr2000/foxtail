/** Downloads: the all-stores report and each store's report for one period. Scoped by the server. */
import { useState } from 'react';
import { download, useApi, type StoreListItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { storePlace } from '../lib/format';
import { RangeBar, useRange } from '../components/RangeBar';
import { Card, Empty, ErrorNote, Loading, PageHeader } from '../components/ui';

export default function Reports() {
  const { isCorporate } = useAuth();
  const { range, hours, qs, setRange, setHours } = useRange('yesterday');
  const stores = useApi<{ stores: StoreListItem[] }>('/stores');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dl = async (key: string, path: string, name: string) => {
    setBusy(key); setErr(null);
    try { await download(`${path}?${qs}`, name); } catch (e) { setErr(e instanceof Error ? e.message : 'Download failed'); } finally { setBusy(null); }
  };
  const btn = (key: string, label: string, path: string, name: string) => (
    <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => dl(key, path, name)}>{busy === key ? 'Preparing…' : label}</button>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="PDF for reading and sharing, CSV for spreadsheets. Only measured numbers are included; stores that are not counting say so." />
      <RangeBar range={range} hours={hours} setRange={setRange} setHours={setHours} />
      <ErrorNote error={err || stores.error} />
      <Card title={isCorporate ? 'All stores' : 'All my stores'} right={<div className="flex gap-2">{btn('all-pdf', 'PDF', '/reports/all-stores.pdf', 'foxtail-all-stores.pdf')}{btn('all-csv', 'CSV', '/reports/all-stores.csv', 'foxtail-all-stores.csv')}</div>}>
        <p className="text-sm text-ink-3">Totals, every store ranked side by side, the worst hours, and traffic through the day.</p>
      </Card>
      <Card title="One store">
        {!stores.data ? <Loading /> : stores.data.stores.length === 0 ? <Empty>No stores.</Empty> : (
          <ul className="divide-y divide-line -mx-4">
            {stores.data.stores.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <div className="flex-1 min-w-[12rem]"><div className="text-sm text-ink font-medium">{s.name}</div><div className="text-xs text-ink-4">{storePlace(s)}</div></div>
                {btn(`${s.id}-pdf`, 'PDF', `/stores/${s.id}/report.pdf`, 'foxtail-report.pdf')}
                {btn(`${s.id}-csv`, 'Full CSV', `/stores/${s.id}/report.csv`, 'foxtail-report.csv')}
                {btn(`${s.id}-hourly`, 'Hourly CSV', `/stores/${s.id}/hourly.csv`, 'foxtail-hourly.csv')}
                {btn(`${s.id}-pos`, 'Traffic vs sales CSV', `/stores/${s.id}/pos-compare.csv`, 'foxtail-traffic-vs-sales.csv')}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
