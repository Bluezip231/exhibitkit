/**
 * verify.js — standalone hash verification page.
 *
 * Anyone (a clerk, opposing counsel) can drop a file, see its SHA-256
 * computed locally, paste an expected hash, and get MATCH / NO MATCH.
 * Comparison is case-insensitive and ignores whitespace.
 */

import { sha256Hex, cryptoAvailable, formatBytes } from './hash.js';

const $ = (id) => document.getElementById(id);

let computedHash = null;

function init() {
  if (!cryptoAvailable()) {
    $('crypto-error').hidden = false;
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
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files.length) handleFile(input.files[0]);
    input.value = '';
  });

  $('expected-hash').addEventListener('input', compare);
  $('copy-hash').addEventListener('click', async () => {
    if (!computedHash) return;
    try {
      await navigator.clipboard.writeText(computedHash);
      $('copy-hash').textContent = 'Copied';
      setTimeout(() => { $('copy-hash').textContent = 'Copy'; }, 1500);
    } catch {
      window.prompt('Copy the hash below:', computedHash);
    }
  });
}

async function handleFile(file) {
  $('hash-result').hidden = true;
  $('hash-working').hidden = false;
  try {
    const buffer = await file.arrayBuffer();
    computedHash = await sha256Hex(buffer);
    $('file-meta').textContent = `${file.name} — ${formatBytes(buffer.byteLength)}`;
    $('computed-hash').textContent = computedHash;
    $('hash-result').hidden = false;
  } catch (err) {
    $('file-meta').textContent = `Could not read the file: ${err.message}`;
    $('hash-result').hidden = false;
    $('computed-hash').textContent = '';
    computedHash = null;
  } finally {
    $('hash-working').hidden = true;
  }
  compare();
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '');
}

function compare() {
  const expected = normalize($('expected-hash').value);
  const result = $('verify-result');

  if (!computedHash || expected === '') {
    result.hidden = true;
    return;
  }

  const match = expected === computedHash;
  result.textContent = match ? '✓ MATCH' : '✗ NO MATCH';
  result.className = 'verify-result ' + (match ? 'match' : 'no-match');
  result.hidden = false;

  const detail = $('verify-detail');
  detail.hidden = false;
  detail.textContent = match
    ? 'The file is byte-for-byte identical to the file that produced the expected hash.'
    : 'The hashes differ: this file is NOT identical to the one that produced the expected hash. Check that you are comparing the original export file (not a copy that was opened and re-saved) and that the hash was pasted completely.';
}

init();
