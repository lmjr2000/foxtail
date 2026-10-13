/** Period + hours pickers, kept in the URL (?range=&hours=) so links and reloads keep the view. */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export const HOURS_OPTIONS = [
  { value: 'open', label: 'Opening hours' }, { value: 'all', label: 'All day' }, { value: '5-11', label: 'Morning rush (5–11)' },
  { value: '11-14', label: 'Midday (11–2)' }, { value: '14-18', label: 'Afternoon (2–6)' }, { value: '18-23', label: 'Evening (6–11)' },
];

export function useRange(defaultRange = 'today') {
  const [params, setParams] = useSearchParams();
  const range = params.get('range') || defaultRange;
  const hours = params.get('hours') || 'open';
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };
  const qs = `range=${encodeURIComponent(range)}&hours=${encodeURIComponent(hours)}`;
  return { range, hours, qs, setRange: (v: string) => set('range', v), setHours: (v: string) => set('hours', v) };
}

const CTRL = 'input !min-h-0 h-9 w-auto';

export function RangeBar({ range, hours, setRange, setHours, showHours = true }: { range: string; hours: string; setRange: (v: string) => void; setHours: (v: string) => void; showHours?: boolean }) {
  const today = useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  const single = /^\d{4}-\d{2}-\d{2}$/.test(range) ? range : '';
  const custom = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(range);
  const is30d = custom && custom[1] === daysAgo(30) && custom[2] === daysAgo(1);
  const mode = is30d ? '30d' : custom ? 'custom' : single ? 'date' : range;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="range-bar">
      <select aria-label="Period" className={CTRL} value={mode} onChange={e => {
        const v = e.target.value;
        setRange(v === 'date' ? daysAgo(1) : v === 'custom' ? `${daysAgo(7)}..${daysAgo(1)}` : v === '30d' ? `${daysAgo(30)}..${daysAgo(1)}` : v);
      }}>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="date">Pick a day…</option>
        <option value="custom">Custom range…</option>
      </select>
      {single && <input type="date" aria-label="Day" className={CTRL} max={today} value={single} onChange={e => e.target.value && setRange(e.target.value)} />}
      {custom && (
        <span className="flex items-center gap-1.5">
          <input type="date" aria-label="From" className={CTRL} max={custom[2]} value={custom[1]} onChange={e => e.target.value && setRange(`${e.target.value}..${custom[2]}`)} />
          <span className="text-xs text-ink-3">to</span>
          <input type="date" aria-label="To" className={CTRL} min={custom[1]} max={today} value={custom[2]} onChange={e => e.target.value && setRange(`${custom[1]}..${e.target.value}`)} />
        </span>
      )}
      {showHours && (
        <select aria-label="Hours" className={CTRL} value={hours} onChange={e => setHours(e.target.value)}>
          {HOURS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}
