// Smoke test: every real page must load and run its module scripts without
// throwing an uncaught JavaScript error. This is what guards app.js, contact.js,
// the parsers, the AI Lab controller, etc. against load-time regressions —
// `pageerror` fires on any uncaught exception (a syntax error, a bad import, a
// throw during init). Console warnings are intentionally NOT failed on.
const { test, expect } = require('@playwright/test');

const PAGES = [
  'index.html',
  'app.html',
  'verify.html',
  'contact.html',
  'contact-success.html',
  'guide.html',
  'about.html',
  'privacy.html',
  'support.html',
  'scam-evidence.html',
  'ai-lab.html',
  '404.html',
];

for (const path of PAGES) {
  test(`${path} loads with no uncaught JS errors`, async ({ page }) => {
    // The AI Lab loads its model only on user action; make sure a stray
    // load-time fetch of the 23 MB model/runtime can't happen in CI.
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
    await page.route('**/huggingface.co/**', (route) => route.abort());
    await page.route('**/*.wasm', (route) => route.abort());

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/' + path, { waitUntil: 'load' });

    expect(errors, `uncaught errors on ${path}:\n${errors.join('\n')}`).toHaveLength(0);
  });
}
