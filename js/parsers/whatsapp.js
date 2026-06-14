/**
 * whatsapp.js - parser for WhatsApp's built-in "Export chat" .txt files.
 *
 * Two main line formats exist:
 *   iOS:     [6/12/26, 3:45:12 PM] Isaiah: Message text
 *   Android: 6/12/26, 15:45 - Isaiah: Message text
 *
 * Lines that do not match the timestamp pattern are continuations of the
 * previous message body. WhatsApp sprinkles invisible Unicode marks
 * (‎ LTR, ‏ RTL,   narrow no-break space) around timestamps
 * and senders; the regexes tolerate them so the BODY is never modified.
 */

// Date: 1-2 digits / 1-2 digits / 2-4 digits with / . or - separators.
// Time: H:MM with optional :SS and optional AM/PM (with optional dots).
const DATE_PART = String.raw`(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})`;
const TIME_PART = String.raw`(\d{1,2}:\d{2}(?::\d{2})?[ \u202f\u00a0]?(?:[AaPp]\.?[Mm]\.?)?)`;
const INVIS = String.raw`[\u200e\u200f]*`;
const SP = String.raw`[ \u202f\u00a0]`;

/** iOS bracketed style: "[date, time] rest" */
export const WHATSAPP_IOS_RE = new RegExp(
  `^${INVIS}\\[${DATE_PART},?${SP}${TIME_PART}\\]${SP}?(.*)$`
);

/** Android dash style: "date, time - rest" */
export const WHATSAPP_ANDROID_RE = new RegExp(
  `^${INVIS}${DATE_PART},?${SP}${TIME_PART}${SP}?-${SP}?(.*)$`
);

/** Remove WhatsApp's invisible marks from timestamp/sender strings ONLY. */
function cleanMeta(s) {
  return s
    .replace(/[\u200e\u200f]/g, '')
    .replace(/[\u202f\u00a0]/g, ' ')
    .trim();
}

/**
 * Parse a WhatsApp date + time string into a Date.
 * Month/day order is ambiguous internationally; `dayFirst` re-interprets.
 * Returns null when the parts do not form a valid date.
 */
export function parseWhatsAppDate(dateStr, timeStr, dayFirst = false) {
  const dParts = dateStr.split(/[\/.\-]/).map((p) => parseInt(p, 10));
  if (dParts.length !== 3 || dParts.some(Number.isNaN)) return null;

  const [a, b, c] = dParts;
  let year, month, day;
  if (a >= 1000) {
    // ISO-ish: 2026-06-12
    year = a; month = b; day = c;
  } else {
    year = c;
    month = dayFirst ? b : a;
    day = dayFirst ? a : b;
  }
  if (year < 100) year += 2000;

  const tm = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp])?\.?[Mm]?\.?$/);
  if (!tm) return null;
  let hours = parseInt(tm[1], 10);
  const minutes = parseInt(tm[2], 10);
  const seconds = tm[3] ? parseInt(tm[3], 10) : 0;
  const meridiem = tm[4] ? tm[4].toUpperCase() : null;
  if (meridiem === 'P' && hours < 12) hours += 12;
  if (meridiem === 'A' && hours === 12) hours = 0;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, hours, minutes, seconds);
  // Reject rollover (e.g. Feb 31 → Mar 3), which signals wrong day/month order.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Parse a WhatsApp export.
 * @param {string} text full decoded file text
 * @param {{dayFirst?: boolean}} opts
 * @returns {{messages: Array, variant: 'ios'|'android'|null}}
 */
export function parseWhatsApp(text, opts = {}) {
  const dayFirst = !!opts.dayFirst;
  const lines = text.split(/\r?\n/);

  // Decide the variant from the first matching line.
  let variant = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (WHATSAPP_IOS_RE.test(line)) { variant = 'ios'; }
    else if (WHATSAPP_ANDROID_RE.test(line)) { variant = 'android'; }
    break; // the first non-empty line decides
  }
  if (!variant) {
    // Fall back: scan all lines in case the file starts with stray content.
    for (const line of lines) {
      if (WHATSAPP_IOS_RE.test(line)) { variant = 'ios'; break; }
      if (WHATSAPP_ANDROID_RE.test(line)) { variant = 'android'; break; }
    }
  }
  if (!variant) return { messages: [], variant: null };

  const re = variant === 'ios' ? WHATSAPP_IOS_RE : WHATSAPP_ANDROID_RE;
  const messages = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      if (current) messages.push(current);
      const dateStr = cleanMeta(m[1]);
      const timeStr = cleanMeta(m[2]);
      const rest = m[3];

      // Split "Sender: body" at the first ": ". No colon → system message.
      let sender = '';
      let body = rest;
      let isSystem = true;
      const colon = rest.indexOf(': ');
      if (colon > 0) {
        sender = cleanMeta(rest.slice(0, colon));
        body = rest.slice(colon + 2);
        isSystem = false;
      } else if (rest.endsWith(':') && rest.length > 1) {
        // "Sender:" with an empty body
        sender = cleanMeta(rest.slice(0, -1));
        body = '';
        isSystem = false;
      }

      current = {
        index: messages.length,
        timestamp: parseWhatsAppDate(dateStr, timeStr, dayFirst),
        rawTimestamp: `${dateStr}, ${timeStr}`,
        sender,
        body,
        direction: null,
        isSystem,
      };
    } else if (current) {
      // Continuation of the previous message body - preserved verbatim.
      current.body += '\n' + line;
    }
    // Lines before the first match are ignored (export preamble).
  }
  if (current) messages.push(current);

  return { messages, variant };
}
