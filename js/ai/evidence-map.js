/**
 * evidence-map.js - AI Evidence Mapper core (for the optional AI Review Lab).
 *
 * WHAT THIS IS
 *   A local, in-browser semantic relevance helper. It embeds a user-supplied
 *   claim and their pasted messages with a small sentence-embedding model
 *   (Transformers.js, running entirely on-device), ranks messages by cosine
 *   similarity to the claim, and groups them with cautious, rule-based labels.
 *
 * WHAT THIS IS NOT
 *   It is NOT part of the official ExhibitKit exhibit pipeline. The court-ready
 *   PDF builder stays deterministic and AI-free. This module never rewrites
 *   evidence, never decides admissibility, and never gives legal advice. It
 *   only organizes text by *possible* relevance for human review.
 *
 * PRIVACY
 *   All embedding happens in the browser. The only network traffic is GET
 *   requests that DOWNLOAD the public model weights and the library/runtime
 *   from a CDN/model host - user message text is never uploaded. Nothing is
 *   written to localStorage, sessionStorage, IndexedDB, or cookies by this
 *   module. (Transformers.js may cache the downloaded *model files* in the
 *   browser Cache API; those are public weights, not your messages.)
 *
 * MODEL CHOICE
 *   Xenova/all-MiniLM-L6-v2 - a small (~23 MB quantized), well-supported
 *   sentence-embedding model that runs in the browser via Transformers.js and
 *   produces 384-dim normalized embeddings with mean pooling. If this id ever
 *   stops resolving, swap MODEL_ID for the smallest available Transformers.js
 *   feature-extraction model and note it here.
 *
 * LIBRARY PIN
 *   We import @huggingface/transformers pinned to the v3 major line rather than
 *   @latest, so a future breaking major (v4+) can't silently break this page
 *   while we still receive v3 patch fixes. The browser feature-extraction API
 *   and the Xenova/all-MiniLM-L6-v2 model are stable on v3.
 *
 * The pure functions below (parsing, chunking, cosine similarity, scoring,
 * labelling, gap analysis, summary, memo) contain no DOM and no model calls,
 * so they are unit-testable on their own (see tests/ai-lab-test.html).
 */

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

// Hard caps and thresholds, named so they read clearly at the call site.
export const MAX_MESSAGES = 1000;     // v1 performance ceiling
export const STRONG_THRESHOLD = 0.55;
export const POSSIBLE_THRESHOLD = 0.40;
export const SHORT_BODY_CHARS = 20;   // "short reply" body length

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

// [6/12/26, 3:45 PM] Isaiah: Message text
const RE_BRACKET = /^\[\s*([^\]]+?)\s*\]\s*([^:\n]{1,60}?):\s?(.*)$/;
// 6/12/26, 3:45 PM - Isaiah: Message text   /   6/12/26, 15:45 - Isaiah: ...
const RE_DASH = /^(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[APap]\.?[Mm]\.?)?)\s+-\s+([^:\n]{1,60}?):\s?(.*)$/;
// Isaiah: Message text   (no '/' in the sender so URLs like https:// don't match)
const RE_SENDER = /^([^:\n/]{1,40}?):\s(.+)$/;

/**
 * Parse pasted text into messages. Supports bracketed and dash WhatsApp-style
 * headers, bare "Sender: text" lines, and plain text-only lines. A line that
 * isn't a recognizable header is appended to the previous message *only* when
 * that previous message came from a real header (a genuine wrapped/multi-line
 * body); otherwise each plain line becomes its own message - so a block of
 * bare lines like "Yes." / "That works." stays as separate messages.
 *
 * @param {string} raw
 * @returns {{index:number, rawText:string, rawTimestamp:string, sender:string, body:string}[]}
 */
