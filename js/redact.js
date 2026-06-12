/**
 * redact.js — pure text redaction helpers (kept DOM-free so they are
 * directly testable).
 *
 * Redaction is true removal: the phrase is spliced out of the string the
 * PDF is generated from. There is no overlay and no recoverable layer.
 */

/**
 * Replace every occurrence of `phrase` in `body` with [REDACTED].
 * Case-sensitive, exact match.
 * @returns {{body: string, count: number}}
 */
export function redactPhrase(body, phrase) {
  if (!phrase) return { body, count: 0 };
  const parts = String(body).split(phrase);
  return { body: parts.join('[REDACTED]'), count: parts.length - 1 };
}

/**
 * Replace the character range [start, start+length) with [REDACTED].
 * @returns {{body: string, count: number}}
 */
export function redactRange(body, start, length) {
  const s = String(body);
  if (length <= 0 || start < 0 || start >= s.length) return { body: s, count: 0 };
  return {
    body: s.slice(0, start) + '[REDACTED]' + s.slice(start + length),
    count: 1,
  };
}
