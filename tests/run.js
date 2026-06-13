/**
 * run.js — tiny in-browser test harness (no framework).
 * Open tests/run.html over http://localhost to run.
 */

import { detectFormat } from '../js/parsers/detect.js';
import { parseWhatsApp } from '../js/parsers/whatsapp.js';
import { parseSmsXml } from '../js/parsers/smsxml.js';
import { parseMetaFiles, fixMojibake } from '../js/parsers/meta.js';
import { parseCsv, detectHeaderRow, csvToMessages } from '../js/parsers/csv.js';
import { sha256Hex, cryptoAvailable } from '../js/hash.js';
import {
  sanitizeForPdf, scanUnsupported, buildFileName, generateExhibitPdf,
  loadExtendedFont,
} from '../js/pdf.js';
import { buildDeclaration } from '../js/declaration.js';
import { redactPhrase, redactRange } from '../js/redact.js';
import { makeSampleFile } from '../js/sample.js';
import { parseWhatsApp as parseWhatsAppSample } from '../js/parsers/whatsapp.js';
import {
  WHATSAPP_IOS, WHATSAPP_ANDROID, SMS_XML, META_JSON_1, META_JSON_2,
  META_HTML, CSV_TEXT, makeSyntheticMessages,
} from './fixtures.js';

const results = [];
const pending = [];

function test(name, fn) {
  const record = { name, pass: false, err: null };
  results.push(record);
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => { record.pass = true; })
      .catch((err) => { record.err = err; })
  );
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// detect.js
// ---------------------------------------------------------------------------

test('detect: WhatsApp .txt', () => {
  assertEqual(detectFormat('chat.txt', WHATSAPP_IOS.slice(0, 2048)), 'whatsapp');
});
test('detect: SMS XML', () => {
  assertEqual(detectFormat('sms-20260612.xml', SMS_XML.slice(0, 2048)), 'smsxml');
});
test('detect: Meta JSON', () => {
  assertEqual(detectFormat('message_1.json', META_JSON_1.slice(0, 2048)), 'meta');
});
test('detect: CSV', () => {
  assertEqual(detectFormat('export.csv', CSV_TEXT.slice(0, 2048)), 'csv');
});
test('detect: tabular .txt falls back to CSV', () => {
  assertEqual(detectFormat('export.txt', 'a,b,c\n1,2,3\n4,5,6'), 'csv');
});
test('detect: zip flagged', () => {
  assertEqual(detectFormat('facebook-export.zip', 'PK...'), 'zip');
});
test('detect: Meta HTML export flagged as meta-html (chose HTML, not JSON)', () => {
  assertEqual(detectFormat('your_messages.html', META_HTML), 'meta-html');
});
test('detect: a non-Meta HTML file flagged as html', () => {
  assertEqual(detectFormat('notes.html', '<html><body><p>hi</p></body></html>'), 'html');
});
test('detect: unknown returns null', () => {
  assertEqual(detectFormat('notes.docx', 'hello'), null);
});

// ---------------------------------------------------------------------------
// WhatsApp parser
// ---------------------------------------------------------------------------

test('whatsapp iOS: counts, system flag, multiline, raw timestamps', () => {
  const { messages, variant } = parseWhatsApp(WHATSAPP_IOS);
  assertEqual(variant, 'ios');
  assertEqual(messages.length, 5, 'message count');
  assert(messages[0].isSystem, 'encryption notice is a system message');
  assertEqual(messages[0].sender, '');
  assertEqual(messages[1].sender, 'Isaiah');
  assertEqual(messages[1].rawTimestamp, '6/12/26, 3:45:10 PM', 'invisible marks cleaned from timestamp');
  assertEqual(messages[2].body, 'Yes — I can do 10am\nand we can meet at the park\nnear the fountain', 'multiline preserved');
  assert(messages[3].body.includes('<Media omitted>'), 'media placeholder kept verbatim');
  assertEqual(messages[1].timestamp.getMonth(), 5, 'June with M/D parsing');
  assertEqual(messages[1].timestamp.getHours(), 15, 'PM time');
});

test('whatsapp Android: variant, 24-hour time, continuation line', () => {
  const { messages, variant } = parseWhatsApp(WHATSAPP_ANDROID);
  assertEqual(variant, 'android');
  assertEqual(messages.length, 3);
  assert(messages[0].isSystem);
  assertEqual(messages[2].body, 'Yes\nsecond line of the same message');
  assertEqual(messages[1].timestamp.getHours(), 15);
});

