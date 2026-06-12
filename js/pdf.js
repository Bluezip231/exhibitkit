/**
 * pdf.js — exhibit PDF generation with jsPDF.
 *
 * Letter (612×792 pt), portrait, 1-inch (72 pt) margins.
 * Helvetica for body text, Courier for hashes / Bates numbers.
 *
 * jsPDF's standard 14 fonts only cover the WinAnsi (cp1252) character set:
 * emoji and non-Latin scripts cannot be embedded. sanitizeForPdf() replaces
 * such runs with explicit placeholders ([emoji], [non-Latin text]) and the
 * app warns the user before generation — characters are never silently
 * dropped. (Embedding a full Unicode font is a Phase 4 stretch goal.)
 */

import { buildDeclaration } from './declaration.js';
import { truncatedHash } from './hash.js';

// ---------------------------------------------------------------------------
// Layout constants (points)
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;          // 468
const CONTENT_TOP = 84;
const CONTENT_BOTTOM = PAGE_H - MARGIN;          // 720
const LINE_H = 13;                               // 10pt × 1.3
const MSG_GAP = 14;

const INK = [26, 36, 51];
const SEAL = [140, 29, 24];
const RULE = [201, 205, 211];
const MUTED = [91, 100, 112];

// ---------------------------------------------------------------------------
// WinAnsi sanitization
// ---------------------------------------------------------------------------

// cp1252 code points beyond Latin-1: smart quotes, dashes, €, ™, etc.
const CP1252_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);

// Invisible formatting characters: dropped (not placeholdered) because they
// carry no visible content. Documented in the README.
const ZERO_WIDTH = new Set([
  0x200B, 0x200C, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
  0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF, 0x00AD,
]);

const EMOJI_RE = /\p{Extended_Pictographic}/u;

function isSupported(cp) {
  return cp === 0x0A || (cp >= 0x20 && cp <= 0x7E) ||
    (cp >= 0xA0 && cp <= 0xFF) || CP1252_EXTRA.has(cp);
}

function isEmojiCp(cp) {
  return (cp >= 0x1F000 && cp <= 0x1FAFF) ||  // pictographs, emoticons, symbols
    (cp >= 0x1F1E6 && cp <= 0x1F1FF) ||        // regional indicators (flags)
    (cp >= 0x1F3FB && cp <= 0x1F3FF) ||        // skin-tone modifiers
    cp === 0xFE0F || cp === 0x200D || cp === 0x20E3 ||
    EMOJI_RE.test(String.fromCodePoint(cp));
}

/**
 * Replace characters jsPDF cannot embed with explicit placeholders.
 * Consecutive unsupported characters collapse into one placeholder.
 * @returns {{text: string, hadEmoji: boolean, hadOther: boolean}}
 */
export function sanitizeForPdf(input) {
  const text = String(input ?? '');
  let out = '';
  let hadEmoji = false;
  let hadOther = false;
  let run = [];        // pending unsupported code points

  const flushRun = () => {
    if (run.length === 0) return;
    const visible = run.filter((cp) => !ZERO_WIDTH.has(cp));
    if (visible.length > 0) {
      if (visible.some(isEmojiCp)) {
        out += '[emoji]';
        hadEmoji = true;
      } else {
        out += '[non-Latin text]';
        hadOther = true;
      }
    }
    run = [];
  };

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ch === '\t') { flushRun(); out += '  '; continue; }
    if (ch === '\r') { continue; }
    if (cp < 0x20 && cp !== 0x0A) { continue; }   // other control chars
    if (isSupported(cp)) {
      flushRun();
      out += ch;
    } else {
      run.push(cp);
    }
  }
  flushRun();

  return { text: out, hadEmoji, hadOther };
}

