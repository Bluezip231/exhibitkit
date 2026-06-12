/**
 * fixtures.js — hand-written sample exports for the in-browser test page.
 * Invisible WhatsApp characters are written as \u escapes on purpose.
 */

// --- WhatsApp iOS: bracketed style, \u200e LTR marks, \u202f narrow nbsp ---
export const WHATSAPP_IOS = [
  '\u200e[6/12/26, 3:44:00\u202fPM] Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.',
  '[6/12/26, 3:45:10\u202fPM] Isaiah: Hey, did you get my message about Saturday?',
  '[6/12/26, 3:46:02\u202fPM] Natalie: Yes — I can do 10am',
  'and we can meet at the park',
  'near the fountain',
  '\u200e[6/12/26, 3:47:00\u202fPM] Isaiah: \u200e<Media omitted>',
  '[6/12/26, 3:48:30\u202fPM] Natalie: Perfect 👍',
].join('\n');

// --- WhatsApp Android: dash style, 24-hour times, DD/MM ambiguity ---
export const WHATSAPP_ANDROID = [
  '12/06/26, 15:44 - Messages and calls are end-to-end encrypted.',
  '12/06/26, 15:45 - Isaiah: Are you coming Saturday?',
  '12/06/26, 15:46 - Natalie: Yes',
  'second line of the same message',
].join('\n');

// --- SMS Backup & Restore XML: received + sent sms, mms with image part ---
export const SMS_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<smses count="3" backup_set="x" backup_date="1718200200000">
  <sms protocol="0" address="+13045551234" date="1718200000000" type="1" subject="null" body="Hey, are you coming Saturday?" toa="null" sc_toa="null" service_center="null" read="1" status="-1" locked="0" readable_date="Jun 12, 2026 9:46:40 AM" contact_name="Natalie" />
  <sms protocol="0" address="+13045551234" date="1718200060000" type="2" subject="null" body="Yes &#8212; see you at 10" toa="null" sc_toa="null" service_center="null" read="1" status="-1" locked="0" readable_date="Jun 12, 2026 9:47:40 AM" contact_name="Natalie" />
  <mms date="1718200120000" msg_box="1" address="+13045551234" m_type="132" readable_date="Jun 12, 2026 9:48:40 AM" contact_name="Natalie">
    <parts>
      <part seq="-1" ct="application/smil" name="null" text="&lt;smil&gt;&lt;/smil&gt;" />
      <part seq="0" ct="image/jpeg" name="photo.jpg" cl="photo.jpg" />
      <part seq="1" ct="text/plain" name="null" text="Here is the photo" />
    </parts>
  </mms>
</smses>`;

// --- Meta (Messenger/Instagram) JSON: newest-first order, mojibake text ---
// content below is the double-encoded ("mojibake") form of "Café 😀"
// exactly as Meta's exporter writes it: é → \u00c3\u00a9, 😀 → \u00f0\u009f\u0098\u0080.
export const META_JSON_1 = JSON.stringify({
  participants: [{ name: 'Isaiah' }, { name: 'Natalie' }],
  messages: [
    {
      sender_name: 'Natalie',
      timestamp_ms: 1718200300000,
      content: 'Caf\u00c3\u00a9 \u00f0\u009f\u0098\u0080',
      type: 'Generic',
    },
    {
      sender_name: 'Isaiah',
      timestamp_ms: 1718200200000,
      content: 'Hey!',
      type: 'Generic',
      reactions: [{ reaction: '\u00f0\u009f\u0091\u008d', actor: 'Natalie' }],
    },
    {
      sender_name: 'Natalie',
      timestamp_ms: 1718200100000,
      photos: [{ uri: 'messages/photos/x.jpg', creation_timestamp: 1718200100 }],
      type: 'Generic',
    },
  ],
});

export const META_JSON_2 = JSON.stringify({
  participants: [{ name: 'Isaiah' }, { name: 'Natalie' }],
  messages: [
    {
      sender_name: 'Isaiah',
      timestamp_ms: 1718200050000,
      content: 'Older message from part two',
      type: 'Generic',
    },
    {
      sender_name: 'Natalie',
      timestamp_ms: 1718200000000,
      is_unsent: true,
      type: 'Generic',
    },
  ],
});

// --- CSV: quoted commas, embedded newline, escaped quotes, header row ---
export const CSV_TEXT = [
  'Date,Sender,Message',
  '2026-06-12 09:46,Natalie,"Hello, with a comma"',
  '2026-06-12 09:47,Isaiah,"Line one',
  'Line two"',
  '2026-06-12 09:48,Natalie,"He said ""yes"""',
].join('\r\n');

/** Synthetic export-shaped messages for the PDF performance test. */
export function makeSyntheticMessages(n) {
  const out = [];
  const bodies = [
    'Short message.',
    'A somewhat longer message that will wrap across at least one line of the generated PDF page, to keep the layout honest.',
    'Multi-line\nmessage body\nwith three lines.',
  ];
  for (let i = 0; i < n; i++) {
    out.push({
      sender: i % 2 ? 'Natalie' : 'Isaiah',
      rawTimestamp: `6/12/26, ${(i % 12) + 1}:${String(i % 60).padStart(2, '0')} PM`,
      body: `${bodies[i % 3]} (#${i + 1})`,
      direction: null,
      isSystem: false,
      bates: `EX-A-${String(i + 1).padStart(5, '0')}`,
    });
  }
  return out;
}
