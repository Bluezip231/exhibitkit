/**
 * sw.js — service worker so ExhibitKit works fully offline after first load.
 *
 * Strategy:
 *  - Pre-cache all same-origin static assets at install.
 *  - Network-first for page navigations (HTML documents). The HTML response
 *    carries the page's Content-Security-Policy header; serving HTML cache-first
 *    would pin a STALE CSP and silently break pages whose policy later changes
 *    (this is exactly what broke the AI Review Lab: the cached ai-lab.html kept
 *    enforcing an old CSP that blocked the jsDelivr model runtime). Falling back
 *    to cache keeps the app working offline.
 *  - Cache-first for static subresources (JS/CSS/fonts/images): fast and
 *    offline-friendly. A VERSION bump re-fetches them when they change.
 *  - Runtime-cache successful responses for the CDN (jsPDF) and Google Fonts
 *    so the builder keeps working offline.
 *
 * No user data ever passes through here: file processing is all in-page
 * memory, and this worker only handles GET requests for static assets.
 */

const VERSION = 'exhibitkit-v10';

// Same-origin assets: must all cache for the app to work offline, so these
// are cached atomically and a failure fails the install (retried next visit).
const PRECACHE_LOCAL = [
  './',
  'index.html',
  'app.html',
  'verify.html',
  'guide.html',
  'scam-evidence.html',
  'about.html',
  'contact.html',
  'contact-success.html',
  'support.html',
  'privacy.html',
  'ai-lab.html',
  '404.html',
  'css/styles.css',
  'js/app.js',
  'js/ai/ai-lab.js',
  'js/ai/evidence-map.js',
  'js/verify.js',
  'js/hash.js',
  'js/pdf.js',
  'js/declaration.js',
  'js/redact.js',
  'js/sample.js',
  'js/pwa.js',
  'js/contact.js',
  'js/parsers/detect.js',
  'js/parsers/whatsapp.js',
  'js/parsers/smsxml.js',
  'js/parsers/meta.js',
  'js/parsers/csv.js',
  'assets/favicon.svg',
  'manifest.webmanifest',
];

// Cross-origin CDN assets: cached best-effort. A slow or blocked CDN on the
// first visit must NOT fail the whole install (which would leave the user
// with no offline support at all); they get cached on first successful fetch.
const PRECACHE_REMOTE = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all([
        cache.addAll(PRECACHE_LOCAL),                 // atomic: critical assets
        ...PRECACHE_REMOTE.map((u) =>                  // best-effort: CDN assets
          cache.add(u).catch(() => undefined)),
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const cacheable =
    url.origin === self.location.origin ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net';   // optional extended PDF font
  if (!cacheable) return;

  // Network-first for page navigations so the document's CSP header is always
  // fresh online. Offline (or on network error) we fall back to the cached
  // document — ignoring the query string, then the app shell — so the app
  // still opens offline instead of erroring.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () =>
        (await caches.match(request, { ignoreSearch: true }))
        || (await caches.match('index.html'))
        || (await caches.match('./'))
        || Response.error())
    );
    return;
  }

  // Cache-first for static subresources (JS/CSS/fonts/images).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => Response.error());
    })
  );
});