/** Count messages whose printable text would gain placeholders. */
export function scanUnsupported(messages) {
  let count = 0;
  for (const m of messages) {
    const r = sanitizeForPdf(`${m.sender}\n${m.body}`);
    if (r.hadEmoji || r.hadOther) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

function sanitizePart(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** e.g. "Exhibit-A_Smith-v-Smith_2026-06-12.pdf" */
export function buildFileName(caseInfo, date = new Date(), suffix = '') {
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parts = [
    sanitizePart(caseInfo.exhibitLabel || 'Exhibit'),
    sanitizePart(caseInfo.caseCaption || ''),
    ymd + suffix,
  ].filter(Boolean);
  return parts.join('_') + '.pdf';
}

// ---------------------------------------------------------------------------
// Main generation
// ---------------------------------------------------------------------------

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/**
 * Generate the full exhibit PDF.
 *
 * @param {{
 *   messages: Array<{sender, rawTimestamp, body, direction, isSystem, bates}>,
 *   caseInfo: object,
 *   sources: Array<{name, sizeBytes, hashHex, hashedAt}>,
 *   description: string,            // cover-page description block
 *   redactedCount: number,
 *   exportDate: Date|null,
 *   onProgress?: (done: number, total: number) => void
 * }} opts
 * @returns {Promise<object>} the jsPDF document
 */
export async function generateExhibitPdf(opts) {
  const { messages, caseInfo, sources, description,
    redactedCount = 0, exportDate = null, onProgress } = opts;

  const doc = newDoc();
  const genDate = new Date();

  drawCover(doc, { caseInfo, sources, description, genDate });

  // Message pages
  doc.addPage();
  drawPageHeader(doc, caseInfo);
  let y = CONTENT_TOP;
  for (let i = 0; i < messages.length; i++) {
    if (i > 0 && i % 200 === 0) {
      if (onProgress) onProgress(i, messages.length);
      await yieldToUi();
    }
    y = drawMessage(doc, messages[i], y, caseInfo);
  }
  if (onProgress) onProgress(messages.length, messages.length);

  // Declaration page(s)
  const precedingPages = doc.getNumberOfPages();
  const decl = buildDeclaration({
    caseInfo,
    messageCount: messages.length,
    precedingPages,
    sources,
    redactedCount,
    exportDate,
  });
  doc.addPage();
  drawPageHeader(doc, caseInfo);
  drawDeclaration(doc, decl, caseInfo);

  stampFooters(doc, sources, genDate);
  return doc;
}

/** Generate a standalone declaration (no exhibit pages). */
export function generateDeclarationPdf(opts) {
  const { caseInfo, sources, messageCount, redactedCount = 0, exportDate = null } = opts;
  const doc = newDoc();
  const decl = buildDeclaration({
    caseInfo,
    messageCount,
    precedingPages: null,   // unknown — printed as a blank to fill in
    sources,
    redactedCount,
    exportDate,
  });
  drawPageHeader(doc, caseInfo);
  drawDeclaration(doc, decl, caseInfo);
  stampFooters(doc, sources, new Date());
  return doc;
}

function newDoc() {
  const JsPdf = window.jspdf && window.jspdf.jsPDF;
  if (!JsPdf) {
    throw new Error('The PDF library failed to load. Check your connection and reload the page.');
  }
  return new JsPdf({ unit: 'pt', format: 'letter', compress: true });
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function drawCover(doc, ctx) {
  const { caseInfo, sources, description, genDate } = ctx;
  setInk(doc);
  let y = 110;

  if (caseInfo.courtName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    const lines = doc.splitTextToSize(sanitizeForPdf(caseInfo.courtName).text, CONTENT_W);
    doc.text(lines, PAGE_W / 2, y, { align: 'center' });
    y += lines.length * 15 + 14;
  }

  if (caseInfo.caseCaption) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    const lines = doc.splitTextToSize(sanitizeForPdf(caseInfo.caseCaption).text, CONTENT_W);
    doc.text(lines, PAGE_W / 2, y, { align: 'center' });
    y += lines.length * 18 + 6;
  }

  if (caseInfo.caseNumber) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`Case No. ${sanitizeForPdf(caseInfo.caseNumber).text}`, PAGE_W / 2, y, { align: 'center' });
    y += 20;
  }

  // Exhibit label between two rules
  const labelY = Math.max(y + 70, 300);
  doc.setDrawColor(...INK);
  doc.setLineWidth(1);
  doc.line(PAGE_W / 2 - 110, labelY - 34, PAGE_W / 2 + 110, labelY - 34);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text(sanitizeForPdf(caseInfo.exhibitLabel || 'Exhibit').text.toUpperCase(),
    PAGE_W / 2, labelY, { align: 'center' });
  doc.line(PAGE_W / 2 - 110, labelY + 14, PAGE_W / 2 + 110, labelY + 14);

  // Description block
  if (description) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(sanitizeForPdf(description).text, CONTENT_W - 60);
    doc.text(lines, PAGE_W / 2, labelY + 50, { align: 'center' });
  }

  drawSealBox(doc, sources, genDate);
}