test('whatsapp: Day/Month toggle re-interprets dates, rawTimestamp unchanged', () => {
  const mdy = parseWhatsApp(WHATSAPP_ANDROID).messages[1];
  const dmy = parseWhatsApp(WHATSAPP_ANDROID, { dayFirst: true }).messages[1];
  assertEqual(mdy.timestamp.getMonth(), 11, '12/06 as M/D = December');
  assertEqual(dmy.timestamp.getMonth(), 5, '12/06 as D/M = June');
  assertEqual(mdy.rawTimestamp, dmy.rawTimestamp, 'raw timestamp never changes');
});

// ---------------------------------------------------------------------------
// SMS XML parser
// ---------------------------------------------------------------------------

test('smsxml: sms + mms, directions, contact names, attachments', () => {
  const { messages } = parseSmsXml(SMS_XML);
  assertEqual(messages.length, 3);
  assertEqual(messages[0].direction, 'received');
  assertEqual(messages[0].sender, 'Natalie');
  assertEqual(messages[1].direction, 'sent');
  assertEqual(messages[1].sender, '', 'sent messages get sender from the form later');
  assertEqual(messages[1].body, 'Yes — see you at 10', 'XML entity decoded');
  assertEqual(messages[0].rawTimestamp, 'Jun 12, 2026 9:46:40 AM', 'readable_date kept');
  assert(messages[2].body.includes('[Attachment: image/jpeg]'), 'mms image placeholder');
  assert(messages[2].body.includes('Here is the photo'), 'mms text part kept');
  assert(messages[0].timestamp < messages[1].timestamp, 'chronological order');
});

test('smsxml: epoch-seconds dates scaled to ms like MMS (not 1970)', () => {
  const xml = '<smses>'
    + '<sms type="1" date="1718200000" body="sec" contact_name="A"/>'
    + '<sms type="1" date="1718200000000" body="ms" contact_name="A"/>'
    + '</smses>';
  const { messages } = parseSmsXml(xml);
  assertEqual(messages[0].timestamp.getFullYear(), messages[1].timestamp.getFullYear(),
    'seconds and millisecond rows land in the same year');
  assert(messages[0].timestamp.getFullYear() > 2020, 'seconds value is not stuck in 1970');
});

test('smsxml: a null/zero-timestamp row does not corrupt dated ordering', () => {
  const xml = '<smses>'
    + '<sms type="1" date="1718200000000" body="later" contact_name="X"/>'
    + '<sms type="1" date="0" body="nodate" contact_name="X"/>'
    + '<sms type="1" date="1718100000000" body="earlier" contact_name="X"/>'
    + '</smses>';
  const order = parseSmsXml(xml).messages.map((m) => m.body);
  assert(order.indexOf('earlier') < order.indexOf('later'),
    `dated messages stay chronological around a null timestamp (${order.join(',')})`);
});

// ---------------------------------------------------------------------------
// Meta parser
// ---------------------------------------------------------------------------

test('meta: mojibake fix restores emoji and accents', () => {
  assertEqual(fixMojibake('CafÃ©'), 'Café');
  assertEqual(fixMojibake('\u00f0\u009f\u0098\u0080'), '\u{1F600}');
  assertEqual(fixMojibake('plain ascii'), 'plain ascii');
});

test('meta: single file — ascending order, placeholders, fixed text', () => {
  const { messages } = parseMetaFiles([{ name: 'message_1.json', text: META_JSON_1 }]);
  assertEqual(messages.length, 3);
  assert(messages[0].timestamp <= messages[1].timestamp && messages[1].timestamp <= messages[2].timestamp,
    'sorted ascending despite newest-first input');
  assertEqual(messages[0].body, '[Photo attachment]', 'photo message never silently skipped');
  assertEqual(messages[2].body, 'Café \u{1F600}', 'mojibake repaired in content');
  assertEqual(messages[2].sender, 'Natalie');
});

test('meta: reactions only when enabled', () => {
  const off = parseMetaFiles([{ name: 'message_1.json', text: META_JSON_1 }]);
  const on = parseMetaFiles([{ name: 'message_1.json', text: META_JSON_1 }], { includeReactions: true });
  assert(!off.messages[1].body.includes('[Reaction'), 'off by default');
  assert(on.messages[1].body.includes('[Reaction from Natalie: \u{1F44D}]'), 'reaction line with fixed emoji');
});

