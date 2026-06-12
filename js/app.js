/**
 * app.js — builder page orchestration and state.
 *
 * Everything lives in one in-memory state object. Nothing is persisted:
 * no localStorage, no sessionStorage, no cookies. A refresh wipes it all
 * (deliberately), guarded by a beforeunload warning.
 */

import { sha256Hex, cryptoAvailable, formatBytes } from './hash.js';
import { detectFormat, SUPPORTED_FORMATS_TEXT } from './parsers/detect.js';
import { parseWhatsApp } from './parsers/whatsapp.js';
import { parseSmsXml } from './parsers/smsxml.js';
import { parseMetaFiles } from './parsers/meta.js';
import { parseCsv, detectHeaderRow, csvToMessages } from './parsers/csv.js';
import {
  generateExhibitPdf, generateDeclarationPdf, scanUnsupported, buildFileName,
  loadExtendedFont,
} from './pdf.js';
import { formatLongDate } from './declaration.js';
import { redactPhrase, redactRange } from './redact.js';
import { makeSampleFile } from './sample.js';

const CHUNK = 200; // message rows rendered per "Load more"

const state = {
  sources: [],            // [{file, name, sizeBytes, hashHex, hashedAt, text}]
  format: null,           // 'whatsapp' | 'smsxml' | 'meta' | 'csv'
  messages: [],           // canonical message objects
  caseInfo: {},
  selection: new Set(),   // indices included in the exhibit
  redactions: new Map(),  // index -> {body: string, count: number}
  csvRows: null,          // parsed rows while the mapping UI is open
  whatsappVariant: null,
  filtered: [],           // indices passing the current filters
  renderedCount: 0,
  redactingIndex: null,
  batesPrefixTouched: false,
  lastSepKey: null,       // date-separator tracking across render chunks
  previewUrl: null,       // blob URL of the last preview, revoked on replace
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  if (!cryptoAvailable()) {
    $('crypto-error').hidden = false;
    $('dropzone').setAttribute('aria-disabled', 'true');
    return;
  }

  const dz = $('dropzone');
  const input = $('file-input');

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) handleFiles([...input.files]);
    input.value = '';
  });

  $('opt-dayfirst').addEventListener('change', () => reparse({ keepRedactions: true }));
  $('opt-reactions').addEventListener('change', () => reparse({ keepRedactions: false }));

  $('filter-search').addEventListener('input', () => renderList(true));
  $('filter-sender').addEventListener('change', () => renderList(true));
  $('filter-from').addEventListener('change', () => renderList(true));
  $('filter-to').addEventListener('change', () => renderList(true));
  $('select-all').addEventListener('click', () => bulkSelect(true));
  $('select-none').addEventListener('click', () => bulkSelect(false));
  $('load-more').addEventListener('click', () => renderList(false));

  $('f-exhibit').addEventListener('input', () => {
    if (!state.batesPrefixTouched) {
      $('f-bates-prefix').value = deriveBatesPrefix($('f-exhibit').value);
    }
  });
  $('f-bates-prefix').addEventListener('input', () => { state.batesPrefixTouched = true; });
  $('f-exhibit').addEventListener('input', updateStepIndicator);
  $('f-declarant').addEventListener('input', updateStepIndicator);

  $('sample-btn').addEventListener('click', () => handleFiles([makeSampleFile()]));

  $('redact-phrase-toggle').addEventListener('click', () => {
    const form = $('phrase-redact-form');
    form.hidden = !form.hidden;
    $('redact-phrase-toggle').setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) $('redact-phrase').focus();
  });
  $('redact-phrase-apply').addEventListener('click', applyPhraseRedaction);
  $('redact-phrase').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyPhraseRedaction(); }
  });

  $('opt-extfont').addEventListener('change', updateCharsetNotice);

  $('btn-generate').addEventListener('click', onGenerate);
  $('btn-preview').addEventListener('click', onPreview);
  $('btn-declaration').addEventListener('click', onDeclarationOnly);
  $('btn-copy-hash').addEventListener('click', onCopyHash);
  $('apply-mapping').addEventListener('click', applyCsvMapping);
  $('map-sender').addEventListener('change', () => {
    $('single-sender-field').hidden = $('map-sender').value !== '__single__';
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.sources.length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Step 1 — upload, hash, detect, parse
// ---------------------------------------------------------------------------

async function handleFiles(files) {
  clearError();
  $('upload-warning').hidden = true;
  $('csv-mapper').hidden = true;

  if (files.length > 1 && !files.every((f) => f.name.toLowerCase().endsWith('.json'))) {
    return showError('Multiple files are only supported for Messenger/Instagram exports — drop the message_1.json, message_2.json… parts together. For every other format, upload one file at a time.');
  }

  const big = files.filter((f) => f.size > 50 * 1024 * 1024);
  if (big.length) {
    $('upload-warning').textContent =
      `Heads up: ${big.map((f) => f.name).join(', ')} is larger than 50 MB. ` +
      'Processing happens entirely in your browser and may be slow, but we will try.';
    $('upload-warning').hidden = false;
  }

  let sources;
  try {
    sources = await Promise.all(files.map(async (file) => {
      const buffer = await file.arrayBuffer();
      const hashHex = await sha256Hex(buffer);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      return {
        file, name: file.name, sizeBytes: buffer.byteLength,
        hashHex, hashedAt: new Date(), text,
      };
    }));
  } catch (err) {
    return showError(`Could not read the file: ${err.message}`);
  }

  if (sources.every((s) => s.text.trim() === '')) {
    return showError('That file appears to be empty. Re-export your messages and try again.');
  }

  const format = detectFormat(sources[0].name, sources[0].text.slice(0, 2048));

  if (format === 'zip') {
    return showError('That is a .zip archive. Unzip it first, then upload the message_1.json file inside the conversation folder (Messenger/Instagram exports) — see the export guide for the exact path.', true);
  }
  if (!format) {
    return showError(`We could not recognize this file. Supported formats: ${SUPPORTED_FORMATS_TEXT}.`, true);
  }
  if (sources.length > 1 && format !== 'meta') {
    return showError('Multiple files are only supported for Messenger/Instagram message_N.json parts. Upload one file at a time for other formats.');
  }

  state.sources = sources;
  state.format = format;
  renderSeal();
  reparse({ keepRedactions: false, fresh: true });
}

/** (Re)parse the current sources. Used on upload and on option toggles. */
function reparse({ keepRedactions = false, fresh = false } = {}) {
  clearError();
  const prevCount = state.messages.length;
  const prevSelection = state.selection;
  const prevRedactions = state.redactions;

  try {
    if (state.format === 'whatsapp') {
      const { messages, variant } = parseWhatsApp(state.sources[0].text, {
        dayFirst: $('opt-dayfirst').checked,
      });
      if (messages.length === 0) {
        return showError('This looks like a WhatsApp export but no messages matched the expected format. Try re-exporting the chat without media, or see the export guide.', true);
      }
      state.messages = messages;
      state.whatsappVariant = variant;
    } else if (state.format === 'smsxml') {
      const { messages } = parseSmsXml(state.sources[0].text);
      if (messages.length === 0) {
        return showError('No SMS or MMS messages were found in this XML file. In SMS Backup & Restore, back up "Messages" as XML and upload that file.', true);
      }
      state.messages = messages;
    } else if (state.format === 'meta') {
      const { messages } = parseMetaFiles(
        state.sources.map((s) => ({ name: s.name, text: s.text })),
        { includeReactions: $('opt-reactions').checked },
      );
      if (messages.length === 0) {
        return showError('No messages were found in this export. Make sure you chose JSON format (not HTML) in Meta’s Download Your Information tool.', true);
      }
      state.messages = messages;
    } else if (state.format === 'csv') {
      const rows = parseCsv(state.sources[0].text);
      if (rows.length === 0) {
        return showError('No rows were found in this CSV file.');
      }
      state.csvRows = rows;
      showCsvMapper(rows);
      return; // messages are built when the user applies the mapping
    }
  } catch (err) {
    return showError(err.message, true);
  }

  // Preserve selection/redactions across re-parses that keep the same shape.
  if (!fresh && state.messages.length === prevCount) {
    state.selection = prevSelection;
    state.redactions = keepRedactions ? prevRedactions : new Map();
  } else {
    state.selection = new Set(state.messages.map((m) => m.index));
    state.redactions = new Map();
  }

  finishParse();
}

function finishParse() {
  // Format-specific options
  $('format-options').hidden = false;
  $('dayfirst-row').hidden = state.format !== 'whatsapp';
  $('reactions-row').hidden = state.format !== 'meta';

  renderSummary();
  suggestExportMethod();
  populateSenderFilter();
  revealSteps();
  renderList(true);
  updateCharsetNotice();
  updateStepIndicator();
}

function renderSummary() {
  const msgs = state.messages;
  const participants = new Set();
  for (const m of msgs) {
    if (!m.isSystem) participants.add(senderKey(m));
  }
  const stamps = msgs.filter((m) => m.timestamp).map((m) => m.timestamp);
  let range = '';
  if (stamps.length) {
    const min = new Date(Math.min(...stamps.map((d) => d.getTime())));
    const max = new Date(Math.max(...stamps.map((d) => d.getTime())));
    range = `, ${formatLongDate(min)} – ${formatLongDate(max)}`;
  }
  const p = $('parse-summary');
  p.textContent = `Parsed ${msgs.length.toLocaleString('en-US')} messages between ` +
    `${participants.size} participant${participants.size === 1 ? '' : 's'}${range}.`;
  p.hidden = false;
}

function suggestExportMethod() {
  const field = $('f-method');
  if (field.value.trim() !== '') return;
  const suggestions = {
    whatsapp: "WhatsApp built-in 'Export Chat' feature, without media",
    smsxml: 'SMS Backup & Restore app for Android, XML backup',
    meta: "Meta 'Download Your Information' tool, JSON format",
    csv: 'CSV export',
  };
  field.value = suggestions[state.format] || '';
}

function revealSteps() {
  $('step-select').hidden = false;
  $('step-case').hidden = false;
  $('step-generate').hidden = false;
  if (!$('f-exhibit').value) $('f-exhibit').value = 'Exhibit A';
  if (!$('f-bates-prefix').value || !state.batesPrefixTouched) {
    $('f-bates-prefix').value = deriveBatesPrefix($('f-exhibit').value);
  }
  if (!$('f-bates-start').value) $('f-bates-start').value = '0001';
}

// ---------------------------------------------------------------------------
// Evidence Seal
// ---------------------------------------------------------------------------

function renderSeal() {
  const container = $('seal-container');
  container.textContent = '';

  const seal = document.createElement('div');
  seal.className = 'evidence-seal';
  seal.setAttribute('role', 'status');

  const title = document.createElement('p');
  title.className = 'seal-title';
  title.textContent = 'Evidence Seal — source file integrity';
  seal.appendChild(title);

  for (const s of state.sources) {
    const block = document.createElement('dl');
    block.className = 'seal-file';

    addPair(block, 'File', s.name);
    addPair(block, 'Size', formatBytes(s.sizeBytes));

    const dt = document.createElement('dt');
    dt.textContent = 'SHA-256';
    block.appendChild(dt);
    const dd = document.createElement('dd');
    const span = document.createElement('span');
    span.className = 'seal-hash';
    span.textContent = s.hashHex;
    dd.appendChild(span);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-btn';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', `Copy SHA-256 hash of ${s.name}`);
    copy.addEventListener('click', () => copyText(s.hashHex, copy));
    dd.appendChild(copy);
    block.appendChild(dd);

    addPair(block, 'Hashed at', s.hashedAt.toLocaleString());
    seal.appendChild(block);
  }

  container.appendChild(seal);
  container.hidden = false;
}

function addPair(dl, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.appendChild(dt);
  dl.appendChild(dd);
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = old; }, 1500);
    }
  } catch {
    window.prompt('Copy the hash below:', text);
  }
}