/** The Evidence Seal block, printed on the cover. */
function drawSealBox(doc, sources, genDate) {
  const boxW = 460;
  const boxX = (PAGE_W - boxW) / 2;
  const pad = 14;
  const lh = 12;

  // Assemble lines first so the box height is exact.
  const rows = [];   // {text, font, style, size, color}
  const mono = (text, color = INK) => rows.push({ text, font: 'courier', style: 'normal', size: 8.5, color });
  const monoBold = (text, color = SEAL) => rows.push({ text, font: 'courier', style: 'bold', size: 8.5, color });

  monoBold('EVIDENCE SEAL — SOURCE FILE INTEGRITY');
  rows.push({ gap: 6 });
  for (const s of sources) {
    mono(`File:    ${fitMono(doc, sanitizeForPdf(s.name).text, boxW - pad * 2 - 50)}`);
    mono(`Size:    ${s.sizeBytes.toLocaleString('en-US')} bytes`);
    mono(`SHA-256: ${s.hashHex.slice(0, 32)}`, SEAL);
    mono(`         ${s.hashHex.slice(32)}`, SEAL);
    rows.push({ gap: 4 });
  }
  const hashedAt = (sources[0] && sources[0].hashedAt) || genDate;
  mono(`Hashed:  ${s2(hashedAt)}`);
  rows.push({ gap: 6 });
  rows.push({
    text: "Generated with ExhibitKit (exhibitkit.com) — all processing performed locally on the user's device.",
    font: 'helvetica', style: 'normal', size: 8, color: MUTED, wrap: boxW - pad * 2,
  });

  // Measure height
  let h = pad * 2;
  const measured = rows.map((r) => {
    if (r.gap) { h += r.gap; return r; }
    if (r.wrap) {
      doc.setFont(r.font, r.style); doc.setFontSize(r.size);
      const lines = doc.splitTextToSize(r.text, r.wrap);
      h += lines.length * (r.size + 2.5);
      return { ...r, lines };
    }
    h += lh;
    return r;
  });

  const boxY = 700 - h;
  doc.setDrawColor(...SEAL);
  doc.setLineWidth(2);
  doc.rect(boxX, boxY, boxW, h);

  let y = boxY + pad + 6;
  for (const r of measured) {
    if (r.gap) { y += r.gap; continue; }
    doc.setFont(r.font, r.style);
    doc.setFontSize(r.size);
    doc.setTextColor(...(r.color || INK));
    if (r.lines) {
      doc.text(r.lines, boxX + pad, y);
      y += r.lines.length * (r.size + 2.5);
    } else {
      doc.text(r.text, boxX + pad, y);
      y += lh;
    }
  }
  setInk(doc);
}

/** Truncate a string so it fits a width in the current courier 8.5pt. */
function fitMono(doc, text, maxW) {
  doc.setFont('courier', 'normal');
  doc.setFontSize(8.5);
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1);
  return t + '…';
}

