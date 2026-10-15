/** Small shared building blocks (tokens only, light/dark safe). */
import { Component, useEffect, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps { children: ReactNode; }
interface ErrorBoundaryState { error: Error | null; }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('React error boundary caught:', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-1 p-4">
          <div className="card max-w-md w-full p-6 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-semibold text-ink mb-2">Something went wrong</h1>
            <p className="text-ink-3 mb-4">The app ran into an error. Try refreshing the page.</p>
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Refresh</button>
            <details className="mt-4 text-left text-xs text-ink-4">
              <summary className="cursor-pointer">Error details</summary>
              <pre className="mt-2 p-2 bg-surface-2 rounded overflow-auto max-h-40">{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1 mb-5 min-w-0">
      {crumbs && <div className="text-xs text-ink-3 truncate">{crumbs}</div>}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="page-title truncate">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, right, children, className = '', testId }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section data-testid={testId} className={`card flex flex-col min-w-0 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          {title && <h2 className="card-title truncate">{title}</h2>}
          {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
        </div>
      )}
      <div className={`px-4 pb-4 ${title || right ? '' : 'pt-4'} flex-1 min-w-0`}>{children}</div>
    </section>
  );
}

export function Delta({ pct, good, direction, label }: { pct: number | null; good: boolean | null; direction: 'up' | 'down' | 'flat' | null; label?: string | null }) {
  if (direction === null) return null;
  const validPct = pct !== null && Number.isFinite(pct);
  const color = good === null ? 'text-ink-3' : good ? 'text-ok' : 'text-bad';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  return (
    <span className={`text-xs font-medium ${color} whitespace-nowrap`}>
      {arrow} {validPct ? `${Math.abs(pct)}%` : direction === 'flat' ? 'same' : ''}
      {label ? <span className="text-ink-4 font-normal"> vs {label}</span> : null}
    </span>
  );
}

/** Change badge from two raw numbers. */
export function RawDelta({ value, compare, lowerIsBetter = false }: { value: number | null; compare: number | null; lowerIsBetter?: boolean }) {
  if (value === null || compare === null || !Number.isFinite(value) || !Number.isFinite(compare)) return null;
  const direction = value > compare ? 'up' : value < compare ? 'down' : 'flat';
  const pct = compare !== 0 ? Math.round(((value - compare) / Math.abs(compare)) * 100) : null;
  const good = direction === 'flat' ? null : (direction === 'down') === lowerIsBetter;
  return <Delta pct={pct} good={good} direction={direction} />;
}

export function Pill({ tone, children, title }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent'; children: ReactNode; title?: string }) {
  return <span title={title} className={`badge badge-${tone}`}>{children}</span>;
}

export function EstimateTag() {
  return <Pill tone="neutral" title="Estimate from people seen in staff areas; no employee identification">Estimate</Pill>;
}

export function Bar({ pct, tone = 'info' }: { pct: number | null; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'accent' }) {
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const bg = tone === 'ok' ? 'bg-ok-fill' : tone === 'warn' ? 'bg-warn-fill' : tone === 'bad' ? 'bg-bad-fill' : tone === 'accent' ? 'bg-accent' : 'bg-info-fill';
  return <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden"><div className={`h-full rounded-full ${bg}`} style={{ width: `${w}%` }} /></div>;
}

export function Stat({ label, value, sub, extra }: { label: string; value: ReactNode; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-3 truncate">{label}</div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-xl font-semibold text-ink tabular-nums">{value}</span>
        {extra}
      </div>
      {sub && <div className="text-[11px] text-ink-4 truncate">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-3">{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="card p-8 text-center text-sm text-ink-3">{label}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="callout callout-bad" role="alert">{error}</div> : null;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle-thumb" />
    </button>
  );
}

export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-overlay flex items-start sm:items-center justify-center p-4 overflow-y-auto" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card shadow-elevated w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-8`}>
        <div className="card-header"><h2 className="card-title">{title}</h2><button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="card-body">{children}</div>
        {footer && <div className="px-4 pb-4 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="input-label">{label}</span>
      {children}
      {help && <span className="input-help block">{help}</span>}
    </label>
  );
}
