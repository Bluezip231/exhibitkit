/**
 * meta.js - parser for Facebook Messenger / Instagram DM JSON exports
 * (Meta "Download Your Information", JSON format, message_1.json files).
 *
 * Notes:
 *  - Meta exports list messages newest-first; we re-sort ascending.
 *  - Meta's exporter double-encodes non-ASCII text: UTF-8 bytes are written
 *    as if they were Latin-1 code points ("mojibake"), so an emoji like
 *    U+1F600 arrives as the four code points \u00f0\u009f\u0098\u0080 and
 *    \u00e9 (e-acute) arrives as \u00c3\u00a9. fixMojibake() re-decodes
 *    every string after JSON.parse.
 *  - Messages without `content` (photos, stickers, calls…) become bracketed
 *    placeholders - a message is never silently skipped.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Deterministic display timestamp, e.g. "Jun 12, 2026, 9:46 AM".
 * Meta provides no display string, so we generate one (locale-independent).
 */
export function formatDisplayTimestamp(date) {
  const h24 = date.getHours();
  const meridiem = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${h12}:${mm} ${meridiem}`;
}

/**
 * Repair Meta's Latin-1-as-UTF-8 double encoding.
 * Falls back to the original string when it is not valid mojibake.
 */
export function fixMojibake(str) {
  if (typeof str !== 'string' || str === '') return str;
  try {
    // escape() maps each code point ≤ 0xFF to %XX; decodeURIComponent then
    // re-reads those bytes as UTF-8. Throws if the bytes are not valid UTF-8
    // (i.e. the string was not mojibake) - in that case keep the original.
    return decodeURIComponent(escape(str));
  } catch {
    return str;
  }
}

/** Recursively fix every string field in a parsed JSON value. */
function fixDeep(value) {
  if (typeof value === 'string') return fixMojibake(value);
  if (Array.isArray(value)) return value.map(fixDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = fixDeep(value[k]);
    return out;
  }
  return value;
}

/**
 * Parse one or more Meta JSON files (message_1.json, message_2.json, …),
 * merge them and sort ascending by timestamp.
 *
 * @param {Array<{name: string, text: string}>} files
 * @param {{includeReactions?: boolean}} opts
 * @returns {{messages: Array, participants: string[]}}
 * @throws {Error} friendly message when a file is not a Meta conversation
 */
export function parseMetaFiles(files, opts = {}) {
  const includeReactions = !!opts.includeReactions;
  const rawMessages = [];
  const participants = new Set();

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(f.text);
    } catch {
      throw new Error(`"${f.name}" is not valid JSON. Upload the message_1.json file from your Meta export (JSON format, not HTML).`);
    }
    if (!data || !Array.isArray(data.messages)) {
      throw new Error(`"${f.name}" does not look like a Messenger/Instagram conversation file. Look for message_1.json inside the conversation's folder.`);
    }
    data = fixDeep(data);
    for (const p of data.participants || []) {
      if (p && p.name) participants.add(p.name);
    }
    rawMessages.push(...data.messages);
  }

  // Meta exports are newest-first; sort ascending for the exhibit. Coerce the
  // timestamp once (some re-serialized exports store it as a numeric string)
  // so the sort key and the Date agree.
  const epochOf = (m) => {
    const n = Number(m.timestamp_ms);
    return Number.isFinite(n) ? n : null;
  };
  rawMessages.sort((a, b) => (epochOf(a) ?? 0) - (epochOf(b) ?? 0));

  const messages = rawMessages.map((m, i) => {
    const epoch = epochOf(m);
    const ts = epoch != null ? new Date(epoch) : null;
    const { body, isSystem } = buildBody(m, includeReactions);
    return {
      index: i,
      timestamp: ts,
      rawTimestamp: ts ? formatDisplayTimestamp(ts) : '',
      sender: m.sender_name || '',
      body,
      direction: null,
      isSystem,
    };
  });

  return { messages, participants: [...participants] };
}

function buildBody(m, includeReactions) {
  const parts = [];
  let isSystem = false;

  if (m.is_unsent) {
    return { body: '[Message unsent]', isSystem: true };
  }
  if (m.type === 'Call') {
    const dur = Number.isFinite(m.call_duration) && m.call_duration > 0
      ? ` (${m.call_duration} seconds)` : '';
    parts.push(`[Call${dur}]`);
    isSystem = true;
  }

  if (typeof m.content === 'string' && m.content !== '') parts.push(m.content);

  const addEach = (arr, label) => {
    if (Array.isArray(arr)) for (let i = 0; i < arr.length; i++) parts.push(`[${label}]`);
  };
  addEach(m.photos, 'Photo attachment');
  addEach(m.videos, 'Video attachment');
  addEach(m.audio_files, 'Audio attachment');
  addEach(m.gifs, 'GIF attachment');
  addEach(m.files, 'File attachment');
  if (m.sticker) parts.push('[Sticker]');
  if (m.share) {
    parts.push(m.share.link ? `[Shared link: ${m.share.link}]` : '[Shared content]');
  }

  if (parts.length === 0) {
    parts.push(m.type && m.type !== 'Generic' ? `[${m.type}]` : '[Message with no text content]');
    isSystem = true;
  }

  if (includeReactions && Array.isArray(m.reactions)) {
    for (const r of m.reactions) {
      parts.push(`[Reaction from ${r.actor || 'unknown'}: ${r.reaction || ''}]`);
    }
  }

  return { body: parts.join('\n'), isSystem };
}
