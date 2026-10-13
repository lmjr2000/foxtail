/**
 * Tolerant POS export parser → hourly { sales, transactions } rows in the location's local time.
 *
 * Two shapes are recognised automatically:
 *  - "by hour" summaries (Toast Sales Summary → Time of day, Square Sales by Hour, Clover Hourly Sales,
 *    or any sheet with an Hour column plus Sales and/or Orders/Transactions columns). A Date column is
 *    used when present; otherwise the caller must supply the business date.
 *  - per-transaction lists (Square Transactions, Clover Orders/Payments, Toast Order Details): each row
 *    is one transaction with a date/time and an amount; rows are rolled up per hour.
 * Totals rows, refunds-only rows and preamble lines above the header are skipped.
 */
import { zonedToUtc } from './time.js';

export interface PosHour { hourAt: Date; sales: number | null; transactions: number | null }
export interface PosParseResult { rows: PosHour[]; source: 'toast' | 'square' | 'clover' | 'generic'; shape: 'hourly' | 'transactions'; skipped: number; warnings: string[] }

export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const delim = sniffDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows.map(r => r.map(c => c.replace(/^\uFEFF/, '').trim()));
}

function sniffDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 10).join('\n');
  const n = (c: string) => head.split(c).length;
  return n('\t') > n(',') && n('\t') > n(';') ? '\t' : n(';') > n(',') ? ';' : ',';
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

