// Headless CI runner for ExhibitKit's existing in-browser test suite.
// It serves the repo root over loopback and drives tests/run.html and
// tests/ai-lab-test.html in real Chromium, asserting on the result summary
// those pages already render. The test logic itself is NOT duplicated here.
//
// Why 127.0.0.1: the parser/hash tests use crypto.subtle (SHA-256), which is
// only available in a "secure context". http://localhost / 127.0.0.1 qualify;
// a LAN IP/hostname or 0.0.0.0 does NOT. Keep everything on loopback.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,        // fail if a test.only is committed
  retries: process.env.CI ? 1 : 0,     // one retry absorbs a transient CDN blip
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `${BASE}/tests/run.html`,     // readiness probe (a real file)
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