test('meta: two-file merge, unsent marker', () => {
  const { messages } = parseMetaFiles([
    { name: 'message_1.json', text: META_JSON_1 },
    { name: 'message_2.json', text: META_JSON_2 },
  ]);
  assertEqual(messages.length, 5);
  assertEqual(messages[0].body, '[Message unsent]');
  assert(messages[0].isSystem, 'unsent marked as system');
  for (let i = 1; i < messages.length; i++) {
    assert(messages[i - 1].timestamp <= messages[i].timestamp, 'merged files stay chronological');
  }
});

test('meta: numeric-string timestamp_ms both sorts and yields a Date', () => {
  const json = JSON.stringify({
    participants: [{ name: 'A' }],
    messages: [
      { sender_name: 'A', timestamp_ms: '1718200200000', content: 'newer' },
      { sender_name: 'A', timestamp_ms: '1718200100000', content: 'older' },
    ],
  });
  const { messages } = parseMetaFiles([{ name: 's.json', text: json }]);
  assertEqual(messages.map((m) => m.body).join(','), 'older,newer', 'sorted ascending');
  assert(messages[0].timestamp instanceof Date && !Number.isNaN(messages[0].timestamp.getTime()),
    'string timestamp produced a valid Date');
  assert(messages[0].rawTimestamp.length > 0, 'string timestamp produced a display string');
});

test('meta: invalid file produces a friendly error', () => {
  let threw = false;
  try {
    parseMetaFiles([{ name: 'random.json', text: '{"foo": 1}' }]);
  } catch (err) {
    threw = true;
    assert(err.message.includes('message_1.json'), 'error mentions the expected file');
  }
  assert(threw, 'should throw');
});

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

test('csv: RFC 4180 quoting — commas, newlines, escaped quotes', () => {
  const rows = parseCsv(CSV_TEXT);
  assertEqual(rows.length, 4);
  assertEqual(rows[1][2], 'Hello, with a comma');
  assertEqual(rows[2][2], 'Line one\nLine two', 'newline inside quoted field');
  assertEqual(rows[3][2], 'He said "yes"', 'escaped quotes');
});

test('csv: a quote after whitespace following the delimiter still opens the field', () => {
  // Common in real exporters: `, "value, with comma"` (space before quote).
  const rows = parseCsv('1718200000000, "Hello, world", Bob');
  assertEqual(rows[0].length, 3, 'embedded comma did not split the field');
  assertEqual(rows[0][1], 'Hello, world', 'quoted value preserved intact');
});

test('csv: header detection and message mapping', () => {
  const rows = parseCsv(CSV_TEXT);
  assert(detectHeaderRow(rows, 0), 'header detected');
  const { messages } = csvToMessages(rows, {
    timestampCol: 0, senderCol: 1, bodyCol: 2, hasHeader: true,
  });
  assertEqual(messages.length, 3);
  assertEqual(messages[0].sender, 'Natalie');
  assert(messages[0].timestamp instanceof Date && !Number.isNaN(messages[0].timestamp.getTime()));
  assertEqual(messages[0].rawTimestamp, '2026-06-12 09:46', 'raw string preserved');
});

test('csv: unparseable timestamps stay null, raw kept', () => {
  const rows = parseCsv('when,who,what\nnot a date,Ann,hi');
  const { messages } = csvToMessages(rows, {
    timestampCol: 0, senderCol: 1, bodyCol: 2, hasHeader: true,
  });
  assertEqual(messages[0].timestamp, null);
  assertEqual(messages[0].rawTimestamp, 'not a date');
});

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

