/** Traffic vs register sales for one store (from POS CSV uploads). Upload is corporate-admin only. */
import { useState } from 'react';
import { apiDelete, apiPost, download, useApi } from '../lib/api';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { Card, Empty, ErrorNote, Stat } from './ui';

interface PosCompare {
  range: { key: string; label: string };
  summary: {
    entered: number | null; transactions: number | null; sales: number | null; matchedHours: number; conversionPct: number | null; avgTicket: number | null; salesPerVisitor: number | null;
    byHour: Array<{ hour: number; label: string; days: number; entered: number | null; transactions: number | null; sales: number | null; conversionPct: number | null; avgTicket: number | null }>;
  };
  uploads: Array<{ date: string; hours: number; sales: number | null; transactions: number | null; source: string; uploadedAt: string }>;
}

interface UploadResult { saved: number; dryRun: boolean; source: string; warnings: string[]; days: string[]; hours: number; sales: number; transactions: number }

export default function PosSection({ storeId, range, canUpload, timezone }: { storeId: string; range: string; canUpload: boolean; timezone: string }) {
  const { data, error, reload } = useApi<PosCompare>(`/stores/${storeId}/pos-compare?range=${encodeURIComponent(range)}`);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<UploadResult>(`/stores/${storeId}/pos-upload`, { csv: file.text, date: date || null, dryRun });
      if (dryRun) setPreview(r); else { setPreview(null); setFile(null); setOpen(false); reload(); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); setPreview(null); } finally { setBusy(false); }
  };

  const s = data?.summary;
  return (
    <Card title="Traffic vs register sales" testId="pos"
      right={<>
        {data && <button type="button" className="btn-ghost btn-sm" onClick={() => download(`/stores/${storeId}/pos-compare.csv?range=${encodeURIComponent(range)}`, 'traffic-vs-sales.csv').catch(e => setErr(e.message))}>CSV</button>}
        {canUpload && <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(o => !o)}>Upload POS export</button>}
      </>}>
      <ErrorNote error={error || err} />
      {open && canUpload && (
        <div className="rounded-lg border border-line bg-surface-2 p-3 mb-4 space-y-3">
          <p className="text-xs text-ink-3">Export hourly sales (or a transaction list) from Toast, Square or Clover as CSV. Hours are read in the store's time zone ({timezone}). Uploading the same hours again replaces them.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block"><span className="input-label">CSV file</span>
              <input type="file" accept=".csv,text/csv,.txt" className="text-sm" onChange={async e => { const f = e.target.files?.[0]; setPreview(null); setFile(f ? { name: f.name, text: await f.text() } : null); }} />
            </label>
            <label className="block"><span className="input-label">Business date (only if the file has no dates)</span>
              <input type="date" className="input !min-h-0 h-9 w-auto" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <button type="button" className="btn-secondary btn-sm" disabled={!file || busy} onClick={() => send(true)}>Check file</button>
            <button type="button" className="btn-primary btn-sm" disabled={!preview || busy} onClick={() => send(false)}>Import {preview ? `${preview.hours} hours` : ''}</button>
          </div>
          {preview && (
            <div className="text-xs text-ink-2">
              Found {preview.hours} hours on {preview.days.length} day{preview.days.length === 1 ? '' : 's'} ({preview.days[0]}{preview.days.length > 1 ? ` – ${preview.days[preview.days.length - 1]}` : ''}), {fmtMoney(preview.sales)} in sales, {fmtNum(preview.transactions)} transactions. Format: {preview.source}.
              {preview.warnings.map(w => <div key={w} className="text-warn">{w}</div>)}
            </div>
          )}
        </div>
      )}
      {data && s && (
        s.transactions === null && s.sales === null ? <Empty>No register data for {data.range.label.toLowerCase()}.{canUpload ? ' Upload a POS export to compare traffic with sales.' : ''}</Empty> : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
              <Stat label="Sales" value={fmtMoney(s.sales)} />
              <Stat label="Transactions" value={fmtNum(s.transactions)} />
              <Stat label="Customers counted" value={fmtNum(s.entered)} />
              <Stat label="Traffic → sale" value={fmtPct(s.conversionPct)} sub={s.matchedHours ? `over ${s.matchedHours} matched hours` : 'needs hours with both'} />
              <Stat label="Average ticket" value={s.avgTicket !== null ? `$${s.avgTicket.toFixed(2)}` : '—'} />
            </div>
            <div className="overflow-x-auto -mx-4">
              <table className="table">
                <thead><tr><th>Hour</th><th className="num">Customers</th><th className="num">Transactions</th><th className="num">Sales</th><th className="num">Traffic → sale</th><th className="num">Avg ticket</th></tr></thead>
                <tbody>
                  {s.byHour.map(h => (
                    <tr key={h.hour}>
                      <td>{h.label}{h.days > 1 ? <span className="text-ink-4 text-[11px]"> · {h.days} days</span> : null}</td>
                      <td className="num">{fmtNum(h.entered)}</td><td className="num">{fmtNum(h.transactions)}</td><td className="num">{fmtMoney(h.sales)}</td>
                      <td className="num">{fmtPct(h.conversionPct)}</td><td className="num">{h.avgTicket !== null ? `$${h.avgTicket.toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-4 mt-2">Traffic → sale uses only hours that have both camera counts and register data. Over 100% usually means one visit paid more than once (or the entrance camera missed people).</p>
          </>
        )
      )}
      {canUpload && data && data.uploads.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-ink-3">Uploaded days ({data.uploads.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {data.uploads.map(u => (
              <li key={u.date} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-ink-2">{u.date} · {u.hours} h · {fmtMoney(u.sales)} · {fmtNum(u.transactions)} tx · {u.source}</span>
                <button type="button" className="btn-ghost btn-sm text-bad" onClick={async () => { if (confirm(`Remove POS data for ${u.date}?`)) { await apiDelete(`/stores/${storeId}/pos/${u.date}`); reload(); } }}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
