/**
 * declaration.js — assembles the Declaration / certification page text from
 * the case-details form. Plain, jurisdiction-neutral template.
 *
 * The output is data only (title + numbered paragraphs + footer); pdf.js
 * handles layout. Missing optional values become blanks ("________") the
 * declarant can fill in by hand.
 */

const BLANK = '________';

/**
 * @param {{
 *   caseInfo: object,            // §8 form values
 *   messageCount: number,        // messages included in the exhibit
 *   precedingPages: number|null, // pages before the declaration; null = blank
 *   sources: Array<{name: string, sizeBytes: number, hashHex: string}>,
 *   redactedCount: number,       // messages containing at least one redaction
 *   exportDate: Date|null        // source file lastModified, if known
 * }} input
 * @returns {{title: string, intro: string, paragraphs: string[],
 *            execution: string[], signature: string[], footnote: string}}
 */
export function buildDeclaration(input) {
  const { caseInfo = {}, messageCount, precedingPages, sources = [],
    redactedCount = 0, exportDate = null } = input;

  const name = clean(caseInfo.declarantName) || BLANK;
  const role = clean(caseInfo.declarantRole) || BLANK;
  const accountDesc = clean(caseInfo.accountDesc) || BLANK;
  const exportMethod = clean(caseInfo.exportMethod) || BLANK;
  const pagesText = precedingPages != null ? String(precedingPages) : BLANK;
  const dateText = exportDate ? formatLongDate(exportDate) : BLANK;

  const paragraphs = [];

  paragraphs.push(`I am the ${role} in the above-captioned matter.`);

  paragraphs.push(
    `The preceding ${pagesText} pages contain true and accurate copies of ` +
    `${messageCount} text message${messageCount === 1 ? '' : 's'} exported from ${accountDesc}.`
  );

  if (sources.length <= 1) {
    const s = sources[0] || { name: BLANK, sizeBytes: null };
    const size = s.sizeBytes != null ? s.sizeBytes.toLocaleString('en-US') : BLANK;
    paragraphs.push(
      `The messages were exported using ${exportMethod} on or about ${dateText}, ` +
      `producing the file "${s.name}" (${size} bytes).`
    );
  } else {
    const fileList = sources
      .map((s) => `"${s.name}" (${s.sizeBytes.toLocaleString('en-US')} bytes)`)
      .join('; ');
    paragraphs.push(
      `The messages were exported using ${exportMethod} on or about ${dateText}, ` +
      `producing the following files: ${fileList}.`
    );
  }

  if (sources.length <= 1) {
    const hash = sources[0] ? sources[0].hashHex : BLANK;
    paragraphs.push(
      `The SHA-256 cryptographic hash of that file is: ${hash}. This hash was ` +
      `computed at the time of exhibit preparation and can be used to verify ` +
      `that the source file has not been altered since.`
    );
  } else {
    const hashList = sources.map((s) => `"${s.name}": ${s.hashHex}`).join('; ');
    paragraphs.push(
      `The SHA-256 cryptographic hashes of those files are: ${hashList}. These ` +
      `hashes were computed at the time of exhibit preparation and can be used ` +
      `to verify that the source files have not been altered since.`
    );
  }

  if (redactedCount > 0) {
    paragraphs.push(
      `Portions of ${redactedCount} message${redactedCount === 1 ? '' : 's'} have been ` +
      `redacted and are marked "[REDACTED]". No other alterations were made to ` +
      `message content.`
    );
  }

  paragraphs.push('I declare under penalty of perjury that the foregoing is true and correct.');

  return {
    title: 'DECLARATION REGARDING TEXT MESSAGE RECORDS',
    intro: `I, ${name}, declare as follows:`,
    paragraphs,
    execution: ['Executed on ____________________ at ____________________.'],
    signature: [
      'Signature: ______________________________',
      `Printed name: ${name === BLANK ? '______________________________' : name}`,
    ],
    footnote:
      'This template is provided for convenience and is not legal advice. ' +
      'Evidentiary and declaration requirements vary by court and jurisdiction. ' +
      "Consult the court's rules or an attorney.",
  };
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function formatLongDate(d) {
  return `${LONG_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