// ---------------------------------------------------------------------------
// CSV mapping UI
// ---------------------------------------------------------------------------

function showCsvMapper(rows) {
  const mapper = $('csv-mapper');
  mapper.hidden = false;

  const cols = Math.max(...rows.slice(0, 5).map((r) => r.length));
  const table = $('csv-preview');
  table.textContent = '';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th');
    th.textContent = `Column ${c + 1}`;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows.slice(0, 5)) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      td.textContent = row[c] ?? '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // Column dropdowns
  fillColumnSelect($('map-ts'), cols, null);
  fillColumnSelect($('map-sender'), cols, '__single__', 'No sender column (single sender)');
  fillColumnSelect($('map-body'), cols, null);

  // Sensible defaults: timestamp = first date-looking column, body = longest.
  const guessTs = guessTimestampColumn(rows, cols);
  $('map-ts').value = String(guessTs);
  $('map-body').value = String(guessBodyColumn(rows, cols, guessTs));
  const guessSender = guessSenderColumn(rows, cols, guessTs, Number($('map-body').value));
  $('map-sender').value = guessSender === null ? '__single__' : String(guessSender);
  $('single-sender-field').hidden = $('map-sender').value !== '__single__';

  $('csv-header').checked = detectHeaderRow(rows, guessTs);
}

