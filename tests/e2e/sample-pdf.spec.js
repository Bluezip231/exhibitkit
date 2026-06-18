// The homepage advertises a real, downloadable sample exhibit PDF. Assert the
// hero link exists and that the committed file actually resolves and is a PDF.
const { test, expect } = require('@playwright/test');
const { blockExternal } = require('./_helpers');

test('homepage links to a real sample exhibit PDF that resolves', async ({ page, request }) => {
  await blockExternal(page);
  await page.goto('/index.html');

  const link = page.locator('.hero-cta a[href="assets/sample-exhibit.pdf"]');
  await expect(link).toBeVisible();

  const res = await request.get('/assets/sample-exhibit.pdf');
  expect(res.status()).toBe(200);

  const body = await res.body();
  expect(body.length).toBeGreaterThan(1000);
  expect(body.slice(0, 5).toString('latin1')).toBe('%PDF-');
});
