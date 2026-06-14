/**
 * ai-lab.js - DOM controller for the AI Review Lab page.
 *
 * Responsibilities:
 *   - read the pasted messages + claim, parse and chunk them,
 *   - load the local embedding model and embed claim + messages (with progress,
 *     batching, yielding and cancellation),
 *   - render cautiously-labelled result groups, and
 *   - offer a copyable / downloadable .txt review memo.
 *
 * Safety: ALL user-supplied content is rendered with createElement + textContent.
 * innerHTML is never used with message text. No eval. No network call ever
 * carries message text (see evidence-map.js for the privacy/CSP notes).
 */

import {
  parseMessages,
  buildChunks,
  buildEvidenceMap,
  buildMemo,
  loadEmbedder,
  embedTexts,
  embedOne,
  CancelledError,
  MAX_MESSAGES,
} from './evidence-map.js';

const $ = (id) => document.getElementById(id);

const els = {
  messages: $('ai-messages'),
  claim: $('ai-claim'),
  generate: $('ai-generate'),
  cancel: $('ai-cancel'),
  status: $('ai-status'),
  progressWrap: $('ai-progress-wrap'),
  progress: $('ai-progress'),
  error: $('ai-error'),
  results: $('ai-results'),
  summary: $('ai-summary'),
  groups: $('ai-groups'),
  memoActions: $('ai-memo-actions'),
  copyMemo: $('ai-copy-memo'),
  downloadMemo: $('ai-download-memo'),
  truncateNotice: $('ai-truncate-notice'),
};

// Module state for the current run. Message text lives only here, in memory,
// for the duration of the run; nothing is persisted anywhere.
let embedder = null;        // cached pipeline so a second run is fast
let cancelled = false;
let running = false;
let lastResult = null;
let lastClaim = '';

/* ----------------------------- small helpers ----------------------------- */

function setStatus(text) {
  if (els.status) els.status.textContent = text || '';
}

function showError(text) {
  if (!els.error) return;
  els.error.textContent = text;
  els.error.hidden = false;
}

function clearError() {
  if (els.error) {
    els.error.hidden = true;
    els.error.textContent = '';
  }
}