function fillColumnSelect(select, cols, extraValue, extraLabel) {
  select.textContent = '';
  if (extraValue) {
    const opt = document.createElement('option');
    opt.value = extraValue;
    opt.textContent = extraLabel;
    select.appendChild(opt);
  }
  for (let c = 0; c < cols; c++) {
    const opt = document.createElement('option');
    opt.value = String(c);
    opt.textContent = `Column ${c + 1}`;
    select.appendChild(opt);
  }
}

function guessTimestampColumn(rows, cols) {
  const sample = rows.slice(1, 8);
  for (let c = 0; c < cols; c++) {
    const hits = sample.filter((r) => r[c] && !Number.isNaN(new Date(r[c]).getTime())).length;
    if (sample.length && hits >= Math.ceil(sample.length / 2)) return c;
  }
  return 0;
}

function guessBodyColumn(rows, cols, tsCol) {
  let best = cols - 1;
  let bestLen = -1;
  const sample = rows.slice(1, 20);
  for (let c = 0; c < cols; c++) {
    if (c === tsCol) continue;
    const avg = sample.reduce((sum, r) => sum + ((r[c] || '').length), 0) / (sample.length || 1);
    if (avg > bestLen) { bestLen = avg; best = c; }
  }
  return best;
}

function guessSenderColumn(rows, cols, tsCol, bodyCol) {
  for (let c = 0; c < cols; c++) {
    if (c !== tsCol && c !== bodyCol) return c;
  }
  return null;
}

