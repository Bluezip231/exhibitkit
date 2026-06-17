// Drives tests/ai-lab-test.html — the pure-logic AI tests (parsing, cosine
// similarity, scoring, labelling, gaps, memo) that run automatically with no
// network. The 23 MB-model "semantic fixtures" are button-triggered and are
// intentionally NOT exercised here.
//
// The route().abort() guards below turn "must stay offline" into an enforced
// invariant: if a future change makes the pure-logic path touch the model,
// runtime or wasm, this test fails loudly instead of silently relying on CI
// network access.
const { test, expect } = require('@playwright/test');

test('AI Lab pure-logic suite passes (offline)', async ({ page }) => {
  await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
  await page.route('**/huggingface.co/**', (route) => route.abort());
  await page.route('**/*.wasm', (route) => route.abort());

  await page.goto('/tests/ai-lab-test.html');

  const summary = page.locator('#summary');
  await expect(summary).not.toHaveText('Running pure-logic tests…', { timeout: 30_000 });

  await expect(page.locator('#results li.fail')).toHaveCount(0);
  await expect(page.locator('#results li')).not.toHaveCount(0);

  // Contract: "<pass> passed, <fail> failed (pure-logic tests)."
  const text = (await summary.textContent()).trim();
  const m = text.match(/^(\d+) passed, (\d+) failed \(pure-logic tests\)\.$/);
  expect(m, `unexpected summary: "${text}"`).not.toBeNull();
  expect(Number(m[2])).toBe(0);                  // zero failures
  expect(Number(m[1])).toBeGreaterThan(0);       // suite actually ran
});
