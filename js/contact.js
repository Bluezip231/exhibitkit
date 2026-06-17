// Progressive enhancement for the contact form.
//
// With JavaScript DISABLED the form is unchanged: it submits natively to
// Netlify and the browser's built-in `required` / `type="email"` validation
// applies. This script only runs when JS is available, where it replaces the
// native validation bubbles with inline, site-styled messages and moves focus
// to the first problem. It sets `noValidate` on the form (JS-only) so the
// submit event still fires for invalid input — the no-JS path never sees it.
(function () {
  const form = document.getElementById('contact-form');
  if (!form) return; // other pages precache this file; nothing to do there.

  // Take over validation only now that we know JS can render the messages.
  form.noValidate = true;

  const fields = [
    {
      input: 'c-message',
      error: 'c-message-error',
      message: 'Please enter a message.',
      isValid: (el) => el.value.trim() !== '',
    },
    {
      input: 'c-email',
      error: 'c-email-error',
      message: 'Please enter a valid email address, or leave it blank.',
      // Optional field: blank is fine; otherwise defer to the browser's
      // email validity check.
      isValid: (el) => el.value.trim() === '' || el.checkValidity(),
    },
  ];

  function showError(field, el) {
    el.classList.add('field-error');
    el.setAttribute('aria-invalid', 'true');
    const err = document.getElementById(field.error);
    err.textContent = field.message;
    err.hidden = false;
  }

  function clearError(field, el) {
    el.classList.remove('field-error');
    el.removeAttribute('aria-invalid');
    document.getElementById(field.error).hidden = true;
  }

  form.addEventListener('submit', (e) => {
    let firstInvalid = null;
    for (const field of fields) {
      const el = document.getElementById(field.input);
      if (!el) continue;
      if (field.isValid(el)) {
        clearError(field, el);
      } else {
        showError(field, el);
        if (!firstInvalid) firstInvalid = el;
      }
    }
    if (firstInvalid) {
      e.preventDefault(); // block submit only when something is wrong
      firstInvalid.focus();
    }
    // Otherwise: do nothing and let the native Netlify POST proceed.
  });

  // Clear a field's error as soon as the user fixes it.
  for (const field of fields) {
    const el = document.getElementById(field.input);
    if (el) {
      el.addEventListener('input', () => {
        if (field.isValid(el)) clearError(field, el);
      });
    }
  }
})();
