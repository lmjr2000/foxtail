/**
 * A tiny dependency-free PDF writer (carried over from Eye of Omni's report export): Helvetica text,
 * filled rectangles and lines on US Letter pages. Enough for clean tabular reports.
 */
import { isDemoMode } from '../../config.js';

export const W = 612, H = 792, M = 44;
const DEMO_TEXT = 'DEMO – example stores and made-up numbers, not real Foxtail data';

const WIN: Record<string, number> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '·': 0xb7, '°': 0xb0, '×': 0xd7 };

export function pdfStr(s: string): string {
  const out: number[] = [];
  for (const ch of s.replace(/→/g, '->').replace(/↑/g, '+').replace(/↓/g, '-')) {
    const c = ch.codePointAt(0)!;
    if (WIN[ch] !== undefined) out.push(WIN[ch]); else if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c); else out.push(0x3f);
  }
  return Buffer.from(out).toString('latin1').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export type RGB = [number, number, number];
export const INK: RGB = [0.07, 0.09, 0.15];
export const GREY: RGB = [0.4, 0.43, 0.5];
/** Foxtail Coffee Co. colors (foxtailcoffee.com): black, white, teal #4F979A. */
export const BRAND: RGB = [0, 0, 0];
export const ACCENT: RGB = [0.31, 0.592, 0.604];
export const BAD: RGB = [0.75, 0.15, 0.15];
export const GOOD: RGB = [0.1, 0.5, 0.3];
export const TINT: RGB = [0.95, 0.95, 0.945];

