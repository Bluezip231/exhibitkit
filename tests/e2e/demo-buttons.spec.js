// Per-format "Try demo" buttons in the builder: each must run the real local
// pipeline, reveal the message list, and populate the deterministic Evidence
// Map - with no network access. The route().abort() guards enforce that this
// flow never reaches a CDN or the AI model: the Evidence Map is pure local JS.
const { test, expect } = require('@playwright/test');
const { blockExternal } = require('./_helpers');

const DEMOS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'meta', label: 'Messenger' },
  { id: 'smsxml', label: 'SMS' },
];

for (const demo of DEMOS) {
  test(`${demo.label} demo parses and reveals the list + evidence map`, async ({ page }) => {
    await blockExternal(page);
    await page.goto('/app.html');

    await page.click(`[data-sample="${demo.id}"]`);

    await expect(page.locator('#step-select')).toBeVisible();
    await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);
    await expect(page.locator('#evidence-map')).toBeVisible();
    await expect(page.locator('#em-chips [data-category]')).not.toHaveCount(0);
    await expect(page.locator('#em-timeline .em-entry')).not.toHaveCount(0);
  });
}

test('CSV demo opens the column mapper, applies, and reveals the list + map', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/app.html');

  await page.click('[data-sample="csv"]');
  await expect(page.locator('#csv-mapper')).toBeVisible();

  await page.click('#apply-mapping');
  await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);
  await expect(page.locator('#evidence-map')).toBeVisible();
});

test('evidence map category chip filters the list and toggles back off', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/app.html');
  await page.click('[data-sample="whatsapp"]');
  await expect(page.locator('#message-list li.msg')).not.toHaveCount(0);

  // The Evidence Map is a collapsed <details>; open it to reach the chips.
  await page.locator('#evidence-map > summary').click();

  const total = await page.locator('#message-list li.msg').count();
  const moneyChip = page.locator('#em-chips [data-category="money"]');
  await expect(moneyChip).toBeVisible();
  await expect(moneyChip).toBeEnabled();

  await moneyChip.click();
  await expect(moneyChip).toHaveAttribute('aria-pressed', 'true');
  const filtered = await page.locator('#message-list li.msg').count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);

  await moneyChip.click();
  await expect(moneyChip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#message-list li.msg')).toHaveCount(total);
});