test('hash: sha256("abc") matches the known test vector', async () => {
  assert(cryptoAvailable(), 'crypto.subtle unavailable — open this page over localhost/HTTPS');
  const buf = new TextEncoder().encode('abc');
  const hex = await sha256Hex(buf);
  assertEqual(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---------------------------------------------------------------------------
// PDF sanitization & helpers
// ---------------------------------------------------------------------------

test('sanitize: emoji and non-Latin become explicit placeholders', () => {
  assertEqual(sanitizeForPdf('Perfect \u{1F44D}').text, 'Perfect [emoji]');
  assertEqual(sanitizeForPdf('日本語 ok').text, '[non-Latin text] ok');
  assertEqual(sanitizeForPdf('café — "fine"').text, 'café — "fine"', 'cp1252 chars pass through');
  const multi = sanitizeForPdf('\u{1F600}\u{1F600}\u{1F600}');
  assertEqual(multi.text, '[emoji]', 'runs collapse to one placeholder');
});

test('sanitize: invisible direction marks are dropped, never placeholdered', () => {
  assertEqual(sanitizeForPdf('\u200e<Media omitted>').text, '<Media omitted>');
});

test('sanitize: extended font mode passes Cyrillic/Greek, still placeholders emoji and CJK', () => {
  assertEqual(sanitizeForPdf('Привет, как дела?', true).text, 'Привет, как дела?');
  assertEqual(sanitizeForPdf('Привет', false).text, '[non-Latin text]');
  assertEqual(sanitizeForPdf('Καλημέρα', true).text, 'Καλημέρα');
  assertEqual(sanitizeForPdf('日本語', true).text, '[non-Latin text]', 'CJK still placeholder');
  assertEqual(sanitizeForPdf('שלום', true).text, '[non-Latin text]', 'RTL still placeholder (no bidi engine)');
  assertEqual(sanitizeForPdf('ok \u{1F600}', true).text, 'ok [emoji]', 'emoji still placeholder');
});

test('redact: phrase replaced everywhere with counts', () => {
  const r = redactPhrase('call 555-1234 or 555-1234 now', '555-1234');
  assertEqual(r.body, 'call [REDACTED] or [REDACTED] now');
  assertEqual(r.count, 2);
  assertEqual(redactPhrase('nothing here', 'xyz').count, 0);
  assertEqual(redactPhrase('text', '').count, 0, 'empty phrase is a no-op');
});

test('redact: range splice', () => {
  const r = redactRange('account 12345 end', 8, 5);
  assertEqual(r.body, 'account [REDACTED] end');
  assertEqual(r.count, 1);
  assertEqual(redactRange('abc', 99, 5).count, 0, 'out-of-range is a no-op');
});

test('sample chat parses through the normal WhatsApp pipeline', async () => {
  const file = makeSampleFile();
  const text = await file.text();
  const { messages, variant } = parseWhatsAppSample(text);
  assertEqual(variant, 'ios');
  assert(messages.length >= 18, `expected a real conversation, got ${messages.length} messages`);
  assert(messages[0].isSystem, 'starts with the encryption notice');
  assert(messages.some((m) => m.body.includes('\n')), 'contains a multi-line message');
});

test('scanUnsupported counts affected messages', () => {
  const count = scanUnsupported([
    { sender: 'A', body: 'plain' },
    { sender: 'B', body: 'has \u{1F600}' },
    { sender: 'C中', body: 'plain' },
  ]);
  assertEqual(count, 2);
});

test('buildFileName sanitizes for the filesystem', () => {
  const name = buildFileName(
    { exhibitLabel: 'Exhibit A', caseCaption: 'Smith v. Smith' },
    new Date(2026, 5, 12),
  );
  assertEqual(name, 'Exhibit-A_Smith-v.-Smith_2026-06-12.pdf');
});

// ---------------------------------------------------------------------------
// Declaration
// ---------------------------------------------------------------------------

test('declaration: includes hash, counts, optional redaction paragraph', () => {
  const base = {
    caseInfo: { declarantName: 'Jane Smith', declarantRole: 'Petitioner' },
    messageCount: 134,
    precedingPages: 12,
    sources: [{ name: 'chat.txt', sizeBytes: 48213, hashHex: 'ab'.repeat(32) }],
    redactedCount: 0,
    exportDate: new Date(2026, 5, 1),
  };
  const noRedact = buildDeclaration(base);
  const withRedact = buildDeclaration({ ...base, redactedCount: 3 });
  assertEqual(noRedact.paragraphs.length, 5);
  assertEqual(withRedact.paragraphs.length, 6);
  assert(withRedact.paragraphs[4].includes('Portions of 3 messages'));
  assert(noRedact.paragraphs[3].includes('ab'.repeat(32)), 'full hash present');
  assert(noRedact.paragraphs[2].includes('June 1, 2026'), 'export date');
  assert(noRedact.intro.includes('Jane Smith'));
});

test('declaration: multiple sources list every file and hash', () => {
  const d = buildDeclaration({
    caseInfo: { declarantName: 'J' },
    messageCount: 10,
    precedingPages: 2,
    sources: [
      { name: 'message_1.json', sizeBytes: 100, hashHex: 'aa'.repeat(32) },
      { name: 'message_2.json', sizeBytes: 200, hashHex: 'bb'.repeat(32) },
    ],
    redactedCount: 0,
    exportDate: null,
  });
  const hashPara = d.paragraphs.find((p) => p.includes('SHA-256'));
  assert(hashPara.includes('aa'.repeat(32)) && hashPara.includes('bb'.repeat(32)),
    'both hashes on certification page');
});

// ---------------------------------------------------------------------------
// Render results + wire up the perf button
// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  const list = document.getElementById('results');
  let passed = 0;
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.pass ? 'pass' : 'fail';
    li.textContent = r.name + (r.err ? ` — ${r.err.message}` : '');
    list.appendChild(li);
    if (r.pass) passed++;
  }
  const summary = document.getElementById('summary');
  summary.textContent = `${passed} / ${results.length} tests passed`;
  summary.style.color = passed === results.length ? 'var(--verify-green)' : 'var(--seal)';
});