export class Page {
  ops: string[] = [];
  text(x: number, y: number, s: string, size = 10, bold = false, rgb: RGB = INK) { this.ops.push(`BT ${rgb.map(v => v.toFixed(3)).join(' ')} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfStr(s)}) Tj ET`); }
  /** Right-aligned text (approximate Helvetica width). */
  textRight(xRight: number, y: number, s: string, size = 10, bold = false, rgb: RGB = INK) { this.text(xRight - textWidth(s, size, bold), y, s, size, bold, rgb); }
  rect(x: number, y: number, w: number, h: number, rgb: RGB) { this.ops.push(`${rgb.map(v => v.toFixed(3)).join(' ')} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); }
  line(x1: number, y1: number, x2: number, y2: number, rgb: RGB = [0.85, 0.87, 0.9], w = 0.8) { this.ops.push(`${rgb.map(v => v.toFixed(3)).join(' ')} RG ${w} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`); }
}

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += /[il.,:;|'!]/.test(ch) ? 0.28 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9#$%&]/.test(ch) ? 0.64 : ch === ' ' ? 0.28 : 0.52;
  return w * size * (bold ? 1.05 : 1);
}

export function wrap(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size) > maxWidth && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Page flow helper: tracks y, adds pages, draws section headings, bullet lists and simple tables. */
export class Doc {
  pages: Page[] = [new Page()];
  p: Page = this.pages[0];
  y = H - M;

  newPage() { this.p = new Page(); this.pages.push(this.p); this.y = H - M; }
  need(h: number) { if (this.y - h < M + 30) this.newPage(); }

  section(title: string) {
    this.need(44);
    this.y -= 10;
    this.p.text(M, this.y, title, 12.5, true);
    this.y -= 6;
    this.p.line(M, this.y, W - M, this.y);
    this.y -= 15;
  }

  paragraph(text: string, size = 9.5, rgb: RGB = INK) {
    for (const ln of wrap(text, size, W - 2 * M)) { this.need(size + 4); this.p.text(M, this.y, ln, size, false, rgb); this.y -= size + 3; }
  }

  bullets(items: string[], size = 9.5) {
    for (const it of items) {
      const lines = wrap(it, size, W - 2 * M - 12);
      this.need(lines.length * (size + 2.5) + 4);
      this.p.text(M, this.y, '•', size);
      lines.forEach((ln, j) => this.p.text(M + 10, this.y - j * (size + 2.5), ln, size));
      this.y -= lines.length * (size + 2.5) + 4;
    }
  }

  /** Columns: width in points and alignment. Header row repeats on new pages. */
  table(cols: Array<{ label: string; width: number; align?: 'left' | 'right' }>, rows: Array<Array<string | { text: string; rgb?: RGB; bold?: boolean }>>, size = 8.5) {
    const rowH = size + 6;
    const header = () => {
      this.need(rowH * 2);
      this.p.rect(M, this.y - 4, W - 2 * M, rowH, TINT);
      let x = M + 4;
      for (const c of cols) {
        if (c.align === 'right') this.p.textRight(x + c.width - 8, this.y, c.label, size - 0.5, true, GREY); else this.p.text(x, this.y, c.label, size - 0.5, true, GREY);
        x += c.width;
      }
      this.y -= rowH;
    };
    header();
    for (const r of rows) {
      if (this.y - rowH < M + 30) { this.newPage(); header(); }
      let x = M + 4;
      r.forEach((cell, i) => {
        const c = cols[i];
        const t = typeof cell === 'string' ? { text: cell } : cell;
        let s = t.text;
        while (s.length > 1 && textWidth(s, size, t.bold) > c.width - 8) s = s.slice(0, -2) + '…';
        if (c.align === 'right') this.p.textRight(x + c.width - 8, this.y, s, size, !!t.bold, t.rgb || INK); else this.p.text(x, this.y, s, size, !!t.bold, t.rgb || INK);
        x += c.width;
      });
      this.p.line(M, this.y - 4, W - M, this.y - 4, [0.92, 0.92, 0.93], 0.5);
      this.y -= rowH;
    }
  }

  /** Dark title band at the top of the first page. */
  banner(title: string, subtitle: string) {
    this.p.rect(0, H - 86, W, 86, BRAND);
    this.p.rect(0, H - 90, W, 4, ACCENT);
    this.p.text(M, H - 42, title, 18, true, [1, 1, 1]);
    this.p.text(M, H - 64, subtitle, 11, false, [0.41, 0.79, 0.8]);
    this.y = H - 112;
    if (isDemoMode()) {
      this.p.rect(M, this.y - 8, W - 2 * M, 22, [0.62, 0.23, 0.11]);
      this.p.text(M + 10, this.y - 1, DEMO_TEXT, 10, true, [1, 1, 1]);
      this.y -= 32;
    }
  }

  footer(text: string) {
    this.pages.forEach((pg, i) => {
      pg.line(M, M + 18, W - M, M + 18);
      pg.text(M, M + 6, `${text} · page ${i + 1} of ${this.pages.length}${isDemoMode() ? ' · DEMO, example data' : ''}`, 7.5, false, GREY);
    });
  }

  render(title: string): Buffer {
    const objs: Buffer[] = [];
    const add = (s: Buffer | string) => { objs.push(typeof s === 'string' ? Buffer.from(s, 'latin1') : s); return objs.length; };
    const catalogId = add(''), pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds: number[] = [];
    for (const pg of this.pages) {
      const content = Buffer.from(pg.ops.join('\n'), 'latin1');
      const cId = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cId} 0 R >>`));
    }
    objs[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
    objs[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');
    const infoId = add(`<< /Title (${pdfStr(title)}) /Producer (Foxtail) >>`);
    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(offset);
      const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), tail = Buffer.from('\nendobj\n', 'latin1');
      chunks.push(head, o, tail);
      offset += head.length + o.length + tail.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (...cells: unknown[]) => cells.map(csvCell).join(',');
/** BOM + CRLF so Excel opens it with the right encoding. */
export const csvFile = (lines: string[]) => '﻿' + (isDemoMode() ? [csvRow(DEMO_TEXT), ...lines] : lines).join('\r\n') + '\r\n';

export function fmtLocal(iso: string | Date, tz: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase() || 'store';
}