function s2(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (local time)`;
}

// ---------------------------------------------------------------------------
// Message pages
// ---------------------------------------------------------------------------

function drawPageHeader(doc, caseInfo) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setInk(doc);
  doc.text(sanitizeForPdf(caseInfo.exhibitLabel || 'Exhibit').text, MARGIN, 48);
  if (caseInfo.caseNumber) {
    doc.setFont('helvetica', 'normal');
    doc.text(`Case No. ${sanitizeForPdf(caseInfo.caseNumber).text}`, PAGE_W - MARGIN, 48, { align: 'right' });
  }
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 56, PAGE_W - MARGIN, 56);
}

function newMessagePage(doc, caseInfo) {
  doc.addPage();
  drawPageHeader(doc, caseInfo);
  return CONTENT_TOP;
}

function drawMessage(doc, m, y, caseInfo) {
  const body = sanitizeForPdf(m.body).text;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const bodyLines = body !== '' ? doc.splitTextToSize(body, CONTENT_W) : [];

  const senderText = m.isSystem
    ? '(system message)'
    : sanitizeForPdf(m.sender || 'Unknown').text;
  const dirSuffix = m.direction ? ` (${m.direction})` : '';
  const metaText = `${m.rawTimestamp ? ' — ' + sanitizeForPdf(m.rawTimestamp).text : ''}${dirSuffix}`;

  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  const batesW = m.bates ? doc.getTextWidth(m.bates) : 0;
  doc.setFont('helvetica', m.isSystem ? 'italic' : 'bold');
  doc.setFontSize(10);
  const senderW = doc.getTextWidth(senderText);
  doc.setFont('helvetica', 'normal');
  const metaW = doc.getTextWidth(metaText);
  const metaOwnLine = senderW + metaW > CONTENT_W - batesW - 12;
  const headLines = metaOwnLine && metaText ? 2 : 1;

  // Keep-together: if fewer than 3 lines of the block fit, start a new page.
  const blockLines = headLines + bodyLines.length;
  const neededLines = Math.min(blockLines, 3);
  if (y + neededLines * LINE_H > CONTENT_BOTTOM) {
    y = newMessagePage(doc, caseInfo);
  }

  // Line 1: bold sender + regular timestamp, Bates number right-aligned.
  doc.setFont('helvetica', m.isSystem ? 'italic' : 'bold');
  doc.setFontSize(10);
  setInk(doc);
  doc.text(senderText, MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  if (metaOwnLine && metaText) {
    if (m.bates) drawBates(doc, m.bates, y);
    y += LINE_H;
    if (y > CONTENT_BOTTOM) y = newMessagePage(doc, caseInfo);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(metaText.replace(/^ — /, ''), MARGIN, y);
  } else {
    if (metaText) doc.text(metaText, MARGIN + senderW, y);
    if (m.bates) drawBates(doc, m.bates, y);
  }
  setInk(doc);
  y += LINE_H;

  // Body lines
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  for (const line of bodyLines) {
    if (y > CONTENT_BOTTOM) {
      y = newMessagePage(doc, caseInfo);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      setInk(doc);
    }
    doc.text(line, MARGIN, y);
    y += LINE_H;
  }

  return y + MSG_GAP; // vertical gap before the next message block
}

function drawBates(doc, bates, y) {
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(bates, PAGE_W - MARGIN, y, { align: 'right' });
  doc.setFontSize(10);
}

// ---------------------------------------------------------------------------
// Declaration page
// ---------------------------------------------------------------------------

function drawDeclaration(doc, decl, caseInfo) {
  const PARA_LH = 15;
  let y = CONTENT_TOP + 14;

  const ensure = (need) => {
    if (y + need > CONTENT_BOTTOM) {
      doc.addPage();
      drawPageHeader(doc, caseInfo);
      y = CONTENT_TOP + 14;
    }
  };

  setInk(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const titleLines = doc.splitTextToSize(decl.title, CONTENT_W);
  doc.text(titleLines, PAGE_W / 2, y, { align: 'center' });
  y += titleLines.length * 17 + 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const introLines = doc.splitTextToSize(sanitizeForPdf(decl.intro).text, CONTENT_W);
  ensure(introLines.length * PARA_LH);
  doc.text(introLines, MARGIN, y);
  y += introLines.length * PARA_LH + 10;

  decl.paragraphs.forEach((para, i) => {
    // Long hash paragraphs wrap anywhere thanks to courier-free helvetica,
    // but jsPDF only breaks on spaces — give hashes breakable spacing.
    const text = sanitizeForPdf(para).text;
    const lines = doc.splitTextToSize(text, CONTENT_W - 26, { fontSize: 11 });
    ensure(Math.min(lines.length, 2) * PARA_LH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`${i + 1}.`, MARGIN, y);
    for (const line of lines) {
      ensure(PARA_LH);
      doc.text(line, MARGIN + 26, y);
      y += PARA_LH;
    }
    y += 8;
  });

  y += 14;
  for (const line of decl.execution) {
    ensure(PARA_LH);
    doc.text(line, MARGIN, y);
    y += PARA_LH + 8;
  }

  y += 26;
  for (const line of decl.signature) {
    ensure(PARA_LH);
    doc.text(sanitizeForPdf(line).text, MARGIN, y);
    y += PARA_LH + 12;
  }

  y += 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const footLines = doc.splitTextToSize(decl.footnote, CONTENT_W);
  ensure(footLines.length * 10);
  doc.text(footLines, MARGIN, y);
  setInk(doc);
}

// ---------------------------------------------------------------------------
// Footers (stamped after all content so "Page X of Y" is exact)
// ---------------------------------------------------------------------------

function stampFooters(doc, sources, genDate) {
  const total = doc.getNumberOfPages();
  const dateText = `Generated ${genDate.getFullYear()}-${String(genDate.getMonth() + 1).padStart(2, '0')}-${String(genDate.getDate()).padStart(2, '0')}`;
  const leftText = sources.length === 1
    ? `Source file SHA-256: ${truncatedHash(sources[0].hashHex)}`
    : `Source files: ${sources.length} — SHA-256 hashes on certification page`;

  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, 744, PAGE_W - MARGIN, 744);
    doc.setTextColor(...MUTED);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.text(leftText, MARGIN, 756);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Page ${i} of ${total}`, PAGE_W / 2, 756, { align: 'center' });
    doc.text(dateText, PAGE_W - MARGIN, 756, { align: 'right' });
  }
  setInk(doc);
}

function setInk(doc) {
  doc.setTextColor(...INK);
}
