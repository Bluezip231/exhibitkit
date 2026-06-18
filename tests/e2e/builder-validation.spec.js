// Functional test for the Step 3 required-field validation in the exhibit
// builder: invalid fields get aria-invalid + a visible inline message, focus
// moves to the first invalid field, and the error clears as the user types.
const { test, expect } = require('@playwright/test');
const { blockExternal } = require('./_helpers');

test('builder flags missing required case fields accessibly', async ({ page }) => {
  // Validation fails before any PDF work, so jsPDF is never needed; block the
  // CDN so app.html's deferred jsPDF script can't hang the page load.
  await blockExternal(page);
  await page.goto('/app.html');

  // The built-in sample runs the real pipeline and reveals all wizard steps.
  await page.click('#sample-btn');

  const exhibit = page.locator('#f-exhibit');
  const declarant = page.locator('#f-declarant');
  await expect(exhibit).toBeVisible();

  // Clear both required fields and attempt to generate.
  await exhibit.fill('');
  await declarant.fill('');
  await page.click('#btn-generate');

  // Both fields are marked invalid with visible inline messages + a summary.
  await expect(exhibit).toHaveAttribute('aria-invalid', 'true');
  await expect(declarant).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-exhibit-error')).toBeVisible();
  await expect(page.locator('#f-declarant-error')).toBeVisible();
  await expect(page.locator('#gen-error')).toBeVisible();

  // Focus moved to the first invalid field.
  await expect(exhibit).toBeFocused();

  // Typing a value clears that field's error (progressive recovery).
  await exhibit.fill('Exhibit A');
  await expect(exhibit).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f-exhibit-error')).toBeHidden();
});
