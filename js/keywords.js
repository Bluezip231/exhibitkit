/**
 * keywords.js - shared, deterministic keyword/category logic.
 *
 * Single source of truth for the tuned categorization regexes used by BOTH the
 * optional AI Review Lab (js/ai/evidence-map.js) and the builder's deterministic
 * Evidence Map (js/evidence-map-lite.js).
 *
 * This module is intentionally tiny and dependency-free: pure constants and pure
 * functions, no DOM, no network, and - critically - NO AI/model import. The
 * builder page (app.html) imports it through evidence-map-lite.js and its CSP
 * forbids the Transformers runtime, so nothing here may ever pull that bundle.
 */

/* -------------------------------------------------------------------------- */
/* Topic regexes (moved here verbatim from ai/evidence-map.js - the comments  */
/* explain the false-positive tuning and are load-bearing).                   */
/* -------------------------------------------------------------------------- */

export const RE_MONEY = /\$\s?\d|\b(pay|paid|pays|paying|owe|owed|owes|repay|repaid|rent|refund|loan|venmo|cashapp|zelle|paypal|dollars?|deposit)\b/i;
// Narrower than RE_MONEY: requires evidence of an *actual amount*, not just a
// money topic. Used in analyzeGaps() so vague money messages ("I'll pay you
// back Friday", "rent due on 6/12", "payment at 5 Friday") still trigger the
// "may not clearly show an amount" warning, while messages with an explicit
// figure do not.
// Alternatives (in order):
//   \$\s?\d                          — currency prefix ($500, $1,200)
//   \d...\s*(?:dollars?|bucks?)      — number + unit (500 dollars, 50 bucks)
//   money-noun + connector + digit   — balance/total/amount/deposit/rent/
//                                      loan/payment/refund followed immediately
//                                      by is/was/=/:/of and a digit; the strict
//                                      connector prevents "rent due on 6/12"
//                                      or "payment at 5" from matching
//   fraction phrase                  — half/full/all the rent|deposit|loan|...
export const RE_AMOUNT = /\$\s?\d|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:dollars?|bucks?)|\b(?:balance|total|amount|deposit|rent|loan|payment|refund)\s*(?:is|was|=|:|of)\s*\d|(?:half|full|all)\s+(?:of\s+)?(?:the\s+)?(?:rent|deposit|loan|amount|balance|total|payment)\b/i;
export const RE_REPAIR = /\b(repair|repaired|repairs|fix|fixed|fixing|broken|break|leak|leaking|landlord|maintenance|plumber|heater|furnace|mold|mould|appliance|sink|toilet|outage)\b/i;
// Broad threat set used only to test for *presence* in the gap analysis (per
// spec): bare "stop"/"hurt"/"scared" are too ambiguous to assert as a reason.
export const RE_THREAT = /\b(threat|threats|threaten|threatened|threatening|hurt|kill|harm|scared|afraid|harass|harassment|stop|leave me alone|or else|regret|watch out)\b/i;
// Stricter set used for the per-message "may mention threat" reason label, to
// avoid alarming false positives on benign words like "stop by" or "bus stop".
// "regret" matches only when used as a threat ("will regret", "you'll regret",
// "make you regret") — bare "I regret" / "I regret that" does not match.
export const RE_THREAT_REASON = /\b(threat|threats|threaten|threatened|threatening|kill|harm|harass|harassment|leave me alone|or else|watch out)\b|(?:will|gonna)\s+regret\b|you'?ll\s+regret\b|(?:make|made)\s+\w+\s+regret\b/i;
export const RE_AGREEMENT = /\b(agree|agreed|promise|promised|deal|confirm|confirmed|i'?ll|i will|we will|will pay|pay you back|sounds good)\b/i;
// Note: am/pm only counts when attached to a number (e.g. "3pm", "11 a.m.") so
// the ordinary verb "am" in "I am here" is not mistaken for a time.
export const RE_DATETIME = /\b\d{1,2}:\d{2}\b|\b\d{1,2}[/.\-]\d{1,2}\b|\b\d{1,2}\s?[ap]\.?m\.?\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|noon|midnight)\b/i;

// Custody / co-parenting topics. New for the builder Evidence Map. "support" is
// deliberately scoped to "child support"/"support payment" so the ordinary verb
// ("I support that") does not match; "school"/"pickup"/"drop-off" are common in
// parenting-schedule disputes.
export const RE_CUSTODY = /\b(custody|visitation|parenting|co-?parent(?:ing)?|child(?:ren)?|kids?|daughter|son|pick-?up|drop-?off|day-?care|school|child support|support payment)\b|\bdrop (?:her|him|them|the kids?|our)\b/i;

/* -------------------------------------------------------------------------- */
/* Attachment / media detection                                                */
/* -------------------------------------------------------------------------- */

// Markers the parsers leave inline in a message body for non-text content:
//   WhatsApp  : "<Media omitted>", language "image/video/audio/… omitted",
//               iOS "<attached: filename>"
//   SMS XML   : "[Attachment: <mime>]", "[MMS message]"
//   Meta JSON : "[Photo attachment]", "[Video attachment]", "[Audio attachment]",
//               "[GIF attachment]", "[File attachment]", "[Sticker]",
//               "[Shared link: …]", "[Shared content]"
const ATTACHMENT_MARKERS = [
  /<\s*media omitted\s*>/i,
  /\b(?:image|video|audio|sticker|gif|document|contact card) omitted\b/i,
  /<attached:/i,
  /\[attachment:/i,
  /\[mms message\]/i,
  /\[(?:photo|video|audio|gif|file) attachment\]/i,
  /\[sticker\]/i,
  /\[shared (?:link|content)/i,
];

/** True if a message body contains a non-text attachment/media marker. */
export function hasAttachment(body) {
  const s = String(body || '');
  return ATTACHMENT_MARKERS.some((re) => re.test(s));
}

/* -------------------------------------------------------------------------- */
/* Category catalog                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Ordered list of deterministic categories. Each `test(body)` is a pure keyword
 * match - NOT a legal conclusion - and a single message may match several. The
 * builder renders these as filter chips and small timeline badges; consumers
 * should always show a "keyword match, may include false positives" disclaimer.
 *
 * "People involved" and the timeline are derived separately (from senders and
 * timestamps), not from body text, so they are not in this catalog.
 */
export const CATEGORIES = [
  { id: 'money', label: 'Money / payments', test: (b) => RE_MONEY.test(b) || RE_AMOUNT.test(b) },
  { id: 'threats', label: 'Threats / harassment', test: (b) => RE_THREAT_REASON.test(b) },
  { id: 'agreements', label: 'Agreements', test: (b) => RE_AGREEMENT.test(b) },
  { id: 'custody', label: 'Custody / parenting', test: (b) => RE_CUSTODY.test(b) },
  { id: 'datetime', label: 'Dates / events', test: (b) => RE_DATETIME.test(b) },
  { id: 'attachments', label: 'Photos / attachments', test: (b) => hasAttachment(b) },
];
