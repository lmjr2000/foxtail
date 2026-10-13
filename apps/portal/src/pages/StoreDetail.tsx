/** One store's dashboard: the same page for corporate and the store's franchise owner. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { download, useApi, type Insights } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo, storePlace } from '../lib/format';
import { RangeBar, useRange } from '../components/RangeBar';
import { ErrorNote, Loading, PageHeader } from '../components/ui';
import { FlowCard, HoursCard, InsightsCard, KpiRow, LineCard, MomentsCard, PickupCard, SeatingCard, StaffingCard, TrafficChart } from '../components/StoreCards';
import PosSection from '../components/PosSection';
import { StoreCameras } from './Cameras';
import { Card } from '../components/ui';

export default function StoreDetail() {
  const { storeId = '' } = useParams();
  const { isCorporate, canManage, isDemo } = useAuth();
  const { range, hours, qs, setRange, setHours } = useRange('today');
  const { data, error } = useApi<Insights>(`/foxtail/stores/${storeId}/insights?${qs}`, range === 'today' ? 60_000 : 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const dl = async (path: string, name: string) => {
    setBusy(path); setDlError(null);
    try { await download(`/foxtail/stores/${storeId}/${path}?${qs}`, name); } catch (e) { setDlError(e instanceof Error ? e.message : 'Download failed'); } finally { setBusy(null); }
  };

  const ds = data?.dataStatus;
  const mods = new Set(data?.config.modules || []);
  const p = { data: data!, storeId, canManage };
  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={<><Link to="/stores" className="hover:underline">Stores</Link> / {data?.store?.name ?? '…'}</>}
        title={data?.store?.name ?? 'Store'}
        subtitle={data?.store ? [storePlace(data.store), isCorporate ? (data.store.franchiseeName || 'Corporate-owned') : null].filter(Boolean).join(' · ') : undefined}
        actions={<>
          <button type="button" className="btn-secondary" disabled={!!busy || !data} onClick={() => dl('report.pdf', 'foxtail-report.pdf')}>{busy === 'report.pdf' ? 'Preparing…' : 'PDF report'}</button>
          <button type="button" className="btn-secondary" disabled={!!busy || !data} onClick={() => dl('hourly.csv', 'foxtail-hourly.csv')}>{busy === 'hourly.csv' ? 'Preparing…' : 'Hourly CSV'}</button>
          {isCorporate && !isDemo && <Link to={`/stores/${storeId}/settings`} className="btn-secondary">Settings</Link>}
        </>}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RangeBar range={range} hours={hours} setRange={setRange} setHours={setHours} />
        {ds && ds.hasData && <span className="text-xs text-ink-3">{ds.rounds.toLocaleString()} camera samples · last {fmtAgo(ds.lastRoundAt)}{data && data.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? ` · store time (${data.timezone})` : ''}</span>}
      </div>
      <ErrorNote error={error || dlError} />
      {!data && !error && <Loading />}
      {data && ds && (
        <>
          {ds.zonesMeasurable === 0 ? (
            <div className="callout callout-info flex flex-wrap items-center justify-between gap-3">
              <span>Counting is not set up for this store yet, so there are no numbers to show.</span>
              {canManage && !isDemo && <Link to={`/stores/${storeId}/settings?tab=counting`} className="btn-secondary btn-sm">Set up counting</Link>}
            </div>
          ) : !ds.samplingEnabled && !ds.hasData ? (
            <div className="callout callout-info">Counting areas are drawn, but counting is turned off for this store.</div>
          ) : !ds.hasData ? (
            <div className="callout callout-info">No camera counts for this store in this period{range === 'today' ? ' yet' : ''}.</div>
          ) : ds.samplingEnabled && ds.live && ds.openNow && !ds.fresh ? (
            <div className="callout callout-warn">No new camera counts in the last few minutes. The numbers below are real up to {fmtAgo(ds.lastRoundAt)}.</div>
          ) : null}

          {ds.zonesMeasurable > 0 && (
            <>
              <KpiRow {...p} />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 flex flex-col"><TrafficChart {...p} /></div>
                {mods.has('queue') && <LineCard {...p} />}
                {mods.has('staffing') && <StaffingCard {...p} />}
                {mods.has('pickup') && <PickupCard {...p} />}
                {mods.has('seating') && <SeatingCard {...p} />}
                {mods.has('insights') && <div className="lg:col-span-2 flex flex-col"><MomentsCard {...p} /></div>}
                {mods.has('insights') && <InsightsCard {...p} />}
                {mods.has('customerFlow') && <FlowCard {...p} />}
                <HoursCard {...p} className={mods.has('customerFlow') ? 'lg:col-span-2' : 'lg:col-span-3'} />
              </div>
              <details className="text-xs text-ink-3">
                <summary className="cursor-pointer select-none">How these numbers are measured</summary>
                <ul className="list-disc pl-5 mt-2 space-y-1">{data.notes.map(n => <li key={n}>{n}</li>)}</ul>
              </details>
            </>
          )}
          <PosSection storeId={storeId} range={range} canUpload={canManage} timezone={data.timezone} />
          <Card title="Cameras" right={<Link to={`/cameras?store=${storeId}`} className="btn-ghost btn-sm">Open camera wall</Link>} testId="store-cameras">
            <StoreCameras store={{ id: storeId, name: data.store?.name ?? '' }} canManage={canManage} compact />
          </Card>
        </>
      )}
    </div>
  );
}
