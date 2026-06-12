/**
 * smsxml.js — parser for "SMS Backup & Restore" (Android) XML exports.
 *
 *   <smses count="2">
 *     <sms address="+13045551234" date="1718200000000" type="1"
 *          body="Hey" readable_date="Jun 12, 2026 9:46:40 AM"
 *          contact_name="Natalie" />
 *   </smses>
 *
 * type="1" = received, type="2" = sent. MMS is handled minimally: text parts
 * are extracted, other attachments become bracketed placeholders.
 *
 * Sent messages get sender '' + direction 'sent'; the app substitutes the
 * declarant's name from the case-details form at display/PDF time.
 */

import { formatDisplayTimestamp } from './meta.js';

/**
 * @param {string} xmlText
 * @returns {{messages: Array}}
 * @throws {Error} when the XML cannot be parsed
 */
export function parseSmsXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('This XML file could not be parsed. Re-export it from SMS Backup & Restore as "XML" and try again.');
  }

  const out = [];

  for (const el of doc.querySelectorAll('sms')) {
    const type = el.getAttribute('type');
    const direction = type === '1' ? 'received' : type === '2' ? 'sent' : null;
    const epoch = Number(el.getAttribute('date'));
    const timestamp = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch) : null;
    const readable = el.getAttribute('readable_date');

    out.push({
      index: 0,
      timestamp,
      rawTimestamp: readable || (timestamp ? formatDisplayTimestamp(timestamp) : ''),
      sender: direction === 'sent' ? '' : pickContactName(el),
      body: el.getAttribute('body') || '',
      direction,
      isSystem: false,
    });
  }

  for (const el of doc.querySelectorAll('mms')) {
    const msgBox = el.getAttribute('msg_box');
    const direction = msgBox === '1' ? 'received' : msgBox === '2' ? 'sent' : null;
    let epoch = Number(el.getAttribute('date'));
    // Some sources store MMS dates in epoch seconds rather than milliseconds.
    if (Number.isFinite(epoch) && epoch > 0 && epoch < 1e12) epoch *= 1000;
    const timestamp = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch) : null;
    const readable = el.getAttribute('readable_date');

    const pieces = [];
    for (const part of el.querySelectorAll('part')) {
      const ct = (part.getAttribute('ct') || '').toLowerCase();
      if (ct === 'application/smil') continue;
      if (ct === 'text/plain') {
        const t = part.getAttribute('text');
        if (t) pieces.push(t);
      } else if (ct) {
        pieces.push(`[Attachment: ${ct}]`);
      }
    }

    out.push({
      index: 0,
      timestamp,
      rawTimestamp: readable || (timestamp ? formatDisplayTimestamp(timestamp) : ''),
      sender: direction === 'sent' ? '' : pickContactName(el),
      body: pieces.join('\n') || '[MMS message]',
      direction,
      isSystem: false,
    });
  }

  // Chronological order (stable; null timestamps keep their relative spot).
  out.sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return a.timestamp - b.timestamp;
  });
  out.forEach((m, i) => { m.index = i; });

  return { messages: out };
}

function pickContactName(el) {
  const name = el.getAttribute('contact_name');
  if (name && name.trim() && name.trim() !== '(Unknown)') return name.trim();
  return el.getAttribute('address') || 'Unknown';
}
