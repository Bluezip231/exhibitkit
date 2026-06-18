// The redaction log: when messages are redacted or excluded, the builder shows
// a truthful on-screen summary (mirrored into the PDF declaration). It reports
// COUNTS only and must never invent PII categories ("phone numbers/emails").
//
// The on-screen summary is rendered before the PDF library is needed, so this
// test runs fully offline (CDN blocked) and asserts the DOM rather than trying
// to read text out of a generated PDF.
const { test, expect } = require('@playwright/test');

async function goOffline(page) {
  await page.route('**/cdnjs.cloudflare.com/**', (route) => route.abort());
  await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
  await page.route('**/huggingface.co/**', (route) => route.abort());
  await page.route('**/*.wasm', (route) => route.abort());
}

test('redacting + excluding logs truthful counts on screen, no PII categories', async ({ page }) => {
  await goOffline(page);
  await page.goto('/app.html');

  await page.click('[data-sample="whatsapp"]');
  await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);

  // Exclude one message from the full thread.
  await page.locator('#message-list li.msg input[type="checkbox"]').first().uncheck();

  // Redact the sample account number everywhere it appears.
  await page.click('#redact-phrase-toggle');
  await page.fill('#redact-phrase', '4417-220-9981');
  await page.click('#redact-phrase-apply');

  // Generate (the PDF library is blocked, but the log renders before that step).
  await page.fill('#f-exhibit', 'Exhibit A');
  await page.fill('#f-declarant', 'Jane Smith');
  await page.click('#btn-generate');

  const log = page.locator('#redaction-summary');
  await expect(log).toBeVisible();
  await expect(log).toContainText('had content redacted');
  await expect(log).toContainText('excluded from the full thread');
  await expect(log).not.toContainText(/phone|e-?mail/i);
});