function applyCsvMapping() {
  clearError();
  const tsCol = Number($('map-ts').value);
  const senderVal = $('map-sender').value;
  const bodyCol = Number($('map-body').value);
  if (tsCol === bodyCol || (senderVal !== '__single__' && Number(senderVal) === bodyCol)) {
    return showError('The message column must be different from the timestamp and sender columns.');
  }

  const { messages } = csvToMessages(state.csvRows, {
    timestampCol: tsCol,
    senderCol: senderVal === '__single__' ? null : Number(senderVal),
    bodyCol,
    hasHeader: $('csv-header').checked,
    singleSenderName: $('single-sender').value || 'Sender',
  });

  if (messages.length === 0) {
    return showError('No messages came out of that mapping. Check the column choices and the header checkbox.');
  }

  state.messages = messages;
  state.selection = new Set(messages.map((m) => m.index));
  state.redactions = new Map();
  finishParse();
}

// ---------------------------------------------------------------------------
// Step 2 — list, filters, selection, redaction
// ---------------------------------------------------------------------------

/** Stable identity for a sender (sent-SMS messages have an empty sender). */
function senderKey(m) {
  if (m.sender) return m.sender;
  if (m.direction === 'sent') return '__me__';
  return '__unknown__';
}

function senderLabel(m) {
  if (m.isSystem && !m.sender) return '(system)';
  if (m.sender) return m.sender;
  if (m.direction === 'sent') {
    const me = ($('f-declarant') && $('f-declarant').value.trim()) || 'Me';
    return me;
  }
  return 'Unknown';
}

function populateSenderFilter() {
  const select = $('filter-sender');
  select.textContent = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All senders';
  select.appendChild(all);

  const seen = new Map(); // key -> label
  for (const m of state.messages) {
    const key = senderKey(m);
    if (!seen.has(key)) seen.set(key, senderLabel(m));
  }
  for (const [key, label] of seen) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label === '(system)' ? 'System messages' : label;
    select.appendChild(opt);
  }
}

function computeFiltered() {
  const q = $('filter-search').value.trim().toLowerCase();
  const senderFilter = $('filter-sender').value;
  const fromVal = $('filter-from').value;
  const toVal = $('filter-to').value;
  const from = fromVal ? new Date(`${fromVal}T00:00:00`) : null;
  const to = toVal ? new Date(`${toVal}T23:59:59.999`) : null;

  state.filtered = state.messages.filter((m) => {
    if (senderFilter && senderKey(m) !== senderFilter) return false;
    if (from || to) {
      if (!m.timestamp) return false;
      if (from && m.timestamp < from) return false;
      if (to && m.timestamp > to) return false;
    }
    if (q) {
      const body = currentBody(m.index).toLowerCase();
      if (!body.includes(q) && !senderLabel(m).toLowerCase().includes(q)) return false;
    }
    return true;
  }).map((m) => m.index);
}