type Role = 'hour' | 'date' | 'datetime' | 'time' | 'sales' | 'count' | 'id' | 'status';
function roleOf(h: string): Role | null {
  const n = norm(h);
  if (!n) return null;
  if (/^(order|transaction|payment|check|receipt|ticket) ?(id|#|number|no)$|^(id|order #|check #)$/.test(n)) return 'id';
  if (/(status|state|void|refund type)/.test(n) && !/sales|amount/.test(n)) return 'status';
  if (/^(hour|hour of day|time of day|hour range|time period|time range|interval|hourly|hour slot)$/.test(n) || /^hour\b/.test(n)) return 'hour';
  if (/(net sales|gross sales|total sales|sales total|^sales$|^net$|^gross$|amount collected|total collected|order total|^total$|^amount$|net amount|gross amount|total amount|sale amount|payment amount|^revenue$)/.test(n)) return 'sales';
  if (/(^orders?$|order count|# of orders|number of orders|^transactions?$|transaction count|# of transactions|number of transactions|^checks?$|check count|^tickets?$|ticket count|^count$|^payments?$|payments count|# payments|^sales count$|total orders|total transactions)/.test(n)) return 'count';
  if (/(opened|closed|order date time|created|paid at|date time|timestamp|order time|payment date|order date|transaction date|^date$|business date|^day$)/.test(n)) {
    if (/^(date|business date|day)$/.test(n)) return 'date';
    return 'datetime';
  }
  if (/^time$|^transaction time$|^payment time$/.test(n)) return 'time';
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(s: string): { y: number; m: number; d: number } | null {
  const t = s.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return { y, m: +m[1], d: +m[2] }; }
  m = /^(\d{1,2})[- ]([A-Za-z]{3,4})[a-z]*[- ,]+(\d{2,4})/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return { y, m: MONTHS[m[2].toLowerCase()], d: +m[1] }; }
  m = /^(?:[A-Za-z]{3,9},? )?([A-Za-z]{3,4})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return { y: +m[3], m: MONTHS[m[1].toLowerCase()], d: +m[2] };
  return null;
}

/** First clock time in the string → 0-23 hour (and minute). "8", "08:00", "8:00 AM", "8 AM - 9 AM", "2026-10-11 14:05". */
export function parseHour(s: string, allowBare = true): { h: number; min: number } | null {
  let t = s.trim().toLowerCase();
  t = t.replace(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[t ]?/, '').replace(/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[ ,t]*/, '').replace(/^\d{1,2}[- ][a-z]{3,4}[a-z]*[- ,]+\d{2,4}[ ,]*/, '').replace(/^(?:[a-z]{3,9},? )?[a-z]{3,4}\.? \d{1,2},? \d{4}[ ,]*/, '');
  let m = /(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*(a\.?m\.?|p\.?m\.?)?/.exec(t);
  if (m) return fix(+m[1], +m[2], m[3]);
  m = /(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/.exec(t);
  if (m) return fix(+m[1], 0, m[2]);
  if (allowBare) { m = /^(\d{1,2})(?:\s*[-–]\s*\d{1,2})?$/.exec(t); if (m) return fix(+m[1], 0, undefined); }
  return null;
  function fix(h: number, min: number, ap?: string) {
    if (ap) { const pm = ap.startsWith('p'); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return h >= 0 && h <= 23 && min >= 0 && min < 60 ? { h, min } : null;
  }
}

export function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t || t === '-' || t === '—') return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/[$€£\s]/g, ''));
  const n = Number(t.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || !/[0-9]/.test(t)) return null;
  return neg ? -n : n;
}

function guessSource(headers: string[]): PosParseResult['source'] {
  const h = headers.map(norm).join('|');
  if (/order guid|dining option|revenue center|toast|guests/.test(h)) return 'toast';
  if (/transaction id|time zone|device name|card brand|square/.test(h)) return 'square';
  if (/order id.*order date|order date.*order id|clover|tender|order employee/.test(h)) return 'clover';
  return 'generic';
}

export function parsePosCsv(text: string, tz: string, fallbackDate?: string | null): PosParseResult | { error: string } {
  const rows = splitCsv(text);
  if (!rows.length) return { error: 'The file is empty.' };
  // Header = first row (within the first 25) with at least two recognised columns, one of them a sales/count/hour.
  let hi = -1, roles: Array<Role | null> = [];
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const r = rows[i].map(roleOf);
    const set = new Set(r.filter(Boolean));
    if (set.size >= 2 && (set.has('sales') || set.has('count')) && (set.has('hour') || set.has('datetime') || set.has('date') || set.has('time'))) { hi = i; roles = r; break; }
  }
  if (hi < 0) return { error: 'Could not find the header row. The file needs an hour or date/time column and a sales or transactions column.' };
  const headers = rows[hi];
  const idx = (role: Role) => roles.indexOf(role);
  // Prefer "net sales" over gross/total when several sales columns exist.
  const salesCols = roles.map((r, i) => (r === 'sales' ? i : -1)).filter(i => i >= 0);
  const salesI = salesCols.find(i => /net/.test(norm(headers[i]))) ?? salesCols[0] ?? -1;
  const countI = idx('count'), hourI = idx('hour'), dateI = idx('date'), dtI = idx('datetime'), timeI = idx('time'), idI = idx('id'), statusI = idx('status');
  const shape: PosParseResult['shape'] = hourI >= 0 || (countI >= 0 && dtI < 0 && timeI < 0) ? 'hourly' : 'transactions';
  // Business date: the one the user picked, else a single date in the report preamble (e.g. Toast "Date,10/10/2026").
  let fb = fallbackDate ? parseDate(fallbackDate) : null;
  if (!fb && hi > 0) {
    const found = new Map<string, { y: number; m: number; d: number }>();
    for (const r of rows.slice(0, hi)) for (const c of r) for (const part of c.split(/\s+(?:-|–|to)\s+/)) {
      const d = parseDate(part.trim());
      if (d) found.set(`${d.y}-${d.m}-${d.d}`, d);
    }
    if (found.size === 1) fb = [...found.values()][0];
  }
  const warnings: string[] = [];
  const agg = new Map<number, { sales: number | null; tx: number | null; seen: Set<string> }>();
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const cell = (i: number) => (i >= 0 ? r[i] ?? '' : '');
    if (r.some(c => /^(grand )?totals?:?$|^summary$/i.test(c))) { skipped++; continue; }
    if (statusI >= 0 && /void|deleted|cancel|refund/i.test(cell(statusI))) { skipped++; continue; }
    let day: ReturnType<typeof parseDate> = null, hr: ReturnType<typeof parseHour> = null;
    if (shape === 'hourly') {
      hr = parseHour(hourI >= 0 ? cell(hourI) : cell(dtI >= 0 ? dtI : timeI));
      day = parseDate(cell(dateI >= 0 ? dateI : dtI >= 0 ? dtI : hourI)) || fb;
    } else {
      const dts = dtI >= 0 ? cell(dtI) : '';
      day = parseDate(dts) || parseDate(cell(dateI)) || fb;
      hr = parseHour(dts, false) || parseHour(cell(timeI), false);
    }
    if (!day || !hr) { skipped++; continue; }
    const at = zonedToUtc(day.y, day.m, day.d, hr.h, 0, tz).getTime();
    if (!agg.has(at)) agg.set(at, { sales: null, tx: null, seen: new Set() });
    const a = agg.get(at)!;
    const sale = salesI >= 0 ? parseMoney(cell(salesI)) : null;
    if (shape === 'hourly') {
      if (sale !== null) a.sales = (a.sales ?? 0) + sale;
      const n = countI >= 0 ? parseMoney(cell(countI)) : null;
      if (n !== null) a.tx = (a.tx ?? 0) + Math.round(n);
    } else {
      if (sale !== null) a.sales = (a.sales ?? 0) + sale;
      const id = idI >= 0 ? cell(idI) : '';
      if (sale !== null && sale < 0) continue; // refunds lower sales but are not a new transaction
      if (id) { if (a.seen.has(id)) continue; a.seen.add(id); }
      a.tx = (a.tx ?? 0) + 1;
    }
  }
  if (shape === 'hourly' && dateI < 0 && dtI < 0 && !fb) return { error: 'This file has hours but no dates. Pick the business date and upload again.' };
  const out = [...agg.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ hourAt: new Date(t), sales: v.sales === null ? null : Math.round(v.sales * 100) / 100, transactions: v.tx }));
  if (!out.length) return { error: 'No hourly rows could be read from this file.' };
  if (salesI < 0) warnings.push('No sales column found; only transaction counts were imported.');
  if (shape === 'hourly' && countI < 0) warnings.push('No transactions column found; only sales were imported.');
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped (totals, voids or unreadable).`);
  return { rows: out, source: guessSource(headers), shape, skipped, warnings };
}
