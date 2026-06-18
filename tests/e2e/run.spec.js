// Drives tests/run.html (parsers, SHA-256 hashing, PDF sanitization,
// declaration, redaction) and asserts the in-page harness reported zero
// failures. Contract: tests/run.js sets #summary to "<passed> / <total>
// tests passed" and appends <li class="pass|fail"> to #results.
const { test, expect } = require('@playwright/test');
const { blockExternal } = require('./_helpers');

test('parser / hash / PDF suite passes', async ({ page }) => {
  // run.html loads jsPDF from cdnjs (defer); block it so navigation can't hang
  // on the CDN. The auto-run pure-logic suite never needs it.
  await blockExternal(page);
  await page.goto('/tests/run.html');

  const summary = page.locator('#summary');
  // The harness renders results asynchronously; wait until it leaves the
  // "Running…" placeholder. If a module throws on load it stays here and fails.
  await expect(summary).not.toHaveText('Running…', { timeout: 30_000 });

  // No failing test rows, and the suite actually ran something.
  await expect(page.locator('#results li.fail')).toHaveCount(0);
  await expect(page.locator('#results li')).not.toHaveCount(0);

  // Cross-check the summary string: passed === total, total > 0.
  const text = (await summary.textContent()).trim();
  const m = text.match(/^(\d+)\s*\/\s*(\d+)\s+tests passed$/);
  expect(m, `unexpected summary: "${text}"`).not.toBeNull();
  expect(Number(m[1])).toBe(Number(m[2]));
  expect(Number(m[2])).toBeGreaterThan(0);
});
