/**
 * evidence-map-lite.js - deterministic Evidence Map for the builder.
 *
 * Pure, offline, AI-free helpers that group parsed messages into keyword
 * categories and build a factual day-by-day timeline. Used by app.js to render
 * the "Evidence map" panel. No DOM, no network, no model: the builder's CSP
 * forbids the AI runtime, and these are plain keyword/date operations.
 *
 * IMPORTANT: categories are keyword matches, NOT legal conclusions, and may
 * include false positives. Timeline rows are strictly factual (date, sender,
 * an exact snippet of the message) - this module never writes sentences or
 * judges the strength of evidence.
 */

import { CATEGORIES } from './keywords.js';
import { formatLongDate } from './declaration.js';

const SNIPPET_MAX = 80;

/**
 * Tag every message with zero or more categories and tally the people involved.
 *
 * @param {Array} messages canonical message objects ({index, body, sender, …})
 * @param {object} [opts]
 * @param {(m)=>string} [opts.bodyOf]  redaction-aware body accessor
 * @param {(m)=>string} [opts.keyOf]   stable identity key for a sender
 * @param {(m)=>string} [opts.labelOf] display label for a sender
 * @returns {{byCategory: Object<string,Set<number>>,
 *            people: Array<{label:string,count:number}>,
 *            counts: Object<string,number>}}
 */
export function categorize(messages, opts = {}) {
  const bodyOf = opts.bodyOf || ((m) => m.body || '');
  const keyOf = opts.keyOf || ((m) => m.sender || '(unknown)');
  const labelOf = opts.labelOf || ((m) => m.sender || 'Unknown');

  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c.id] = new Set();

  const peopleMap = new Map(); // key -> { label, count }

  for (const m of messages) {
    const text = bodyOf(m);
    for (const c of CATEGORIES) {
      if (c.test(text)) byCategory[c.id].add(m.index);
    }
    if (!m.isSystem) {
      const key = keyOf(m);
      const entry = peopleMap.get(key);
      if (entry) entry.count += 1;
      else peopleMap.set(key, { label: labelOf(m), count: 1 });
    }
  }

  const people = [...peopleMap.values()].sort((a, b) => b.count - a.count);

  const counts = {};
  for (const c of CATEGORIES) counts[c.id] = byCategory[c.id].size;
  counts.people = people.length;
  counts.total = messages.length;

  return { byCategory, people, counts };
}

/**
 * Build a chronological, day-grouped timeline of the messages that carry a real
 * timestamp. Messages without a timestamp are counted but not placed.
 *
 * @param {Array} messages
 * @param {object} [opts]
 * @param {(m)=>string} [opts.bodyOf]
 * @param {(m)=>string} [opts.labelOf]
 * @param {number} [opts.maxEntries] cap on entries rendered (perf guard)
 * @returns {{days: Array<{dayKey,dateLabel,entries:Array}>,
 *            withoutTimestamp:number, datedCount:number, truncated:boolean}}
 */
export function buildTimeline(messages, opts = {}) {
  const bodyOf = opts.bodyOf || ((m) => m.body || '');
  const labelOf = opts.labelOf || ((m) => m.sender || 'Unknown');
  const maxEntries = Number.isFinite(opts.maxEntries) ? opts.maxEntries : Infinity;

  const dated = messages.filter((m) => m.timestamp instanceof Date && !Number.isNaN(m.timestamp.getTime()));
  const withoutTimestamp = messages.length - dated.length;
  dated.sort((a, b) => a.timestamp - b.timestamp);

  const days = [];
  let current = null;
  let count = 0;
  let truncated = false;

  for (const m of dated) {
    if (count >= maxEntries) { truncated = true; break; }
    const d = m.timestamp;
    const dayKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (!current || current.dayKey !== dayKey) {
      current = { dayKey, dateLabel: formatLongDate(d), entries: [] };
      days.push(current);
    }
    const text = bodyOf(m);
    current.entries.push({
      index: m.index,
      time: m.rawTimestamp || formatClock(d),
      sender: labelOf(m),
      snippet: snippet(text),
      categories: CATEGORIES.filter((c) => c.test(text)).map((c) => c.id),
    });
    count += 1;
  }

  return { days, withoutTimestamp, datedCount: dated.length, truncated };
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatClock(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Single-line, length-capped excerpt of a message body (no fabrication). */
function snippet(text, max = SNIPPET_MAX) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