function renderList(reset) {
  if (reset) {
    computeFiltered();
    state.renderedCount = 0;
    state.lastSepKey = null;
    $('message-list').textContent = '';
    exitRedactMode(false);
  }
  const list = $('message-list');
  const frag = document.createDocumentFragment();
  const slice = state.filtered.slice(state.renderedCount, state.renderedCount + CHUNK);
  for (const idx of slice) {
    const m = state.messages[idx];
    if (m.timestamp) {
      const key = `${m.timestamp.getFullYear()}-${m.timestamp.getMonth()}-${m.timestamp.getDate()}`;
      if (key !== state.lastSepKey) {
        state.lastSepKey = key;
        const sep = document.createElement('li');
        sep.className = 'date-sep';
        sep.textContent = formatLongDate(m.timestamp);
        frag.appendChild(sep);
      }
    }
    frag.appendChild(buildRow(idx));
  }
  list.appendChild(frag);
  state.renderedCount += slice.length;

  const more = state.filtered.length - state.renderedCount;
  $('load-more').hidden = more <= 0;
  if (more > 0) {
    $('load-more').textContent = `Load ${Math.min(CHUNK, more)} more (${more.toLocaleString('en-US')} remaining)`;
  }
  updateSelectionCount();
}

function currentBody(index) {
  const r = state.redactions.get(index);
  return r ? r.body : state.messages[index].body;
}

function buildRow(index) {
  const m = state.messages[index];
  const li = document.createElement('li');
  li.className = 'msg' + (state.selection.has(index) ? '' : ' msg-excluded');
  li.dataset.index = String(index);

  const checkWrap = document.createElement('div');
  checkWrap.className = 'msg-check';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = state.selection.has(index);
  check.setAttribute('aria-label', `Include message ${index + 1} from ${senderLabel(m)}`);
  check.addEventListener('change', () => {
    if (check.checked) state.selection.add(index);
    else state.selection.delete(index);
    li.classList.toggle('msg-excluded', !check.checked);
    updateSelectionCount();
  });
  checkWrap.appendChild(check);
  li.appendChild(checkWrap);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const sender = document.createElement('span');
  sender.className = 'msg-sender' + (m.isSystem ? ' is-system' : '');
  sender.textContent = senderLabel(m);
  meta.appendChild(sender);
  if (m.rawTimestamp) {
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = m.rawTimestamp;
    meta.appendChild(time);
  }
  if (m.direction) {
    const dir = document.createElement('span');
    dir.className = 'msg-dir';
    dir.textContent = m.direction;
    meta.appendChild(dir);
  }
  li.appendChild(meta);

  const body = document.createElement('p');
  body.className = 'msg-body';
  renderBodyInto(body, currentBody(index));
  li.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const redactBtn = document.createElement('button');
  redactBtn.type = 'button';
  redactBtn.className = 'btn btn-danger btn-small';
  redactBtn.textContent = 'Redact';
  redactBtn.addEventListener('click', () => enterRedactMode(index, li));
  actions.appendChild(redactBtn);

  if (state.redactions.has(index)) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'btn btn-secondary btn-small';
    undoBtn.textContent = 'Undo';
    undoBtn.setAttribute('aria-label', `Undo redactions in message ${index + 1}`);
    undoBtn.addEventListener('click', () => {
      state.redactions.delete(index);
      replaceRow(index, li);
    });
    actions.appendChild(undoBtn);
  }
  li.appendChild(actions);

  return li;
}

/** Render a body string, highlighting [REDACTED] markers. */
function renderBodyInto(p, text) {
  p.textContent = '';
  const parts = text.split('[REDACTED]');
  parts.forEach((part, i) => {
    if (i > 0) {
      const mark = document.createElement('mark');
      mark.className = 'redacted';
      mark.textContent = '[REDACTED]';
      p.appendChild(mark);
    }
    if (part !== '') p.appendChild(document.createTextNode(part));
  });
}

function replaceRow(index, li) {
  const fresh = buildRow(index);
  li.replaceWith(fresh);
  return fresh;
}

function bulkSelect(on) {
  computeFiltered();
  for (const idx of state.filtered) {
    if (on) state.selection.add(idx);
    else state.selection.delete(idx);
  }
  renderList(true);
  updateCharsetNotice();
}

function updateSelectionCount() {
  const el = $('selection-count');
  el.textContent = `${state.selection.size.toLocaleString('en-US')} of ` +
    `${state.messages.length.toLocaleString('en-US')} selected` +
    (state.filtered.length !== state.messages.length
      ? ` · ${state.filtered.length.toLocaleString('en-US')} shown`
      : '');
}

// --- Redaction -------------------------------------------------------------

function enterRedactMode(index, li) {
  exitRedactMode(true);
  state.redactingIndex = index;
  li.classList.add('redact-mode');

  const bar = document.createElement('div');
  bar.className = 'redact-bar';
  bar.dataset.redactBar = '1';

  const hint = document.createElement('span');
  hint.textContent = 'Select the exact text to redact in the message above, then press Confirm. Redaction removes the text from the PDF entirely — it is not a black box over hidden text.';
  bar.appendChild(hint);

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-danger btn-small';
  confirm.textContent = 'Confirm redaction';
  confirm.addEventListener('click', () => confirmRedaction(index, li));
  bar.appendChild(confirm);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary btn-small';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => exitRedactMode(true));
  bar.appendChild(cancel);

  li.appendChild(bar);
}

