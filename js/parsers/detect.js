/**
 * detect.js - format auto-detection from file name + a leading sample of text.
 *
 * Returns one of:
 *   'whatsapp' | 'smsxml' | 'meta' | 'csv' | 'zip' | 'meta-html' | 'html' | null
 */

import { WHATSAPP_IOS_RE, WHATSAPP_ANDROID_RE } from './whatsapp.js';

/**
 * @param {string} fileName
 * @param {string} sampleText leading text of the decoded file (≥ ~64 KB so an
 *   HTML export's body markers are visible past its large inline stylesheet)
 * @returns {'whatsapp'|'smsxml'|'meta'|'csv'|'zip'|'meta-html'|'html'|null}
 */
export function detectFormat(fileName, sampleText) {
  const name = (fileName || '').toLowerCase();
  const sample = sampleText || '';

  if (name.endsWith('.zip')) return 'zip';

  // HTML files are never directly supported. The most common case by far is a
  // user who chose Meta's HTML export format instead of JSON, so single that
  // out for a precise, actionable error.
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    const low = sample.toLowerCase();
    const looksMeta =
      low.includes('your_facebook_activity/messages') ||
      low.includes('your_instagram_activity/messages') ||
      low.includes('/messages/inbox/') ||
      low.includes('<title>your messages</title>') ||
      (low.includes('fbcdn.net') && low.includes('message'));
    return looksMeta ? 'meta-html' : 'html';
  }

  if (name.endsWith('.xml') && (sample.includes('<smses') || sample.includes('<sms '))) {
    return 'smsxml';
  }

  if (name.endsWith('.json') && sample.includes('"participants"') && sample.includes('"messages"')) {
    return 'meta';
  }

  if (name.endsWith('.txt')) {
    const firstLine = firstNonEmptyLine(sample);
    if (firstLine !== null &&
        (WHATSAPP_IOS_RE.test(firstLine) || WHATSAPP_ANDROID_RE.test(firstLine))) {
      return 'whatsapp';
    }
  }

  if (name.endsWith('.csv')) return 'csv';

  // A .txt that is not WhatsApp but looks tabular (commas or tabs) → CSV flow.
  if (name.endsWith('.txt') && looksTabular(sample)) return 'csv';

  return null;
}

function firstNonEmptyLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return null;
}

function looksTabular(sample) {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 5);
  if (lines.length < 2) return false;
  const tabCounts = lines.map((l) => (l.match(/\t/g) || []).length);
  const commaCounts = lines.map((l) => (l.match(/,/g) || []).length);
  const allHaveTabs = tabCounts.every((c) => c >= 1);
  const allHaveCommas = commaCounts.every((c) => c >= 2);
  return allHaveTabs || allHaveCommas;
}

/** Human-readable list of supported formats, for error messages. */
export const SUPPORTED_FORMATS_TEXT =
  'WhatsApp chat export (.txt), SMS Backup & Restore (.xml), ' +
  'Facebook Messenger / Instagram export (message_1.json), or CSV (.csv)';