export function parseMessages(raw) {
  const lines = String(raw == null ? '' : raw).split(/\r?\n/);
  const out = [];

  const startNew = (rawTimestamp, sender, body, line, structured) => {
    out.push({
      rawText: line,
      rawTimestamp,
      sender,
      body,
      _structured: structured,
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let m;
    if ((m = RE_BRACKET.exec(trimmed))) {
      startNew(m[1].trim(), m[2].trim(), m[3].trim(), trimmed, true);
    } else if ((m = RE_DASH.exec(trimmed))) {
      startNew(m[1].trim(), m[2].trim(), m[3].trim(), trimmed, true);
    } else if ((m = RE_SENDER.exec(trimmed)) && m[1].trim().split(/\s+/).length <= 4) {
      // <= 4 words in the "sender" guards against treating a normal sentence
      // that happens to contain a colon (e.g. "Reminder: ...") as a new sender.
      startNew('', m[1].trim(), m[2].trim(), trimmed, true);
    } else {
      const prev = out[out.length - 1];
      if (prev && prev._structured) {
        prev.body += '\n' + trimmed;
        prev.rawText += '\n' + trimmed;
      } else {
        startNew('', '', trimmed, trimmed, false);
      }
    }
  }

  return out.map((msg, index) => ({
    index,
    rawText: msg.rawText,
    rawTimestamp: msg.rawTimestamp,
    sender: msg.sender,
    body: msg.body,
  }));
}

/**
 * Build a context-aware chunk for one message, including its neighbours so that
 * short replies ("yes", "that works") carry enough meaning to embed usefully.
 */
export function buildChunk(messages, i) {
  const prev = messages[i - 1];
  const cur = messages[i];
  const next = messages[i + 1];
  return [
    `Previous message: ${prev ? prev.body : ''}`,
    `Current sender: ${cur.sender || ''}`,
    `Current timestamp: ${cur.rawTimestamp || ''}`,
    `Current message: ${cur.body || ''}`,
    `Next message: ${next ? next.body : ''}`,
  ].join('\n');
}

export function buildChunks(messages) {
  return messages.map((_, i) => buildChunk(messages, i));
}

/* -------------------------------------------------------------------------- */
/* Similarity & scoring                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Cosine similarity. With normalized embeddings a dot product is sufficient,
 * but we keep the full computation for clarity and so the function is correct
 * for un-normalized inputs too.
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function scoreLabel(score) {
  if (score >= STRONG_THRESHOLD) return 'strong';
  if (score >= POSSIBLE_THRESHOLD) return 'possible';
  return 'low';
}

/* -------------------------------------------------------------------------- */
/* Cautious language helpers (word lists)                                      */
/* -------------------------------------------------------------------------- */

const SHORT_AGREEMENT = [
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'k', 'sure', 'fine', 'agreed',
  'that works', 'i agree', 'no problem', 'sounds good', 'will do', 'cool',
];

const RE_MONEY = /\$\s?\d|\b(pay|paid|pays|paying|owe|owed|owes|repay|repaid|rent|refund|loan|venmo|cashapp|zelle|paypal|dollars?|deposit)\b/i;
const RE_REPAIR = /\b(repair|repaired|repairs|fix|fixed|fixing|broken|break|leak|leaking|landlord|maintenance|plumber|heater|furnace|mold|mould|appliance|sink|toilet|outage)\b/i;
// Broad threat set used only to test for *presence* in the gap analysis (per
// spec): bare "stop"/"hurt"/"scared" are too ambiguous to assert as a reason.
const RE_THREAT = /\b(threat|threats|threaten|threatened|threatening|hurt|kill|harm|scared|afraid|harass|harassment|stop|leave me alone|or else|regret|watch out)\b/i;
// Stricter set used for the per-message "may mention threat" reason label, to
// avoid alarming false positives on benign words like "stop by" or "bus stop".
const RE_THREAT_REASON = /\b(threat|threats|threaten|threatened|threatening|kill|harm|harass|harassment|leave me alone|or else|watch out)\b/i;
const RE_AGREEMENT = /\b(agree|agreed|promise|promised|deal|confirm|confirmed|i'?ll|i will|we will|will pay|pay you back|sounds good)\b/i;
// Note: am/pm only counts when attached to a number (e.g. "3pm", "11 a.m.") so
// the ordinary verb "am" in "I am here" is not mistaken for a time.
const RE_DATETIME = /\b\d{1,2}:\d{2}\b|\b\d{1,2}[/.\-]\d{1,2}\b|\b\d{1,2}\s?[ap]\.?m\.?\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|noon|midnight)\b/i;

const CLAIM_MONEY = /\b(pay|money|rent|owe|owed|refund|loan|repay|paid|owes)\b/i;
const CLAIM_THREAT = /\b(threat|threats|threaten|threatened|scared|hurt|harass|harassment|afraid)\b/i;
const CLAIM_REPAIR = /\b(repair|repaired|repairs|fix|fixed|broken|leak|landlord|maintenance|property)\b/i;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'that', 'this', 'they', 'them', 'their', 'was', 'were', 'are', 'is', 'be',
  'been', 'has', 'had', 'have', 'you', 'your', 'i', 'me', 'my', 'we', 'it',
  'at', 'as', 'by', 'from', 'about', 'show', 'shows', 'showed', 'messages',
  'message', 'other', 'person', 'made', 'make', 'after', 'before', 'when',
]);

