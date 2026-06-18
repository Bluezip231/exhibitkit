/**
 * generate-sample-pdf.cjs - regenerates assets/sample-exhibit.pdf from the REAL
 * builder pipeline, so the committed sample always reflects current output.
 *
 * This is a dev tool, not part of the test suite (it lives outside tests/e2e,
 * which is Playwright's testDir). Run it whenever the cover/declaration layout
 * changes:
 *
 *   python3 -m http.server 4173 --bind 127.0.0.1 &   # serve the repo root
 *   node tests/tools/generate-sample-pdf.cjs
 *
 * It loads app.html, runs the WhatsApp demo, redacts the sample account number
 * (so the PDF also demonstrates the redaction log), fills the case details, and
 * saves the generated PDF. The bytes are not deterministic (the cover/footer
 * stamp the current date), so this produces a representative artifact.
 */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const OUT = path.resolve(__dirname, '../../assets/sample-exhibit.pdf');
// Optional local jsPDF copy, used when the headless browser has no network
// egress to cdnjs. Download once with:
//   curl -o /tmp/jspdf.umd.min.js https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
const JSPDF_LOCAL = process.env.JSPDF_LOCAL || '/tmp/jspdf.umd.min.js';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Serve jsPDF from the local copy if present, so generation does not depend
  // on the browser reaching cdnjs.
  if (require('fs').existsSync(JSPDF_LOCAL)) {
    await page.route('**/cdnjs.cloudflare.com/**/jspdf*', (route) =>
      route.fulfill({ path: JSPDF_LOCAL, contentType: 'application/javascript' }));
  }

  await page.goto(`${BASE}/app.html`, { waitUntil: 'load' });

  // Run the WhatsApp demo (the fictional Jane/John co-parenting chat).
  await page.click('#sample-btn');
  await page.waitForSelector('#step-case:not([hidden])');

  // Redact the account number so the sample exhibit demonstrates the log.
  await page.click('#redact-phrase-toggle');
  await page.fill('#redact-phrase', '4417-220-9981');
  await page.click('#redact-phrase-apply');

  // Case details for a realistic cover + declaration.
  await page.fill('#f-exhibit', 'Exhibit A');
  await page.fill('#f-declarant', 'Jane Smith');
  await page.fill('#f-court', 'Family Court of Example County');
  await page.fill('#f-caption', 'Smith v. Smith');
  await page.fill('#f-casenum', '26-D-1234');
  await page.fill('#f-role', 'Petitioner');
  await page.fill('#f-account', "Jane Smith's phone, WhatsApp chat with John Smith");

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-generate'),
  ]);
  await download.saveAs(OUT);
  await browser.close();

  if (errors.length) {
    console.error('Page errors during generation:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Saved sample exhibit to', OUT);
})().catch((err) => { console.error(err); process.exit(1); });
