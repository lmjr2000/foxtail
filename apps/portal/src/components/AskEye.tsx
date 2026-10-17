/**
 * Ask AI eye button: a small floating eye that opens a chat with Omni's built-in assistant
 * (POST /ai/assistant/ask on the Omni API). Omni scopes every answer to this login's own stores.
 * Hidden when the assistant reports it is unavailable or switched off (Omni AI_EYE=off).
 * Uses only an eye glyph (no Omni logo) in Foxtail's own dark/teal theme tokens.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch, apiPost, ApiError } from '../lib/api';

interface Msg { role: 'user' | 'assistant'; content: string }

function EyeGlyph({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M2.5 16C6 9.5 10.6 6.5 16 6.5S26 9.5 29.5 16C26 22.5 21.4 25.5 16 25.5S6 22.5 2.5 16Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="5.6" className="fill-accent" />
      <circle cx="16" cy="16" r="2.3" fill="#050505" />
      <circle cx="18" cy="13.9" r="1.1" fill="#fff" />
    </svg>
  );
}

/**
 * Answer typography. The assistant writes: a one-sentence headline, optional numbered ranking ("1. **Name** — a · b"),
 * optional "- " takeaways, and an optional closing "Note: ..." line. Only **bold** is interpreted inline; nothing is HTML.
 */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}</>;
}

function Rich({ text }: { text: string }) {
  // Line-based, so it copes with a missing blank line or a "- Note:" bullet.
  type Seg = { kind: 'num' | 'bul' | 'note' | 'text'; lines: string[] };
  const segs: Seg[] = [];
  let gap = true;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!l) { gap = true; continue; }
    const kind: Seg['kind'] = /^(?:[-•]\s*)?\**note:?\**:?\s/i.test(l) ? 'note' : /^\d+[.)]\s/.test(l) ? 'num' : /^[-•]\s/.test(l) ? 'bul' : 'text';
    const last = segs[segs.length - 1];
    if (last && last.kind === kind && (kind !== 'text' || !gap)) last.lines.push(l); else segs.push({ kind, lines: [l] });
    gap = false;
  }
  const out: ReactNode[] = segs.map((seg, si) => {
    const { kind, lines } = seg;
    if (kind === 'num') {
      return (
        <ol key={si} className="space-y-2">
          {lines.map((l, i) => {
            const m = /^(\d+)[.)]\s+(.*)$/.exec(l)!;
            const body = m[2];
            const cut = body.search(/\s[—–]\s|\s-\s|:\s/);
            const title = (cut > 0 ? body.slice(0, cut) : body).replace(/\*\*/g, '').trim();
            const detail = cut > 0 ? body.slice(cut).replace(/^\s*[—–:-]\s*/, '') : '';
            return (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line bg-surface text-accent text-[11px] font-semibold tabular-nums">{m[1]}</span>
                <div className="min-w-0">
                  <div className="font-semibold text-ink leading-snug">{title}</div>
                  {detail && <div className="text-[12.5px] text-ink-3 leading-snug tabular-nums"><Inline text={detail} /></div>}
                </div>
              </li>
            );
          })}
        </ol>
      );
    }
    if (kind === 'bul') {
      return (
        <ul key={si} className="space-y-1.5">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2.5"><span className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /><span><Inline text={l.replace(/^[-•]\s+/, '')} /></span></li>
          ))}
        </ul>
      );
    }
    if (kind === 'note') {
      return <p key={si} className="border-t border-line pt-2.5 text-[12px] leading-relaxed text-ink-3"><Inline text={lines.map(l => l.replace(/^(?:[-•]\s*)?\**note:?\**:?\s*/i, '')).join(' ')} /></p>;
    }
    if (si === 0 && segs.length > 1) return <p key={si} className="text-[14.5px] font-medium leading-snug text-ink"><Inline text={lines.join(' ')} /></p>;
    return <p key={si} className="leading-relaxed"><Inline text={lines.join(' ')} /></p>;
  });
  return <div className="space-y-3">{out}</div>;
}

const SUGGEST = ['Compare my stores this week', 'Which store had the longest lines?', 'Any cameras offline?'];

export default function AskEye() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastAnswerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    apiFetch<{ available?: boolean; eye?: boolean }>('/ai/assistant/status')
      .then(s => { if (!dead && s.available && s.eye !== false) setEnabled(true); })
      .catch(() => { /* hidden */ });
    return () => { dead = true; };
  }, []);
  // A new answer opens at its headline; anything else (question sent, thinking) keeps the bottom in view.
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant') lastAnswerRef.current?.scrollIntoView({ block: 'start' });
    else endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ(''); setErr(null); setBusy(true);
    setMsgs(m => [...m, { role: 'user', content: question }]);
    try {
      const j = await apiPost<{ answer: string | null; threadId?: string; message?: string }>('/ai/assistant/ask', { question, threadId });
      if (j.answer) { setMsgs(m => [...m, { role: 'assistant', content: j.answer! }]); setThreadId(j.threadId); }
      else setErr(j.message || 'The assistant is not available right now.');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  if (!enabled) return null;
  const pos = 'bottom-[calc(84px+env(safe-area-inset-bottom,0px))] md:bottom-6';
  return (
    <>
      {open && (
        <div role="dialog" aria-label="Ask AI" data-testid="ask-eye-panel"
          className={`fixed z-[60] right-3 left-3 sm:left-auto sm:w-[27rem] ${pos} mb-[4.5rem] max-h-[min(78vh,42rem)] flex flex-col rounded-2xl border border-line bg-surface text-ink shadow-elevated`}>
          <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
            <EyeGlyph className="h-5 w-5 text-ink" />
            <span className="text-sm font-semibold">Ask AI</span>
            {msgs.length > 0 && <button type="button" onClick={() => { setMsgs([]); setThreadId(undefined); setErr(null); }} className="ml-auto text-xs text-ink-3 hover:text-ink">New</button>}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className={`${msgs.length ? '' : 'ml-auto'} h-8 w-8 grid place-items-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2`}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[13.5px] leading-relaxed antialiased" data-testid="ask-eye-messages">
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGEST.map(s => <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink">{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-white">{m.content}</div>
              : <div key={i} className="mr-2 rounded-2xl rounded-bl-md border border-line bg-surface-2 px-4 py-3.5 text-ink-2" ref={i === msgs.length - 1 ? lastAnswerRef : undefined} data-testid="ask-eye-answer"><Rich text={m.content} /></div>)}
            {busy && <div className="mr-4 inline-flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5 text-ink-3"><EyeGlyph className="h-4 w-4 text-ink animate-pulse" />Looking at your stores…</div>}
            {err && <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">{err}</div>}
            <div ref={endRef} />
          </div>
          <form className="flex items-center gap-2 border-t border-line p-2.5" onSubmit={e => { e.preventDefault(); send(q); }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about your stores…" aria-label="Ask AI" data-testid="ask-eye-input"
              className="flex-1 h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent" />
            <button type="submit" disabled={busy || !q.trim()} className="h-10 rounded-xl bg-accent hover:bg-accent-hover px-4 text-sm font-semibold text-white disabled:opacity-40">Ask</button>
          </form>
        </div>
      )}
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Ask AI" aria-expanded={open} data-testid="ask-eye-button"
        className={`fixed z-[61] right-4 ${pos} h-14 w-14 rounded-full grid place-items-center bg-[#0b0f10] text-white ring-2 ring-accent shadow-elevated hover:scale-105 active:scale-95 transition-transform`}>
        <EyeGlyph className="h-7 w-7" />
      </button>
    </>
  );
}
