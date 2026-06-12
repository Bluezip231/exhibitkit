// Service-worker registration, kept in its own file so pages can run under
// a strict Content-Security-Policy with no inline scripts.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}