function setProgress(value) {
  if (!els.progress) return;
  if (value == null) {
    els.progress.removeAttribute('value'); // indeterminate
  } else {
    els.progress.value = value;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setRunning(state) {
  running = state;
  els.generate.disabled = state;
  els.cancel.hidden = !state;
  els.progressWrap.hidden = !state;
}

/* ------------------------------- rendering ------------------------------- */

function badgeClass(item) {
  if (item.needsContext) return 'ai-badge ai-badge-context';
  if (item.label === 'strong') return 'ai-badge ai-badge-strong';
  if (item.label === 'possible') return 'ai-badge ai-badge-possible';
  return 'ai-badge ai-badge-low';
}

function renderResultItem(item) {
  const card = el('li', 'ai-result');

  const head = el('div', 'ai-result-head');
  const badge = el('span', badgeClass(item), `${item.percent}% relevance`);
  head.appendChild(badge);

  const who = el('span', 'ai-result-who', item.message.sender || 'Unknown sender');
  head.appendChild(who);

  if (item.message.rawTimestamp) {
    head.appendChild(el('span', 'ai-result-time', item.message.rawTimestamp));
  }
  card.appendChild(head);

  // Message body - textContent only (never innerHTML), preserves line breaks via CSS.
  card.appendChild(el('p', 'ai-result-body', item.message.body));

  const reasons = item.needsContext ? item.contextReasons : item.reasons;
  if (reasons && reasons.length) {
    const wrap = el('p', 'ai-result-reasons');
    reasons.forEach((r) => wrap.appendChild(el('span', 'ai-reason', r)));
    card.appendChild(wrap);
  }
  return card;
}

function renderGroup(title, items, { collapsed = false, note = '' } = {}) {
  if (!items.length) return null;
  const section = el('section', 'ai-group');

  if (collapsed) {
    const details = el('details');
    const summary = el('summary');
    summary.appendChild(el('span', 'ai-group-title', `${title} (${items.length})`));
    details.appendChild(summary);
    const list = el('ul', 'ai-result-list');
    items.forEach((it) => list.appendChild(renderResultItem(it)));
    details.appendChild(list);
    section.appendChild(details);
    return section;
  }

  const h = el('h3', 'ai-group-title', `${title} (${items.length})`);
  section.appendChild(h);
  if (note) section.appendChild(el('p', 'ai-group-note', note));
  const list = el('ul', 'ai-result-list');
  items.forEach((it) => list.appendChild(renderResultItem(it)));
  section.appendChild(list);
  return section;
}

function renderChecklistGroup(title, items, className) {
  if (!items.length) return null;
  const section = el('section', 'ai-group');
  section.appendChild(el('h3', 'ai-group-title', title));
  const ul = el('ul', className);
  items.forEach((t) => ul.appendChild(el('li', null, t)));
  section.appendChild(ul);
  return section;
}

function renderResult(result) {
  els.summary.textContent = result.summary;
  els.groups.replaceChildren();

  const blocks = [
    renderGroup('Strongly related messages', result.groups.strong),
    renderGroup('Possibly related messages', result.groups.possible),
    renderGroup('Needs context', result.groups.needsContext, {
      note: 'These may relate to your claim but depend on surrounding messages, '
        + 'a missing sender, or a missing timestamp. Review the originals.',
    }),
    renderChecklistGroup('Possible gaps to review', result.gaps, 'ai-gaps'),
    renderChecklistGroup('Human review checklist', result.checklist, 'ai-checklist'),
    renderGroup('Low match messages', result.groups.low.slice(0, 25), {
      collapsed: true,
    }),
  ];

  for (const b of blocks) if (b) els.groups.appendChild(b);

  els.results.hidden = false;
  els.memoActions.hidden = false;
}

/* ------------------------------- main flow ------------------------------- */

async function run() {
  if (running) return;
  clearError();
  els.results.hidden = true;
  els.memoActions.hidden = true;
  els.truncateNotice.hidden = true;
  cancelled = false;

  const claim = (els.claim.value || '').trim();
  const raw = els.messages.value || '';

  if (!claim) {
    showError('Enter what you are trying to show with these messages.');
    els.claim.focus();
    return;
  }

  let messages = parseMessages(raw);
  if (!messages.length) {
    showError('Paste at least one message to review.');
    els.messages.focus();
    return;
  }

  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(0, MAX_MESSAGES);
    els.truncateNotice.textContent =
      `AI Review Lab currently reviews the first ${MAX_MESSAGES} messages for performance. `
      + 'Use search or paste a smaller section for best results.';
    els.truncateNotice.hidden = false;
  }

  setRunning(true);

  try {
    // 1. Load model
    setStatus('Loading local AI model. The first run may take a little while because the local AI model has to download to your browser.');
    setProgress(null);
    if (!embedder) {
      embedder = await loadEmbedder((p) => {
        if (p && p.status === 'progress' && typeof p.progress === 'number') {
          setStatus(`Downloading local AI model: ${Math.round(p.progress)}% (${p.file || ''})`);
        }
      });
    }
    if (cancelled) throw new CancelledError();

    // 2. Prepare chunks
    setStatus('Preparing message chunks…');
    const chunks = buildChunks(messages);
    await new Promise((r) => setTimeout(r, 0));
    if (cancelled) throw new CancelledError();

    // 3. Embed claim
    setStatus('Comparing message meaning…');
    setProgress(0);
    const claimVec = await embedOne(embedder, claim);
    if (cancelled) throw new CancelledError();

    // 4. Embed messages (batched, cancellable)
    const msgVecs = await embedTexts(embedder, chunks, {
      onProgress: (done, total) => {
        setProgress(Math.round((done / total) * 100));
        setStatus(`Comparing message meaning… ${done} of ${total}`);
      },
      shouldCancel: () => cancelled,
    });

    // 5. Build + render the map
    setStatus('Building evidence map…');
    const result = buildEvidenceMap(messages, claimVec, msgVecs, claim);
    lastResult = result;
    lastClaim = claim;
    renderResult(result);
    setStatus('Evidence map ready. Review the original messages yourself.');
  } catch (err) {
    if (err instanceof CancelledError) {
      setStatus('AI review cancelled. No message text was saved.');
    } else {
      console.error(err);
      setStatus('');
      showError('Local AI could not load in this browser. You can still use ExhibitKit’s normal search and exhibit tools.');
    }
  } finally {
    setRunning(false);
  }
}

/* ----------------------------- memo actions ------------------------------ */

function currentMemo() {
  if (!lastResult) return '';
  return buildMemo(lastResult, lastClaim);
}

async function copyMemo() {
  const text = currentMemo();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    els.copyMemo.textContent = 'Copied';
    setTimeout(() => { els.copyMemo.textContent = 'Copy review memo'; }, 1500);
  } catch {
    showError('Could not copy automatically - select the memo text manually.');
  }
}

function downloadMemo() {
  const text = currentMemo();
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'exhibitkit-ai-review-memo.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------------- wiring --------------------------------- */

if (els.generate) {
  els.generate.addEventListener('click', run);
  els.cancel.addEventListener('click', () => { cancelled = true; });
  els.copyMemo.addEventListener('click', copyMemo);
  els.downloadMemo.addEventListener('click', downloadMemo);
}