document.getElementById('extfont-btn').addEventListener('click', async () => {
  const label = document.getElementById('extfont-label');
  label.textContent = 'Downloading DejaVu Sans (~740 KB)…';
  try {
    const extendedFontB64 = await loadExtendedFont();
    label.textContent = 'Generating…';
    const doc = await generateExhibitPdf({
      messages: [
        { sender: 'Наталья Иванова', rawTimestamp: 'Jun 12, 2026, 9:46 AM', body: 'Привет! Ты придёшь в субботу? Καλημέρα. Łódź, Việt Nam.', direction: null, isSystem: false, bates: 'EX-U-0001' },
        { sender: 'Isaiah', rawTimestamp: 'Jun 12, 2026, 9:47 AM', body: 'Mixed: café, 日本語 stays a placeholder, emoji too \u{1F600}', direction: null, isSystem: false, bates: 'EX-U-0002' },
      ],
      caseInfo: { exhibitLabel: 'Exhibit U', caseCaption: 'Unicode v. WinAnsi', declarantName: 'Test Runner' },
      sources: [{ name: 'unicode-test.txt', sizeBytes: 123, hashHex: 'cd'.repeat(32), hashedAt: new Date() }],
      description: 'Extended-font rendering check — open the PDF and confirm the Cyrillic and Greek lines are readable.',
      redactedCount: 0, exportDate: null, extendedFontB64,
    });
    doc.save('extended-font-test.pdf');
    label.textContent = 'Done — check extended-font-test.pdf: Cyrillic/Greek should be real text, CJK/emoji placeholders.';
  } catch (err) {
    label.textContent = `Failed: ${err.message}`;
  }
});

document.getElementById('perf-btn').addEventListener('click', async () => {
  const label = document.getElementById('perf-label');
  const progress = document.getElementById('perf-progress');
  progress.hidden = false;
  const messages = makeSyntheticMessages(20000);
  const t0 = performance.now();
  try {
    const doc = await generateExhibitPdf({
      messages,
      caseInfo: {
        exhibitLabel: 'Exhibit A', caseCaption: 'Perf v. Test',
        caseNumber: '26-PERF-20000', declarantName: 'Test Runner',
      },
      sources: [{
        name: 'synthetic-20k.txt', sizeBytes: 1234567,
        hashHex: 'a3f9c2e81b7d4f06c5a92e13d8b07f449c61e2a05d3f78b1e4c90a627d5b8f12',
        hashedAt: new Date(),
      }],
      description: 'Synthetic 20,000-message performance fixture',
      redactedCount: 0,
      exportDate: null,
      onProgress: (done, total) => {
        progress.max = total;
        progress.value = done;
        label.textContent = `Rendering ${done.toLocaleString()} / ${total.toLocaleString()}…`;
      },
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    label.textContent = `Generated ${doc.getNumberOfPages()} pages in ${secs}s. Saving…`;
    doc.save('perf-20k.pdf');
  } catch (err) {
    label.textContent = `Failed: ${err.message}`;
  }
});
