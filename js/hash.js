/**
 * hash.js — SHA-256 hashing of original file bytes via the Web Crypto API.
 *
 * The hash is always computed over the ORIGINAL uploaded bytes, never over
 * parsed or selected messages. This is the forensic anchor of every exhibit.
 */

/** True when crypto.subtle is available (requires HTTPS or localhost). */
export function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

/**
 * SHA-256 of an ArrayBuffer, as lowercase hex.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} 64-char lowercase hex digest
 */
export async function sha256Hex(buffer) {
  if (!cryptoAvailable()) {
    throw new Error('crypto.subtle is unavailable. This page must be served over HTTPS (or localhost).');
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Hash a File object (reads it fully into memory; nothing is persisted).
 * @param {File} file
 * @returns {Promise<{hashHex: string, sizeBytes: number, hashedAt: Date}>}
 */
export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashHex = await sha256Hex(buffer);
  return { hashHex, sizeBytes: buffer.byteLength, hashedAt: new Date() };
}

/** Format a byte count with thousands separators, e.g. "48,213 bytes". */
export function formatBytes(n) {
  return `${Number(n).toLocaleString('en-US')} bytes`;
}

/** First 16 hex chars of a hash plus an ellipsis, for page footers. */
export function truncatedHash(hashHex) {
  return `${hashHex.slice(0, 16)}…`;
}
