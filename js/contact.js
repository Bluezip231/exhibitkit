/**
 * contact.js - submit the Netlify contact form via same-origin fetch.
 *
 * The site keeps a strict `form-action 'none'` Content-Security-Policy on
 * every page (including the evidence-handling builder/verify pages), so a
 * native form POST is intentionally blocked. fetch to same-origin is allowed
 * by `connect-src 'self'`, and Netlify Forms captures the POST as long as the
 * body includes the registered `form-name`. No inline script (CSP-safe).
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
