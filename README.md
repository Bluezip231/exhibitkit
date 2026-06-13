# ExhibitKit

**Turn text message exports into court-ready PDF exhibits — entirely in your browser.**

ExhibitKit is a free, privacy-first static web app for self-represented litigants,
attorneys and paralegals. It converts raw message exports (WhatsApp, Android SMS,
Facebook Messenger / Instagram, generic CSV) into clean PDF exhibits with
tamper-evidence features:

- a **SHA-256 hash** of the original source file printed on every page,
- **sequential Bates numbering** per message,
- an auto-generated **declaration of authenticity** template page,
- **true redaction** — redacted text is removed before the PDF exists, never
  overlaid. Redact a selection inside one message, or a typed phrase (an
  account number, an address) across every selected message at once,
- a **preview** mode (opens the exhibit in a new tab without downloading),
- an optional **extended font** (DejaVu Sans, opt-in ~740 KB download) so
  accented, Greek and Cyrillic text prints natively instead of as
  placeholders,
- a built-in **fictional sample chat** so anyone can try the full flow
  before exporting anything real.

**Core promise: your messages never leave your device.** There is no backend, no
database, no upload endpoint, no account system, and no analytics on app pages.

## Architecture

Plain static site. No build step, no bundler, no framework. Deploys by pushing
to GitHub with Netlify connected to the repo.

```
index.html        Landing page (marketing + privacy promise, FAQ JSON-LD)
app.html          The exhibit builder (4-step wizard)
verify.html       Standalone SHA-256 verification tool
guide.html        Per-platform export walkthroughs
scam-evidence.html  Use-case guide for fraud victims (police / IC3 / FTC /
                  bank disputes), cross-linked with ScamKit.com — the same
                  maker's scam-checking and recovery site
about.html        What it is / who built it / design principles
contact.html      Netlify contact form (honeypot, no JS) + contact-success.html
privacy.html      Plain-English privacy policy
support.html      Free ways to help + optional donation
404.html          Branded not-found page (served by Netlify)
css/styles.css    Single stylesheet; design tokens at the top
js/
  app.js          Builder orchestration + in-memory state (nothing persisted)
  hash.js         SHA-256 via crypto.subtle (Web Crypto API)
  pdf.js          Exhibit PDF generation (jsPDF), WinAnsi sanitization
  declaration.js  Declaration/certification page text assembly
  verify.js       Verify page logic
  parsers/
    detect.js     Format auto-detection (file name + first 2 KB)
    whatsapp.js   WhatsApp .txt (iOS bracketed + Android dash variants)
    smsxml.js     SMS Backup & Restore .xml (sms + minimal mms)
    meta.js       Messenger/Instagram message_N.json (incl. mojibake fix)
    csv.js        RFC 4180 state-machine parser + column mapping
sw.js             Service worker: full offline support after first load
tests/run.html    In-browser test suite (no framework) + 20k-message perf test
```

Only two external dependencies, both loaded from CDNs and cached by the service
worker: **jsPDF** (MIT) and Google Fonts (Spectral, Inter, IBM Plex Mono).

### Data flow

1. The user picks a file. It is read into memory with `File.arrayBuffer()`.
2. The raw bytes are hashed with `crypto.subtle.digest('SHA-256', …)` — the
   hash is of the **original file bytes**, not the parsed messages, and that is
   stated explicitly on the exhibit's certification page.
3. The text is decoded (`TextDecoder('utf-8', { fatal: false })`), the format
   auto-detected, and parsed into a canonical message array. `rawTimestamp` is
   always preserved and is what gets printed — message content is never
   reformatted (the only alteration is explicit, user-driven redaction).
4. The user selects/redacts messages, fills in case details, and jsPDF builds
   the exhibit locally. `doc.save()` triggers the download.

State lives in one in-memory object in `app.js`. Refreshing the page erases
everything (a `beforeunload` warning guards against accidents).

## Security & privacy notes

- **No network egress of user data.** The only requests the site makes are for
  its own static assets, jsPDF from cdnjs, Google Fonts, and (only when the
  user opts in) the DejaVu font from jsDelivr. Verify with the browser's
  Network tab through a full session.
- **Enforced by a strict Content-Security-Policy** (`_headers`, served by
  Netlify): `connect-src` is limited to the site itself and the static asset
  hosts, `form-action 'none'`, no inline scripts. The browser refuses any
  other network destination, so even a hidden bug could not transmit message
  content — there is nowhere on the allowlist to send it.
- **No persistence.** No localStorage/sessionStorage/IndexedDB/cookies for
  message content — or anything else.
- `crypto.subtle` requires a secure context: HTTPS in production (Netlify
  provides this) or `localhost` in development. On plain HTTP the app shows a
  blocking error instead of degrading.
- The service worker only caches GET requests for static assets; user data
  never passes through it.
- Invisible Unicode formatting marks (LTR/RTL marks, zero-width characters)
  are stripped from PDF output since standard fonts can't encode them; all
  *visible* unsupported characters (emoji, non-Latin scripts) become explicit
  placeholders (`[emoji]`, `[non-Latin text]`) and the user is warned before
  generation. Nothing is silently dropped.

### Unicode in PDFs

jsPDF's built-in fonts cover WinAnsi (cp1252) only. By default, unsupported
characters become explicit placeholders (`[emoji]`, `[non-Latin text]`) with
a pre-generation notice — honest rather than silently lossy.

When the notice appears, the user can opt in to embedding **DejaVu Sans**
(fetched once from jsDelivr, ~740 KB, cached by the service worker). That
extends native rendering to extended Latin (Polish, Turkish, Vietnamese…),
Greek and Cyrillic. Three things deliberately stay as placeholders even
then:

- **Emoji** — PDF standard fonts have no color emoji.
- **RTL scripts (Arabic, Hebrew)** — jsPDF has no bidi or shaping engine;
  printing them in the wrong order in an evidence document would be worse
  than an explicit placeholder.
- **CJK** — would require a multi-megabyte font; out of scope for now.

## Development

No tooling required:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(`localhost` counts as a secure context, so hashing works.)

### Tests

Open `http://localhost:8000/tests/run.html`. The suite covers all four parsers
(including the Meta mojibake fix with emoji fixtures), RFC 4180 edge cases,
hashing against a known SHA-256 test vector, WinAnsi sanitization, filename
sanitization, and declaration assembly. The same page has a button that
generates a synthetic **20,000-message PDF** to verify chunked generation keeps
the UI responsive with visible progress.

## Deploy

1. Push to GitHub.
2. In Netlify: "Add new site → Import an existing project", pick the repo.
3. Build command: none. Publish directory: repo root.

Netlify serves over HTTPS, which `crypto.subtle` and the service worker
require.

## Disclaimer

ExhibitKit formats records and computes integrity hashes. It is not a law firm
and does not provide legal advice. The declaration it produces is a template;
evidentiary and declaration requirements vary by court and jurisdiction.
