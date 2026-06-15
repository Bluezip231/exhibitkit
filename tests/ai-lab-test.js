/**
 * ai-lab-test.js - tests for the AI Evidence Mapper.
 *
 * Pure-logic tests run on load with no network. The semantic fixtures
 * (money / repair / short replies / missing timestamp) load the real local
 * model on demand behind a button.
 */

import {
  parseMessages,
  buildChunks,
  cosineSimilarity,
  scoreLabel,
  isShortReply,
  reasonLabels,
  buildEvidenceMap,
  buildMemo,
  loadEmbedder,
  embedOne,
  embedTexts,
} from '../js/ai/evidence-map.js';

/* --------------------------- tiny test harness --------------------------- */

const results = document.getElementById('results');
const summaryEl = document.getElementById('summary');
let pass = 0;
let fail = 0;

function record(name, ok, detail) {
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = ok ? name : `${name} - ${detail || 'failed'}`;
  results.appendChild(li);
  if (ok) pass++; else fail++;
}

function check(name, cond, detail) {
  record(name, !!cond, detail);
}

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(name, ok, ok ? '' : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

/* ------------------------------- parser ---------------------------------- */

(function parserTests() {
  const bracket = parseMessages('[6/12/26, 3:45 PM] Isaiah: Message text');
  eq('parser: bracketed sender', bracket[0].sender, 'Isaiah');
  eq('parser: bracketed timestamp', bracket[0].rawTimestamp, '6/12/26, 3:45 PM');
  eq('parser: bracketed body', bracket[0].body, 'Message text');

  const dashAmPm = parseMessages('6/12/26, 3:45 PM - Isaiah: Hello there');
  eq('parser: dash AM/PM sender', dashAmPm[0].sender, 'Isaiah');
  eq('parser: dash AM/PM body', dashAmPm[0].body, 'Hello there');

  const dash24 = parseMessages('6/12/26, 15:45 - Isaiah: Hello there');
  eq('parser: dash 24h timestamp', dash24[0].rawTimestamp, '6/12/26, 15:45');

  const senderOnly = parseMessages('Isaiah: Just a sender line');
  eq('parser: sender-only sender', senderOnly[0].sender, 'Isaiah');
  eq('parser: sender-only no timestamp', senderOnly[0].rawTimestamp, '');

  const plain = parseMessages('Can we do 5 PM?\nYes.\nThat works.');
  eq('parser: plain lines stay separate', plain.length, 3);
  eq('parser: plain line body', plain[1].body, 'Yes.');
  eq('parser: plain line empty sender', plain[1].sender, '');

  const multiline = parseMessages('[6/12/26, 3:45 PM] Isaiah: Line one\nLine two continues');
  eq('parser: multi-line continuation merges', multiline.length, 1);
  eq('parser: multi-line body joined', multiline[0].body, 'Line one\nLine two continues');

  const leadingPlain = parseMessages('orphan line\n[6/12/26, 3:45 PM] Isaiah: header');
  eq('parser: leading plain becomes its own message', leadingPlain.length, 2);
  eq('parser: leading plain empty sender', leadingPlain[0].sender, '');

  const url = parseMessages('Check https://example.com now');
  eq('parser: URL not split as sender', url[0].sender, '');

  // Generic note/label prefixes must NOT become fake senders.
  const reminder = parseMessages('Reminder: bring the receipt');
  eq('parser: "Reminder:" stays body text', reminder[0].body, 'Reminder: bring the receipt');
  eq('parser: "Reminder:" no fake sender', reminder[0].sender, '');

  const note = parseMessages('Note: I paid Friday');
  eq('parser: "Note:" stays body text', note[0].body, 'Note: I paid Friday');
  eq('parser: "Note:" no fake sender', note[0].sender, '');

  const updateLine = parseMessages('Update: landlord called');
  eq('parser: "Update:" no fake sender', updateLine[0].sender, '');

  // P2 regression: a note-prefix line following a real sender must start a NEW
  // senderless message, never get appended to the previous structured message.
  const p2 = parseMessages('Alice: first\nReminder: bring the receipt');
  eq('parser P2: note-prefix after sender produces 2 messages', p2.length, 2);
  eq('parser P2: second message sender is empty', p2[1].sender, '');
  eq('parser P2: second message body is the full line', p2[1].body, 'Reminder: bring the receipt');

  // Real sender names must still parse as senders.
  const realSender = parseMessages('Isaiah: I paid Friday');
  eq('parser: real sender "Isaiah"', realSender[0].sender, 'Isaiah');
  eq('parser: real sender body', realSender[0].body, 'I paid Friday');

  const natalie = parseMessages('Natalie: That works');
  eq('parser: real sender "Natalie"', natalie[0].sender, 'Natalie');

  const mom = parseMessages('Mom: Call me later');
  eq('parser: real sender "Mom"', mom[0].sender, 'Mom');

  eq('parser: empty input', parseMessages(''), []);
})();

/* ------------------------------- chunking -------------------------------- */

(function chunkTests() {
  const msgs = parseMessages('A: first\nB: second\nA: third');
  const chunks = buildChunks(msgs);
  check('chunk: includes current message', chunks[1].includes('Current message: second'));
  check('chunk: includes previous', chunks[1].includes('Previous message: first'));
  check('chunk: includes next', chunks[1].includes('Next message: third'));
  check('chunk: first has empty previous', chunks[0].includes('Previous message: \n') || chunks[0].includes('Previous message: '));
})();

/* --------------------------- cosine similarity --------------------------- */

(function cosineTests() {
  check('cosine: identical = 1', Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
  check('cosine: orthogonal = 0', Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  check('cosine: opposite = -1', Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
  check('cosine: zero vector = 0', cosineSimilarity([0, 0], [1, 1]) === 0);
})();

/* ----------------------------- score labels ------------------------------ */

(function labelTests() {
  eq('label: 0.6 strong', scoreLabel(0.6), 'strong');
  eq('label: 0.45 possible', scoreLabel(0.45), 'possible');
  eq('label: 0.2 low', scoreLabel(0.2), 'low');
})();

/* ----------------------------- short replies ----------------------------- */

(function shortReplyTests() {
  check('short: "Yes."', isShortReply('Yes.'));
  check('short: "that works"', isShortReply('that works'));
  check('short: "I agree"', isShortReply('I agree'));
  check('short: long sentence is not short', !isShortReply('I will pay you back this coming Friday for sure'));
})();

/* ----------------------------- reason labels ----------------------------- */

(function reasonTests() {
  const money = reasonLabels({ body: "I'll pay you back Friday" }, 'they agreed to pay me back', 0.6);
  check('reason: money detected', money.includes('Mentions money/amount'));
  check('reason: agreement detected', money.includes('Mentions agreement/promise'));

  const repair = reasonLabels({ body: 'The sink is leaking again' }, 'landlord ignored repairs', 0.6);
  check('reason: repair detected', repair.includes('Mentions repair/request'));

  const threat = reasonLabels({ body: 'stop or you will regret it' }, 'threats were made', 0.6);
  check('reason: threat "will regret" detected', threat.includes('Mentions threat/harassment language'));

  const regretThreat2 = reasonLabels({ body: "you'll regret this" }, 'threats were made', 0.6);
  check('reason: threat "you\'ll regret" detected', regretThreat2.includes('Mentions threat/harassment language'));

  const regretThreat3 = reasonLabels({ body: "I'll make you regret it" }, 'threats were made', 0.6);
  check('reason: threat "make you regret" detected', regretThreat3.includes('Mentions threat/harassment language'));

  const bareRegret = reasonLabels({ body: 'I regret missing the meeting' }, 'unrelated claim', 0.3);
  check('reason: bare "I regret" does NOT trigger threat label', !bareRegret.includes('Mentions threat/harassment language'));
})();

/* -------------------- buildEvidenceMap with fake vectors ----------------- */

(function evidenceMapTests() {
  // Three substantive messages with senders + timestamps so they are not
  // routed to "needs context", and hand-made vectors with known similarity.
  const messages = parseMessages([
    '1/1/26 12:00 - A: This is a clearly relevant statement about the matter',
    '1/1/26 12:01 - B: This is a partially relevant statement about something',
    '1/1/26 12:02 - A: This is an unrelated statement about the weather today',
  ].join('\n'));
  const claimVec = [1, 0];
  const msgVecs = [[1, 0], [0.5, Math.sqrt(1 - 0.25)], [0, 1]]; // sims: 1.0, 0.5, 0.0
  const result = buildEvidenceMap(messages, claimVec, msgVecs, 'a relevant claim');

  eq('map: one strongly related', result.counts.strong, 1);
  eq('map: one possibly related', result.counts.possible, 1);
  eq('map: one low match', result.counts.low, 1);
  check('map: summary mentions strongly related', result.summary.includes('strongly related'));
  check('map: checklist always present', result.checklist.length === 7);
  check('map: scored sorted desc', result.scored[0].score >= result.scored[1].score);

  // A substantive, strongly-related message that merely lacks a timestamp must
  // STAY in "strong" (not get demoted to Needs context) but still flag the gap.
  const noTs = parseMessages('Alex: I will absolutely pay you back the full five hundred dollars on Friday');
  const noTsResult = buildEvidenceMap(noTs, [1, 0], [[1, 0]], 'they agreed to pay me back');
  eq('map: substantive match missing timestamp stays strong', noTsResult.counts.strong, 1);
  eq('map: substantive match not in needs-context', noTsResult.counts.needsContext, 0);
  check('map: missing-timestamp flag present on the item',
    noTsResult.scored[0].flags.includes('Missing timestamp'));

  // Negative similarity must never render as a negative percentage.
  const neg = buildEvidenceMap(parseMessages('A: x'), [1, 0], [[-1, 0]], 'claim');
  check('map: percent clamped to >= 0', neg.scored[0].percent >= 0);
})();

/* ------------------------------- gap rules ------------------------------- */

(function gapTests() {
  // All-plain paste => missing senders + timestamps; orthogonal vectors => no strong group.
  const messages = parseMessages('first plain line here\nsecond plain line here\nthird plain line here');
  const claimVec = [1, 0];
  const msgVecs = [[0, 1], [0, 1], [0, 1]];
  const result = buildEvidenceMap(messages, claimVec, msgVecs, 'unrelated claim');

  check('gaps: flags missing senders', result.gaps.some((g) => g.includes('missing sender names')));
  check('gaps: flags missing timestamps', result.gaps.some((g) => g.includes('missing timestamps')));
  check('gaps: flags no strong group', result.gaps.some((g) => g.includes('did not find a clear group')));

  // Helper: does the money-amount gap fire for `body` against a money claim?
  const moneyGapFires = (body) => buildEvidenceMap(
    parseMessages(`1/1/26 12:00 - A: ${body}`), [1, 0], [[1, 0]], 'they agreed to pay me back the rent',
  ).gaps.some((g) => g.includes('claim involves money'));

  // BAD: no amount evidence — gap must fire.
  check('gaps: no money at all triggers gap', moneyGapFires('we talked about the schedule for next week'));
  check('gaps: "pay you back Friday" (no figure) triggers gap', moneyGapFires("I'll pay you back Friday"));
  check('gaps: "pay at 5 Friday" (time, not amount) triggers gap', moneyGapFires("I'll pay you at 5 Friday"));
  check('gaps: "pay on 6/12" (date, not amount) triggers gap', moneyGapFires("I'll pay on 6/12"));
  check('gaps: "What is the balance?" (no figure) triggers gap', moneyGapFires('What is the balance?'));
  check('gaps: "What is the total amount?" (no figure) triggers gap', moneyGapFires('What is the total amount?'));
  check('gaps: "I can meet at 7" triggers gap', moneyGapFires('I can meet at 7'));

  // GOOD: actual amount evidence — gap must be suppressed.
  check('gaps: "$500" suppresses gap', !moneyGapFires('I owe $500'));
  check('gaps: "500 dollars" suppresses gap', !moneyGapFires('I owe 500 dollars'));
  check('gaps: "500 bucks" suppresses gap', !moneyGapFires('500 bucks'));
  check('gaps: "balance is 500" suppresses gap', !moneyGapFires('The balance is 500'));
  check('gaps: "total is 500" suppresses gap', !moneyGapFires('total is 500'));
  check('gaps: "amount is 500" suppresses gap', !moneyGapFires('amount is 500'));
  check('gaps: "deposit of 300" suppresses gap', !moneyGapFires('deposit of 300'));
  check('gaps: "rent is 1200" suppresses gap', !moneyGapFires('rent is 1200'));
  check('gaps: "loan balance 450" suppresses gap', !moneyGapFires('loan balance 450'));
  check('gaps: "half the rent" suppresses gap', !moneyGapFires("I'll pay half the rent Friday"));
  check('gaps: "full deposit" suppresses gap', !moneyGapFires('full deposit'));
  check('gaps: "all of the loan" suppresses gap', !moneyGapFires('all of the loan'));
})();

/* -------------- low-match non-truncation (data model) -------------------- */

(function lowMatchTests() {
  // 30 messages all with orthogonal (zero similarity) vectors — all land in low.
  const lines = Array.from({ length: 30 }, (_, i) => `1/1/26 12:${String(i).padStart(2, '0')} - A: message number ${i}`);
  const messages = parseMessages(lines.join('\n'));
  const claimVec = [1, 0];
  const msgVecs = messages.map(() => [0, 1]); // all orthogonal to claim
  const result = buildEvidenceMap(messages, claimVec, msgVecs, 'unrelated claim');
  eq('low-match: all 30 messages appear in low group (no truncation)', result.groups.low.length, 30);
})();

/* -------------------------------- memo ----------------------------------- */

(function memoTests() {
  const messages = parseMessages('1/1/26 12:00 - A: relevant content about the dispute');
  const result = buildEvidenceMap(messages, [1, 0], [[1, 0]], 'my test claim');
  const memo = buildMemo(result, 'my test claim');
  check('memo: includes disclaimer', memo.includes('AI Review Lab is a private review helper'));
  check('memo: includes the claim', memo.includes('my test claim'));
  check('memo: states not part of official PDF', memo.includes('NOT part of the official ExhibitKit'));
  check('memo: includes human review checklist', memo.includes('HUMAN REVIEW CHECKLIST'));
  check('memo: includes counts', memo.includes('Strongly related:'));
})();

/* ------------------------------ summarise -------------------------------- */

summaryEl.textContent = `${pass} passed, ${fail} failed (pure-logic tests).`;
summaryEl.style.color = fail ? 'var(--seal)' : 'var(--verify-green)';

/* --------------------- model-based semantic fixtures --------------------- */

const modelBtn = document.getElementById('model-btn');
const modelStatus = document.getElementById('model-status');
const modelResults = document.getElementById('model-results');

function modelRecord(name, ok, detail) {
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = ok ? name : `${name} - ${detail || 'failed'}`;
  modelResults.appendChild(li);
}

async function mapFor(pipe, claim, lines) {
  const messages = parseMessages(lines.join('\n'));
  const chunks = buildChunks(messages);
  const claimVec = await embedOne(pipe, claim);
  const msgVecs = await embedTexts(pipe, chunks, {});
  return { messages, result: buildEvidenceMap(messages, claimVec, msgVecs, claim) };
}

function relatedBodies(result) {
  // strong + possible + needs-context, i.e. anything not "low match".
  return [...result.groups.strong, ...result.groups.possible, ...result.groups.needsContext]
    .map((s) => s.message.body);
}

async function runModelTests() {
  modelBtn.disabled = true;
  modelResults.replaceChildren();
  try {
    modelStatus.textContent = 'Loading local model (first run downloads it)…';
    const pipe = await loadEmbedder((p) => {
      if (p && p.status === 'progress' && typeof p.progress === 'number') {
        modelStatus.textContent = `Downloading model: ${Math.round(p.progress)}%`;
      }
    });

    modelStatus.textContent = 'Running money fixture…';
    const money = await mapFor(pipe, 'They agreed to pay me back.', [
      "I'll pay you back Friday.",
      'Can I send half now?',
      'I still owe you.',
      'The weather is nice today.',
    ]);
    const moneyRelated = relatedBodies(money.result);
    modelRecord('money: "I\'ll pay you back Friday." is related',
      moneyRelated.includes("I'll pay you back Friday."));
    modelRecord('money: "I still owe you." is related',
      moneyRelated.includes('I still owe you.'));

    modelStatus.textContent = 'Running repair fixture…';
    const repair = await mapFor(pipe, 'The landlord ignored repair requests.', [
      'The sink is leaking again.',
      'Any update on fixing the leak?',
      'I told you about this last week.',
      'Happy birthday!',
    ]);
    const repairRelated = relatedBodies(repair.result);
    modelRecord('repair: leak message is related',
      repairRelated.includes('The sink is leaking again.'));
    modelRecord('repair: "Any update on fixing the leak?" is related',
      repairRelated.includes('Any update on fixing the leak?'));

    modelStatus.textContent = 'Running short-reply fixture…';
    const pickup = await mapFor(pipe, 'They agreed to the pickup time.', [
      'Can we do 5 PM?',
      'Yes.',
      'That works.',
    ]);
    const needsContext = pickup.result.groups.needsContext.map((s) => s.message.body);
    modelRecord('short reply: "Yes." in Needs context', needsContext.includes('Yes.'));
    modelRecord('short reply: "That works." in Needs context', needsContext.includes('That works.'));

    modelStatus.textContent = 'Running missing-timestamp fixture…';
    const noTime = await mapFor(pipe, 'They agreed to meet.', [
      'Lets meet tomorrow',
      'Sounds good to me',
    ]);
    modelRecord('missing timestamp: gaps mention timestamps',
      noTime.result.gaps.some((g) => g.includes('missing timestamps')));

    modelStatus.textContent = 'Model-based fixtures complete.';
  } catch (err) {
    console.error(err);
    modelStatus.textContent = 'Model could not load in this browser (network or CSP). Pure-logic tests above are unaffected.';
  } finally {
    modelBtn.disabled = false;
  }
}

modelBtn.addEventListener('click', runModelTests);
