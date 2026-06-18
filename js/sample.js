/**
 * sample.js - small fictional chats (one per supported format) so visitors can
 * try the whole pipeline (hashing, parsing, selecting, redacting, generating)
 * without exporting anything first.
 *
 * Every sample goes through the exact same code path as a real upload: it is
 * wrapped in a File object, hashed, detected and parsed normally. The shapes
 * mirror tests/fixtures.js, so they are guaranteed to parse and pass detection.
 *
 * The fictional Jane/John co-parenting scenario is reused across formats so each
 * demo exercises the same Evidence Map categories (money, custody, dates,
 * agreements, attachments) and includes an account number for the redaction
 * demo. It deliberately contains no threats, to show that category staying empty.
 */

const LINES = [
  '[5/3/26, 9:12:04 AM] Jane Smith: Are you picking Emma up from school on Friday?',
  '[5/3/26, 9:14:30 AM] John Smith: Yes, 3pm. I can drop her back Sunday at 6.',
  '[5/3/26, 9:15:02 AM] Jane Smith: That works. Please remember her allergy medicine this time.',
  '[5/3/26, 9:20:45 AM] John Smith: I will.',
  '[5/7/26, 6:02:11 PM] Jane Smith: You said the support payment would come through Monday. It is Thursday.',
  '[5/7/26, 6:40:09 PM] John Smith: Money is tight. You will get it when you get it.',
  '[5/7/26, 6:41:33 PM] Jane Smith: That is the second month in a row it has been late.',
  '[5/12/26, 8:30:00 AM] John Smith: I can do $300 now and the rest on the 20th.',
  'Send me your account number again.',
  '[5/12/26, 8:33:21 AM] Jane Smith: It is 4417-220-9981, same as before.',
  '[5/12/26, 8:35:00 AM] John Smith: Got it.',
  '[5/19/26, 7:15:44 PM] Jane Smith: Emma said you did not show up for pickup today. She waited 40 minutes.',
  '[5/19/26, 8:02:10 PM] John Smith: Something came up at work. I texted you.',
  '[5/19/26, 8:03:05 PM] Jane Smith: No, you did not. This is the third missed pickup since March.',
  '[5/26/26, 1:11:09 PM] John Smith: Fine. New schedule starting June: I take her Wednesdays and every other weekend 😀',
  '[5/26/26, 1:14:27 PM] Jane Smith: Put that in writing through the parenting app please.',
  '[6/1/26, 10:05:18 AM] John Smith: \u200e<Media omitted>',
  '[6/1/26, 10:06:00 AM] John Smith: That is the receipt for May.',
  '[6/1/26, 10:09:41 AM] Jane Smith: Received, thank you.',
];

const PREAMBLE =
  '\u200e[5/3/26, 9:11:50 AM] Messages and calls are end-to-end encrypted. ' +
  'No one outside of this chat, not even WhatsApp, can read or listen to them.';

export const SAMPLE_FILE_NAME = 'Sample WhatsApp Chat (fictional).txt';

export function makeSampleFile() {
  const text = [PREAMBLE, ...LINES].join('\n');
  return new File([text], SAMPLE_FILE_NAME, {
    type: 'text/plain',
    lastModified: Date.now(),
  });
}

// --- Messenger / Instagram (Meta "Download Your Information", JSON) ----------

