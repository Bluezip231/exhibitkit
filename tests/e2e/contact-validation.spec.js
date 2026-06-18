// Functional test for the progressive-enhancement validation on the contact
// form (js/contact.js). With JS enabled it shows inline messages and blocks
// submission; the native no-JS Netlify POST path is unaffected.
const { test, expect } = require('@playwright/test');
const { blockExternal } = require('./_helpers');

test('empty message is flagged inline and blocks submit', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/contact.html');

  await page.click('#contact-form button[type="submit"]');

  const message = page.locator('#c-message');
  await expect(message).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#c-message-error')).toBeVisible();
  await expect(message).toBeFocused();
  // Submission was prevented — still on the contact page, not the success page.
  await expect(page).toHaveURL(/contact\.html$/);

  // Typing clears the error.
  await message.fill('Hello, I have a question.');
  await expect(message).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#c-message-error')).toBeHidden();
});

test('malformed email is rejected, blank email is allowed', async ({ page }) => {
  await blockExternal(page);
  await page.goto('/contact.html');
  await page.fill('#c-message', 'Hello');

  // Bad email -> flagged.
  await page.fill('#c-email', 'not-an-email');
  await page.click('#contact-form button[type="submit"]');
  await expect(page.locator('#c-email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#c-email-error')).toBeVisible();

  // Clearing the optional email makes the form valid again (error goes away).
  await page.fill('#c-email', '');
  await expect(page.locator('#c-email')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#c-email-error')).toBeHidden();
});
