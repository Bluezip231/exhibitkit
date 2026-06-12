/**
 * sw.js — service worker so ExhibitKit works fully offline after first load.
 *
 * Strategy:
 *  - Pre-cache all same-origin static assets at install.
 *  - Cache-first for everything (static site; nothing is dynamic).
 *  - Runtime-cache successful responses for the CDN (jsPDF) and Google Fonts
 *    so the builder keeps working offline.
 *
 * No user data ever passes through here: file processing is all in-page
 * memory, and this worker only handles GET requests for static assets.
 */

const VERSION = 'exhibitkit-v1';

const PRECACHE = [
  './',
  'index.html',
  'app.html',
  'verify.html',
  'guide.html',
  'css/styles.css',
  'js/app.js',
  'js/verify.js',
  'js/hash.js',
  'js/pdf.js',
  'js/declaration.js',
  'js/parsers/detect.js',
  'js/parsers/whatsapp.js',
  'js/parsers/smsxml.js',
  'js/parsers/meta.js',
  'js/parsers/csv.js',
  'assets/favicon.svg',
  'manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
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
    url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