function exitRedactMode(rerender) {
  if (state.redactingIndex === null) return;
  const idx = state.redactingIndex;
  state.redactingIndex = null;
  const li = $('message-list').querySelector(`li[data-index="${idx}"]`);
  if (li) {
    li.classList.remove('redact-mode');
    const bar = li.querySelector('[data-redact-bar]');
    if (bar) bar.remove();
    if (rerender) replaceRow(idx, li);
  }
}

function confirmRedaction(index, li) {
  const bodyEl = li.querySelector('.msg-body');
  const sel = window.getSelection();

  const fail = (msg) => {
    const hint = li.querySelector('.redact-bar span');
    if (hint) hint.textContent = msg;
  };

  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return fail('Nothing selected yet — highlight the text to redact inside this message, then press Confirm again.');
  }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.startContainer) || !bodyEl.contains(range.endContainer)) {
    return fail('The selection must be inside this message’s text. Try selecting again.');
  }

  // Character offsets relative to the displayed body string.
  const pre = document.createRange();
  pre.selectNodeContents(bodyEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const length = range.toString().length;
  if (length === 0) return fail('Nothing selected yet — highlight some text first.');

  const { body: newBody } = redactRange(currentBody(index), start, length);
  const prev = state.redactions.get(index);
  state.redactions.set(index, { body: newBody, count: (prev ? prev.count : 0) + 1 });

  sel.removeAllRanges();
  state.redactingIndex = null;
  replaceRow(index, li);
}

/** Redact every occurrence of a typed phrase across the selected messages. */
function applyPhraseRedaction() {
  const phrase = $('redact-phrase').value;
  const result = $('redact-phrase-result');
  if (!phrase) {
    result.textContent = 'Type the exact text to redact first.';
    return;
  }
  let msgs = 0;
  let occurrences = 0;
  for (const idx of state.selection) {
    const { body, count } = redactPhrase(currentBody(idx), phrase);
    if (count > 0) {
      const prev = state.redactions.get(idx);
      state.redactions.set(idx, { body, count: (prev ? prev.count : 0) + count });
      msgs++;
      occurrences += count;
    }
  }
  if (occurrences > 0) {
    renderList(true);
    updateCharsetNotice();
    result.textContent = `Redacted ${occurrences} occurrence${occurrences === 1 ? '' : 's'} ` +
      `across ${msgs} message${msgs === 1 ? '' : 's'}. Each message has an Undo button.`;
  } else {
    result.textContent = 'No matches in the selected messages. The match is exact and case-sensitive.';
  }
}

// ---------------------------------------------------------------------------
// Step 3 — case details
// ---------------------------------------------------------------------------

function deriveBatesPrefix(label) {
  const m = (label || '').trim().match(/^exhibit\s+([A-Za-z0-9]+)$/i);
  if (m) return `EX-${m[1].toUpperCase()}-`;
  const token = (label || '').trim().split(/\s+/).pop() || '';
  if (/^[A-Za-z0-9]{1,6}$/.test(token)) return `EX-${token.toUpperCase()}-`;
  return 'EX-';
}

function readCaseInfo() {
  state.caseInfo = {
    courtName: $('f-court').value.trim(),
    caseCaption: $('f-caption').value.trim(),
    caseNumber: $('f-casenum').value.trim(),
    exhibitLabel: $('f-exhibit').value.trim(),
    declarantName: $('f-declarant').value.trim(),
    declarantRole: $('f-role').value.trim(),
    accountDesc: $('f-account').value.trim(),
    exportMethod: $('f-method').value.trim(),
    batesPrefix: $('f-bates-prefix').value.trim(),
    batesStart: $('f-bates-start').value.trim(),
  };
  return state.caseInfo;
}

function updateStepIndicator() {
  const parsed = state.messages.length > 0;
  const caseDone = $('f-exhibit').value.trim() !== '' && $('f-declarant').value.trim() !== '';
  setStep(1, parsed ? 'done' : 'current');
  setStep(2, parsed ? 'current' : '');
  setStep(3, parsed ? (caseDone ? 'done' : 'current') : '');
  setStep(4, parsed && caseDone ? 'current' : '');
}

