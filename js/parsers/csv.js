/**
 * csv.js — RFC 4180 CSV parser (state machine, not regex split) plus
 * column-mapping into canonical messages.
 *
 * Handles: quoted fields containing commas and newlines, escaped quotes
 * (""), CRLF/LF line endings, and tab/semicolon delimiters (auto-detected).
 */

/**
 * Parse CSV text into rows of string fields.
 * @param {string} text
 * @param {string} [delimiter] ',' '\t' or ';' — auto-detected when omitted
 * @returns {string[][]}
 */
export function parseCsv(text, delimiter) {
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  // Skip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xFEFF) i = 1;

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      if (ch === '\r') { // normalize CRLF / lone CR inside quoted fields
        field += '\n';
        i += text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      i++; continue;
    }
    field += ch; i++;
  }

  // Final field/row (file may not end with a newline).
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully empty trailing rows.
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop();

  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.slice(0, 4000).split(/\r?\n/)[0] || '';
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
  };
  let best = ',';
  for (const d of ['\t', ';']) if (counts[d] > counts[best]) best = d;
  return best;
}

/**
 * Guess whether the first row is a header: its timestamp-column value does
 * not parse as a date while most of the following rows' values do.
 */
export function detectHeaderRow(rows, timestampCol) {
  if (rows.length < 2) return false;
  const firstParses = isDateLike(rows[0][timestampCol]);
  if (firstParses) return false;
  const sample = rows.slice(1, 11);
  const parsed = sample.filter((r) => isDateLike(r[timestampCol])).length;
  return parsed >= Math.ceil(sample.length / 2);
}

function isDateLike(value) {
  if (!value || !value.trim()) return false;
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
    // Bare numbers: only epoch-scale values count as dates.
    return Number(value) > 1e9;
  }
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Convert parsed rows into canonical messages using a column mapping.
 *
 * @param {string[][]} rows
 * @param {{
 *   timestampCol: number,
 *   senderCol: number|null,
 *   bodyCol: number,
 *   hasHeader: boolean,
 *   singleSenderName?: string
 * }} mapping
 * @returns {{messages: Array}}
 */
export function csvToMessages(rows, mapping) {
  const start = mapping.hasHeader ? 1 : 0;
  const messages = [];

  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    const rawTs = (row[mapping.timestampCol] ?? '').trim();
    const body = row[mapping.bodyCol] ?? '';
    const sender = mapping.senderCol !== null && mapping.senderCol !== undefined
      ? (row[mapping.senderCol] ?? '').trim()
      : (mapping.singleSenderName || '').trim();

    // Skip rows that are completely empty.
    if (rawTs === '' && body.trim() === '' && sender === '') continue;

    let timestamp = null;
    if (rawTs !== '') {
      if (/^\d{10,13}$/.test(rawTs)) {
        const num = Number(rawTs);
        timestamp = new Date(rawTs.length <= 10 ? num * 1000 : num);
      } else {
        const d = new Date(rawTs);
        if (!Number.isNaN(d.getTime())) timestamp = d;
      }
    }

    messages.push({
      index: messages.length,
      timestamp,                 // null is fine; sorting falls back to source order
      rawTimestamp: rawTs,       // printed exactly as it appeared in the file
      sender,
      body,
      direction: null,
      isSystem: false,
    });
  }

  return { messages };
}
