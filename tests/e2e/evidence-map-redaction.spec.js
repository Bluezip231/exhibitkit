// Regression tests for two Evidence Map ↔ redaction interactions flagged in
// review (PR #2):
//   1. Redacting the last keyword of the actively-filtered category must clear
//      the filter, not strand the list behind a now-disabled chip.
//   2. Undo (and per-message redaction) must refresh the map/timeline so it
//      can't keep showing text that was redacted out of the message + PDF.
const { test, expect } = require('@playwright/test');
const { blockExternal } = require('./_helpers');

test('emptying the active category via redaction clears the filter (no dead-end)', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/app.html');
  await page.click('[data-sample="whatsapp"]');
  await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);
  await page.locator('#evidence-map > summary').click();

  const money = page.locator('#em-chips [data-category="money"]');
  await expect(money).toBeEnabled();
  await money.click();
  await expect(money).toHaveAttribute('aria-pressed', 'true');

  // Redact the only money keyword in the sample, dropping the count to zero.
  await page.click('#redact-phrase-toggle');
  await page.fill('#redact-phrase', '$300');
  await page.click('#redact-phrase-apply');

  // Chip is now disabled, the filter was cleared, and the list isn't stranded.
  await expect(money).toBeDisabled();
  await expect(money).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);
});

test('undoing a redaction refreshes the evidence map timeline', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/app.html');
  await page.click('[data-sample="whatsapp"]');
  await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);
  await page.locator('#evidence-map > summary').click();

  const timeline = page.locator('#em-timeline');
  await expect(timeline).toContainText('4417-220-9981');

  // Redact the account number; the timeline snippet must hide it.
  await page.click('#redact-phrase-toggle');
  await page.fill('#redact-phrase', '4417-220-9981');
  await page.click('#redact-phrase-apply');
  await expect(timeline).toContainText('[REDACTED]');
  await expect(timeline).not.toContainText('4417-220-9981');

  // Undo must refresh the map so the timeline reflects the restored body.
  await page.locator('#message-list li.msg', { hasText: '[REDACTED]' })
    .getByRole('button', { name: /Undo/ }).first().click();
  await expect(timeline).toContainText('4417-220-9981');
});