function setStep(n, mode) {
  const el = $(`step-ind-${n}`);
  el.classList.toggle('step-done', mode === 'done');
  el.classList.toggle('step-current', mode === 'current');
}

// ---------------------------------------------------------------------------
// Step 4 — generate
// ---------------------------------------------------------------------------

function validateCaseInfo() {
  const info = readCaseInfo();
  const problems = [];
  $('f-exhibit').classList.remove('field-error');
  $('f-declarant').classList.remove('field-error');
  if (!info.exhibitLabel) {
    $('f-exhibit').classList.add('field-error');
    problems.push('an exhibit label');
  }
  if (!info.declarantName) {
    $('f-declarant').classList.add('field-error');
    problems.push('your name');
  }
  if (problems.length) {
    showGenError(`Before generating, add ${problems.join(' and ')} in Step 3.`);
    return null;
  }
  return info;
}

function buildExportMessages(info) {
  const selected = [...state.selection].sort((a, b) => a - b);
  const startNum = parseInt(info.batesStart, 10) || 1;
  const width = Math.max(4, String(startNum + selected.length - 1).length,
    (info.batesStart.match(/^\d+$/) ? info.batesStart.length : 0));

  return selected.map((idx, i) => {
    const m = state.messages[idx];
    return {
      sender: senderLabel(m),
      rawTimestamp: m.rawTimestamp,
      body: currentBody(idx),
      direction: m.direction,
      isSystem: m.isSystem,
      bates: `${info.batesPrefix}${String(startNum + i).padStart(width, '0')}`,
    };
  });
}

function buildDescription(info, exportMessages) {
  const names = [];
  for (const m of exportMessages) {
    if (!m.isSystem && m.sender && !names.includes(m.sender)) names.push(m.sender);
  }
  let who;
  if (names.length === 0) who = '';
  else if (names.length === 1) who = ` from ${names[0]}`;
  else if (names.length === 2) who = ` between ${names[0]} and ${names[1]}`;
  else if (names.length === 3) who = ` between ${names[0]}, ${names[1]} and ${names[2]}`;
  else who = ` between ${names.length} participants`;

  const stamps = [...state.selection]
    .map((i) => state.messages[i].timestamp)
    .filter(Boolean);
  let range = '';
  if (stamps.length) {
    const min = new Date(Math.min(...stamps.map((d) => d.getTime())));
    const max = new Date(Math.max(...stamps.map((d) => d.getTime())));
    range = `, ${formatLongDate(min)} to ${formatLongDate(max)}`;
  }

  return `Text message records — ${exportMessages.length.toLocaleString('en-US')} ` +
    `message${exportMessages.length === 1 ? '' : 's'}${who}${range}`;
}

function exhibitContext(info, exportMessages) {
  return {
    messages: exportMessages,
    caseInfo: info,
    sources: state.sources.map((s) => ({
      name: s.name, sizeBytes: s.sizeBytes, hashHex: s.hashHex, hashedAt: s.hashedAt,
    })),
    description: buildDescription(info, exportMessages),
    redactedCount: [...state.selection].filter((i) => state.redactions.has(i)).length,
    exportDate: state.sources[0] && state.sources[0].file.lastModified
      ? new Date(state.sources[0].file.lastModified)
      : null,
  };
}

/**
 * Charset notice: jsPDF's standard fonts cover WinAnsi only. Counts are
 * recomputed when the selection, redactions or the extended-font checkbox
 * change. The extended-font opt-in only appears when it would help.
 */
function updateCharsetNotice() {
  const msgs = [...state.selection].map((i) => ({
    sender: senderLabel(state.messages[i]),
    body: currentBody(i),
  }));
  const basic = scanUnsupported(msgs, false);
  const notice = $('charset-notice');
  if (basic === 0) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  const n = basic.toLocaleString('en-US');
  if ($('opt-extfont').checked) {
    const remaining = scanUnsupported(msgs, true);
    $('charset-text').textContent = remaining > 0
      ? `${n} selected message${basic === 1 ? '' : 's'} contain characters outside the standard PDF fonts. ` +
        `With the extended font embedded, ${remaining.toLocaleString('en-US')} will still contain placeholders ` +
        '(emoji or scripts the PDF engine cannot lay out, such as Arabic, Hebrew or CJK).'
      : `${n} selected message${basic === 1 ? '' : 's'} contain extended characters — all of them will print natively with the embedded font.`;
  } else {
    $('charset-text').textContent =
      `${n} selected message${basic === 1 ? ' contains' : 's contain'} characters (such as emoji or non-Latin script) ` +
      'that cannot be embedded in the PDF’s standard fonts. They will appear as placeholders like [emoji] or ' +
      '[non-Latin text] — nothing is silently dropped.';
  }
}

