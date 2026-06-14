/**
 * contact.js - submit the Netlify contact form via same-origin fetch.
 *
 * form-action 'none' is set on every page so a native form POST is blocked
 * everywhere. This script is only loaded on contact.html, which carries a
 * wildcard CSP with connect-src 'self'; builder/verify pages have a stricter
 * per-page override that drops 'self' from connect-src, so this fetch path is
 * unavailable to scripts running on evidence-handling pages.
 */
const form = document.getElementById('contact-form');

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const status = document.getElementById('form-status');
    const body = new URLSearchParams(new FormData(form)).toString();

    if (button) button.disabled = true;
    if (status) {
      status.hidden = false;
      status.className = 'notice';
      status.textContent = 'Sending…';
    }

    try {
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.assign('contact-success.html');
    } catch (err) {
      if (button) button.disabled = false;
      if (status) {
        status.hidden = false;
        status.className = 'notice notice-error';
        status.textContent =
          'Sorry - that didn’t send. Please try again, or reach out on X (@ShawverTech) or GitHub.';
      }
    }
  });
}
