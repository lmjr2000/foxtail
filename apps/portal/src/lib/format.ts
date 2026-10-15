export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const isValid = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
export const fmtNum = (v: number | null | undefined) => isValid(v) ? Math.round(v).toLocaleString('en-US') : '—';
export const fmtPct = (v: number | null | undefined) => isValid(v) ? `${Math.round(v)}%` : '—';
export const fmtMoney = (v: number | null | undefined) => isValid(v) ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';

export function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function storePlace(s: { city: string | null; state: string | null; storeNumber?: string | null }): string {
  return [s.storeNumber ? `#${s.storeNumber}` : null, [s.city, s.state].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ');
}