function setBusy(busy) {
  for (const id of ['btn-generate', 'btn-preview', 'btn-declaration']) {
    $(id).disabled = busy;
  }
}

/** Shared pipeline for Generate and Preview. Returns a jsPDF doc or null. */
async function buildExhibitDoc() {
  clearGenError();
  const info = validateCaseInfo();
  if (!info) return null;
  if (state.selection.size === 0) {
    showGenError('No messages are selected. Include at least one message in Step 2.');
    return null;
  }

  const exportMessages = buildExportMessages(info);
  updateCharsetNotice();

  $('progress-wrap').hidden = false;
  const progress = $('gen-progress');
  const label = $('progress-label');
  progress.value = 0;

  const extendedFontB64 = await maybeLoadExtendedFont(label);

  label.textContent = 'Preparing pages…';
  try {
    const doc = await generateExhibitPdf({
      ...exhibitContext(info, exportMessages),
      extendedFontB64,
      onProgress: (done, total) => {
        progress.max = total;
        progress.value = done;
        label.textContent = `Rendering messages: ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
      },
    });
    return { doc, info, label };
  } catch (err) {
    showGenError(`PDF generation failed: ${err.message}`);
    return null;
  }
}

/** Download the extended font when opted in; fail soft to placeholders. */
async function maybeLoadExtendedFont(label) {
  if ($('charset-notice').hidden || !$('opt-extfont').checked) return null;
  label.textContent = 'Downloading extended font (about 740 KB, cached after the first time)…';
  try {
    return await loadExtendedFont();
  } catch (err) {
    $('opt-extfont').checked = false;
    updateCharsetNotice();
    showGenError(`The extended font could not be downloaded (${err.message}). ` +
      'Generating with placeholders instead.');
    return null;
  }
}

function endGeneration() {
  setBusy(false);
  setTimeout(() => { $('progress-wrap').hidden = true; }, 4000);
  updateStepIndicator();
}

async function onGenerate() {
  setBusy(true);
  $('preview-fallback').hidden = true;
  const res = await buildExhibitDoc();
  if (res) {
    res.label.textContent = 'Saving PDF…';
    res.doc.save(buildFileName(res.info));
    res.label.textContent = 'Done. Your download should have started.';
  }
  endGeneration();
}

async function onPreview() {
  setBusy(true);
  const res = await buildExhibitDoc();
  if (res) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    const url = res.doc.output('bloburl');
    state.previewUrl = url;
    const win = window.open(url, '_blank');
    const fallback = $('preview-fallback');
    fallback.href = url;
    fallback.hidden = !!win; // popup blocked → offer a plain link instead
    res.label.textContent = win
      ? 'Preview opened in a new tab. Nothing was downloaded or uploaded.'
      : 'Preview ready — your browser blocked the new tab, use the link below.';
  }
  endGeneration();
}

async function onDeclarationOnly() {
  clearGenError();
  const info = validateCaseInfo();
  if (!info) return;
  setBusy(true);
  try {
    const ctx = exhibitContext(info, []);
    const extendedFontB64 = await maybeLoadExtendedFont($('progress-label'));
    const doc = generateDeclarationPdf({
      caseInfo: info,
      sources: ctx.sources,
      messageCount: state.selection.size,
      redactedCount: ctx.redactedCount,
      exportDate: ctx.exportDate,
      extendedFontB64,
    });
    doc.save(buildFileName(info, new Date(), '_declaration'));
  } catch (err) {
    showGenError(`PDF generation failed: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

function onCopyHash() {
  if (!state.sources.length) return;
  const text = state.sources.length === 1
    ? state.sources[0].hashHex
    : state.sources.map((s) => `${s.name}: ${s.hashHex}`).join('\n');
  copyText(text, $('btn-copy-hash'));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function showError(message, withGuideLink = false) {
  const el = $('upload-error');
  el.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = 'Problem: ';
  el.appendChild(strong);
  el.appendChild(document.createTextNode(message));
  if (withGuideLink) {
    el.appendChild(document.createTextNode(' '));
    const a = document.createElement('a');
    a.href = 'guide.html';
    a.textContent = 'Open the export guide';
    el.appendChild(a);
    el.appendChild(document.createTextNode('.'));
  }
  el.hidden = false;
}

function clearError() {
  $('upload-error').hidden = true;
}

function showGenError(message) {
  const el = $('gen-error');
  el.textContent = message;
  el.hidden = false;
}

function clearGenError() {
  $('gen-error').hidden = true;
}

init();