/** A fictional message_1.json export (Meta writes messages newest-first). */
export function makeSampleMetaFile() {
  const data = {
    participants: [{ name: 'Jane Smith' }, { name: 'John Smith' }],
    messages: [
      { sender_name: 'John Smith', timestamp_ms: Date.UTC(2026, 5, 1, 14, 6), content: "That's the receipt for May.", type: 'Generic' },
      { sender_name: 'John Smith', timestamp_ms: Date.UTC(2026, 5, 1, 14, 5), photos: [{ uri: 'messages/photos/receipt.jpg', creation_timestamp: 1748786700 }], type: 'Generic' },
      { sender_name: 'Jane Smith', timestamp_ms: Date.UTC(2026, 4, 26, 17, 14), content: 'Please put the new schedule in the parenting app.', type: 'Generic' },
      { sender_name: 'Jane Smith', timestamp_ms: Date.UTC(2026, 4, 12, 12, 33), content: 'My account number is 4417-220-9981, same as before.', type: 'Generic' },
      { sender_name: 'John Smith', timestamp_ms: Date.UTC(2026, 4, 12, 12, 30), content: 'I can pay $300 now and the rest on the 20th.', type: 'Generic' },
      { sender_name: 'Jane Smith', timestamp_ms: Date.UTC(2026, 4, 7, 22, 2), content: 'The support payment is late again - second month in a row.', type: 'Generic' },
      { sender_name: 'John Smith', timestamp_ms: Date.UTC(2026, 4, 3, 13, 14), content: "Sounds good, I'll pick Emma up from school Friday at 3pm.", type: 'Generic' },
    ],
  };
  return new File([JSON.stringify(data, null, 2)], 'message_1.json', {
    type: 'application/json',
    lastModified: Date.now(),
  });
}

// --- SMS Backup & Restore (Android, XML) ------------------------------------

/** A fictional SMS Backup & Restore XML backup (type 1 = received, 2 = sent). */
export function makeSampleSmsFile() {
  const row = (date, type, body) =>
    `  <sms protocol="0" address="+13045550147" date="${date}" type="${type}" ` +
    `subject="null" body="${body}" read="1" status="-1" locked="0" ` +
    `readable_date="${new Date(date).toUTCString()}" contact_name="John Smith" />`;
  const xml = [
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
    '<smses count="4" backup_set="sample" backup_date="1748786700000">',
    row(Date.UTC(2026, 4, 3, 13, 14), 1, "I'll pick Emma up from school Friday at 3pm."),
    row(Date.UTC(2026, 4, 7, 22, 2), 2, 'The support payment is late again.'),
    row(Date.UTC(2026, 4, 12, 12, 30), 1, 'I can pay $300 now and the rest on the 20th. Send your account number.'),
    `  <mms date="${Date.UTC(2026, 5, 1, 14, 5)}" msg_box="1" address="+13045550147" m_type="132" readable_date="${new Date(Date.UTC(2026, 5, 1, 14, 5)).toUTCString()}" contact_name="John Smith">`,
    '    <parts>',
    '      <part seq="-1" ct="application/smil" name="null" text="&lt;smil&gt;&lt;/smil&gt;" />',
    '      <part seq="0" ct="image/jpeg" name="receipt.jpg" cl="receipt.jpg" />',
    '      <part seq="1" ct="text/plain" name="null" text="Here is the receipt for May" />',
    '    </parts>',
    '  </mms>',
    '</smses>',
  ].join('\n');
  return new File([xml], 'sms-sample.xml', {
    type: 'text/xml',
    lastModified: Date.now(),
  });
}

// --- Generic CSV ------------------------------------------------------------

/** A fictional CSV export (opens the column mapper; auto-guess pre-fills it). */
export function makeSampleCsvFile() {
  const csv = [
    'timestamp,sender,message',
    "2026-05-03 09:14,John Smith,I'll pick Emma up from school Friday at 3pm",
    '2026-05-07 18:02,Jane Smith,The support payment is late again',
    '2026-05-12 08:30,John Smith,I can pay $300 now and the rest on the 20th',
    '2026-05-12 08:33,Jane Smith,"My account number is 4417-220-9981, same as before"',
    '2026-05-26 13:14,Jane Smith,Put the new schedule in the parenting app please',
  ].join('\r\n');
  return new File([csv], 'messages-sample.csv', {
    type: 'text/csv',
    lastModified: Date.now(),
  });
}

/**
 * Registry used by the builder's "Try a demo" buttons. `id` matches the
 * data-sample attribute on each button in app.html.
 */
export const SAMPLES = [
  { id: 'whatsapp', label: 'WhatsApp', make: makeSampleFile },
  { id: 'meta', label: 'Messenger', make: makeSampleMetaFile },
  { id: 'smsxml', label: 'SMS', make: makeSampleSmsFile },
  { id: 'csv', label: 'CSV', make: makeSampleCsvFile },
];
