// Shared route guards that make the e2e suite hermetic: no test depends on an
// external host (cdnjs / jsDelivr / Hugging Face / Google Fonts) being reachable
// from the CI runner.
//
// Why this matters: app.html and tests/run.html load jsPDF from cdnjs via a
// deferred <script>. page.goto(..., waitUntil: 'load') waits for deferred
// scripts, so if cdnjs is slow or unreachable the navigation hangs the full
// 30s and the test times out (this is exactly what intermittently failed the
// smoke / builder / run specs in CI). Aborting these requests makes the page
// finish loading immediately with local assets only - our own code never needs
// the CDN at load time.
async function blockExternal(page) {
  for (const pattern of [
    '**/cdnjs.cloudflare.com/**',   // jsPDF
    '**/cdn.jsdelivr.net/**',       // Transformers.js (AI Lab) + extended font
    '**/huggingface.co/**',         // AI Lab model weights
    '**/fonts.googleapis.com/**',   // Google Fonts CSS
    '**/fonts.gstatic.com/**',      // Google Fonts files
    '**/*.wasm',                    // ONNX runtime
  ]) {
    await page.route(pattern, (route) => route.abort());
  }
}

module.exports = { blockExternal };