function normalizeBody(body) {
  return String(body || '').trim().toLowerCase().replace(/[.!?,'"]+$/g, '').trim();
}

/** True if the body is essentially a short acknowledgement / agreement reply. */
export function isShortReply(body) {
  const norm = normalizeBody(body);
  if (!norm) return false;
  if (SHORT_AGREEMENT.includes(norm)) return true;
  // Very short bodies are also treated as short replies.
  return norm.replace(/[^a-z0-9]/g, '').length > 0 && norm.length < SHORT_BODY_CHARS && norm.split(/\s+/).length <= 3;
}

function claimKeywords(claim) {
  return Array.from(new Set(
    String(claim || '')
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  ));
}

/** Rule-based, deliberately hedged reason labels for why a message may relate. */
export function reasonLabels(message, claim, score) {
  const reasons = [];
  const body = message.body || '';
  const lower = body.toLowerCase();
  const keys = claimKeywords(claim);

  if (keys.some((k) => lower.includes(k))) reasons.push('Contains exact claim keyword');
  if (score >= POSSIBLE_THRESHOLD) reasons.push('Semantically similar to claim');
  if (RE_DATETIME.test(body)) reasons.push('Mentions date/time');
  if (RE_MONEY.test(body)) reasons.push('Mentions money/amount');
  if (RE_REPAIR.test(body)) reasons.push('Mentions repair/request');
  if (RE_THREAT_REASON.test(body)) reasons.push('Mentions threat/harassment language');
  if (RE_AGREEMENT.test(body)) reasons.push('Mentions agreement/promise');
  if (isShortReply(body)) reasons.push('Short reply, review surrounding context');

  return reasons;
}

/**
 * True when a message's meaning depends on its neighbours - a short reply or a
 * very short body. This (not missing metadata) is what routes a message into
 * the "Needs context" group, so a substantive, clearly-related message is never
 * demoted just because the paste lacked timestamps.
 */
export function isContextDependent(message, score) {
  const body = (message.body || '').trim();
  if (isShortReply(body)) return true;
  return body.length < SHORT_BODY_CHARS && score >= POSSIBLE_THRESHOLD;
}

/** Metadata flags shown as chips on a result card in any group. */
export function metadataFlags(message) {
  const flags = [];
  if (!message.sender) flags.push('Missing sender');
  if (!message.rawTimestamp) flags.push('Missing timestamp');
  return flags;
}

/** The "why" list shown for an item in the Needs context group. */
export function contextWhys(message, contextDependent) {
  const whys = [];
  if (contextDependent) {
    whys.push('Short reply');
    whys.push('Surrounding messages may be needed');
  }
  return whys.concat(metadataFlags(message));
}

/* -------------------------------------------------------------------------- */
/* Building the evidence map (pure: takes vectors, returns a structured map)   */
/* -------------------------------------------------------------------------- */

/**
 * Combine messages, their embeddings and the claim embedding into a grouped,
 * cautiously-labelled evidence map. No DOM, no model, no network - so it is
 * fully unit-testable with hand-made vectors.
 *
 * @param {object[]} messages   parsed messages
 * @param {number[]} claimVec   embedding of the claim
 * @param {number[][]} msgVecs  embedding per message (aligned by index)
 * @param {string} claim        the raw claim text
 */
export function buildEvidenceMap(messages, claimVec, msgVecs, claim) {
  const scored = messages.map((message, i) => {
    const score = cosineSimilarity(claimVec, msgVecs[i] || []);
    const label = scoreLabel(score);
    const contextDependent = isContextDependent(message, score);
    // Only route into "Needs context" when the message is both context-dependent
    // AND at least possibly related - an unrelated short reply belongs in low
    // match, and a substantive related message stays in its relevance group.
    const needsContext = contextDependent && score >= POSSIBLE_THRESHOLD;
    return {
      message,
      score,
      percent: Math.max(0, Math.round(score * 100)), // never show a negative %
      label,
      needsContext,
      contextReasons: contextWhys(message, contextDependent),
      flags: metadataFlags(message),
      reasons: reasonLabels(message, claim, score),
    };
  }).sort((a, b) => b.score - a.score);

  const groups = { strong: [], possible: [], low: [], needsContext: [] };
  for (const item of scored) {
    if (item.needsContext) groups.needsContext.push(item);
    else if (item.label === 'strong') groups.strong.push(item);
    else if (item.label === 'possible') groups.possible.push(item);
    else groups.low.push(item);
  }

  const counts = {
    total: messages.length,
    strong: groups.strong.length,
    possible: groups.possible.length,
    needsContext: groups.needsContext.length,
    low: groups.low.length,
  };

  const summary = buildSummary(scored, counts);
  const gaps = analyzeGaps(messages, scored, claim);

  return { scored, groups, counts, summary, gaps, checklist: HUMAN_REVIEW_CHECKLIST };
}

/** Deterministic, cautious one-paragraph summary. Never claims case strength. */
export function buildSummary(scored, counts) {
  const anyStrong = scored.some((s) => s.score >= STRONG_THRESHOLD);
  const topRelated = scored.filter((s) => s.score >= POSSIBLE_THRESHOLD);
  const shortInTop = topRelated.filter((s) => isShortReply(s.message.body)).length;
  const shortHeavy = topRelated.length >= 2 && shortInTop / topRelated.length > 0.4;

  if (counts.strong === 0 && counts.possible === 0 && counts.needsContext === 0) {
    return 'ExhibitKit did not find messages that clearly relate to your claim. '
      + 'Try rewriting the claim with more specific words, or review the conversation manually.';
  }

  let s = `ExhibitKit found ${counts.strong} message${counts.strong === 1 ? '' : 's'} `
    + `strongly related to your claim and ${counts.possible} possibly related `
    + `message${counts.possible === 1 ? '' : 's'}.`;
  if (counts.needsContext > 0) {
    s += ` ${counts.needsContext} related message${counts.needsContext === 1 ? '' : 's'} `
      + `may need surrounding context.`;
  }
  if (shortHeavy) {
    s += ' Several high-scoring messages are short replies, so they may need '
      + 'surrounding context before being used.';
  }
  if (!anyStrong) {
    s += ' No message reached the "strongly related" range - review the matches '
      + 'manually and consider rewriting the claim with more specific words.';
  }
  return s;
}

/** Rule-based "possible gaps to review" checklist. */
export function analyzeGaps(messages, scored, claim) {
  const gaps = [];
  const total = messages.length || 1;
  const missingSender = messages.filter((m) => !m.sender).length;
  const missingTime = messages.filter((m) => !m.rawTimestamp).length;

  if (missingSender / total > 0.3) {
    gaps.push('Some messages are missing sender names. You may need extra context showing who sent each message.');
  }
  if (missingTime / total > 0.3) {
    gaps.push('Some messages are missing timestamps. Date and time context may be important.');
  }

  const topRelated = scored.filter((s) => s.score >= POSSIBLE_THRESHOLD);
  const top = topRelated.length ? topRelated : scored.slice(0, 5);
  const shortInTop = top.filter((s) => isShortReply(s.message.body)).length;
  if (top.length >= 2 && shortInTop / top.length > 0.4) {
    gaps.push('Several related messages are short replies. Include surrounding messages so the meaning is clear.');
  }

  if (!scored.some((s) => s.score >= STRONG_THRESHOLD)) {
    gaps.push('The AI did not find a clear group of strongly related messages. Try rewriting the claim with more specific words or review the conversation manually.');
  }

  const topText = top.map((s) => s.message.body).join(' ');
  if (CLAIM_MONEY.test(claim) && !RE_MONEY.test(topText)) {
    gaps.push('The claim involves money, but the related messages may not clearly show an amount.');
  }
  if (CLAIM_THREAT.test(claim) && !RE_THREAT.test(topText)) {
    gaps.push('The claim involves threats or harassment, but the related messages may need more direct wording or surrounding context.');
  }
  if (CLAIM_REPAIR.test(claim) && !RE_REPAIR.test(topText)) {
    gaps.push('The claim involves repairs or property issues, but the related messages may need clearer details about the problem and response.');
  }

  return gaps;
}

export const HUMAN_REVIEW_CHECKLIST = [
  'Confirm the original export file is saved.',
  'Confirm the source file hash still matches.',
  'Confirm sender identity is clear.',
  'Include enough before/after messages for context.',
  'Do not rely only on the AI score.',
  'Review redactions to make sure they do not remove necessary context.',
  'Ask the court or an attorney about local evidence rules.',
];

/* -------------------------------------------------------------------------- */
/* Review memo (plain text, NOT part of the official exhibit PDF)              */
/* -------------------------------------------------------------------------- */

export const DISCLAIMER =
  'AI Review Lab is a private review helper. It does not provide legal advice and '
  + 'does not decide whether evidence is admissible, truthful, or legally sufficient. '
  + 'It only helps organize selected text by possible relevance. Always review the '
  + 'original messages yourself.';

/** Build the downloadable/copyable .txt review memo. */
export function buildMemo(result, claim) {
  const now = new Date();
  const line = '-'.repeat(64);
  const parts = [];

  parts.push('EXHIBITKIT - AI REVIEW LAB MEMO');
  parts.push(line);
  parts.push(DISCLAIMER);
  parts.push('');
  parts.push('NOTE: This AI review memo is NOT part of the official ExhibitKit');
  parts.push('evidence PDF. The official exhibit builder is deterministic and AI-free.');
  parts.push(line);
  parts.push(`Generated: ${now.toLocaleString()}`);
  parts.push(`Claim reviewed: ${claim || '(none entered)'}`);
  parts.push('');
  parts.push(`Strongly related: ${result.counts.strong}`);
  parts.push(`Possibly related: ${result.counts.possible}`);
  parts.push(`Needs context:    ${result.counts.needsContext}`);
  parts.push('');
  parts.push('REVIEW SUMMARY');
  parts.push(line);
  parts.push(result.summary);
  parts.push('');

  const top = result.scored.filter((s) => s.score >= POSSIBLE_THRESHOLD).slice(0, 25);
  parts.push('TOP RELATED MESSAGES (by possible relevance)');
  parts.push(line);
  if (!top.length) {
    parts.push('(none reached the "possibly related" range)');
  } else {
    top.forEach((s, i) => {
      const who = s.message.sender || 'Unknown sender';
      const when = s.message.rawTimestamp || 'No timestamp';
      parts.push(`${i + 1}. [${s.percent}% relevance] ${who} - ${when}`);
      parts.push(`   ${String(s.message.body).replace(/\n/g, '\n   ')}`);
      if (s.reasons.length) parts.push(`   (may relate because: ${s.reasons.join('; ')})`);
      parts.push('');
    });
  }

  parts.push('POSSIBLE GAPS TO REVIEW');
  parts.push(line);
  if (!result.gaps.length) parts.push('(no automated gaps flagged - still review manually)');
  else result.gaps.forEach((g) => parts.push(`- ${g}`));
  parts.push('');

  parts.push('HUMAN REVIEW CHECKLIST');
  parts.push(line);
  result.checklist.forEach((c) => parts.push(`[ ] ${c}`));
  parts.push('');
  parts.push(line);
  parts.push('ExhibitKit formats records and computes integrity hashes. It is not a');
  parts.push('law firm and does not provide legal advice. AI Review Lab is for');
  parts.push('organization and review only.');

  return parts.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Model loading & embedding (the only network-touching code here)            */
/* -------------------------------------------------------------------------- */

/** Sentinel thrown when the user cancels analysis. */
export class CancelledError extends Error {
  constructor() {
    super('AI review cancelled.');
    this.name = 'CancelledError';
  }
}

/**
 * Load the local embedding pipeline. Dynamic import keeps Transformers.js out
 * of the initial page cost until the user actually clicks Generate.
 *
 * @param {(p:object)=>void} [onProgress] receives Transformers.js progress events
 */
export async function loadEmbedder(onProgress) {
  const { pipeline, env } = await import(/* @vite-ignore */ TRANSFORMERS_URL);

  // Never probe our own origin for a local model copy (it doesn't exist, and
  // connect-src 'self' is intentionally absent on this page). Go straight to
  // the model host. Public model files may be cached in the browser Cache API;
  // that is model weights, never user message text.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  // Single-threaded WASM is required: this site has no COOP/COEP headers so
  // SharedArrayBuffer is unavailable, and multi-threaded ONNX would fail.
  // Forcibly initialise the wasm config object if Transformers.js v3 hasn't
  // created it yet (it may be lazy-initialised after the first pipeline call).
  if (env.backends?.onnx) {
    if (!env.backends.onnx.wasm) env.backends.onnx.wasm = {};
    env.backends.onnx.wasm.numThreads = 1;
  }

  return pipeline('feature-extraction', MODEL_ID, { progress_callback: onProgress });
}

/**
 * Embed an array of texts in small batches, yielding to the UI between batches
 * and honouring a cancel flag so long conversations never freeze the page.
 *
 * @returns {Promise<number[][]>} one embedding per input text
 */
export async function embedTexts(pipe, texts, { batchSize = 16, onProgress, shouldCancel } = {}) {
  const vecs = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    if (shouldCancel && shouldCancel()) throw new CancelledError();
    const batch = texts.slice(i, i + batchSize);
    const out = await pipe(batch, { pooling: 'mean', normalize: true });
    const rows = out.tolist();
    for (const row of rows) vecs.push(row);
    if (onProgress) onProgress(Math.min(i + batchSize, texts.length), texts.length);
    // Yield to the event loop so the UI (and the cancel button) stays live.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return vecs;
}

/** Embed a single text (e.g. the claim) and return a plain number[]. */
export async function embedOne(pipe, text) {
  const out = await pipe([text], { pooling: 'mean', normalize: true });
  return out.tolist()[0];
}
