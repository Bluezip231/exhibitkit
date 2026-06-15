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
ai-lab.html       Optional AI Review Lab (local-AI relevance mapping; AI-free builder)
404.html          Branded not-found page (served by Netlify)
css/styles.css    Single stylesheet; design tokens at the top
js/
  app.js          Builder orchestration + in-memory state (nothing persisted)
  hash.js         SHA-256 via crypto.subtle (Web Crypto API)
  pdf.js          Exhibit PDF generation (jsPDF), WinAnsi sanitization
  declaration.js  Declaration/certification page text assembly
  verify.js       Verify page logic
  ai/
    evidence-map.js  AI Evidence Mapper core (pure logic + local embeddings)
    ai-lab.js        AI Review Lab DOM controller (safe rendering, memo export)
  parsers/
    detect.js     Format auto-detection (file name + first 2 KB)
    whatsapp.js   WhatsApp .txt (iOS bracketed + Android dash variants)
    smsxml.js     SMS Backup & Restore .xml (sms + minimal mms)
    meta.js       Messenger/Instagram message_N.json (incl. mojibake fix)
    csv.js        RFC 4180 state-machine parser + column mapping
sw.js             Service worker: full offline support after first load
tests/run.html    In-browser test suite (no framework) + 20k-message perf test
tests/ai-lab-test.html  AI Review Lab tests (pure logic + on-demand model fixtures)
```

External dependencies, all loaded from CDNs and cached by the service worker:

- **jsPDF** (MIT, from cdnjs) and **Google Fonts** (Spectral, Inter, IBM Plex
  Mono) — used by the core app on every page.
- **DejaVu Sans** (from jsDelivr) — fetched only if the user opts in to the
  extended PDF font.
- **Transformers.js** and the **ONNX runtime loader glue** (`ort-*.jsep.mjs`)
  are **vendored** into the repo (`js/ai/vendor/`) and served from our own
  origin — no third-party JavaScript executes in the AI Lab. Only **binary**
  data is fetched from CDNs when the optional AI Review Lab is run: the ONNX
  **WebAssembly runtime** (`.wasm`, ~21 MB, from jsDelivr) and the public
  **`Xenova/all-MiniLM-L6-v2`** model weights (~23 MB, from Hugging Face). These
  are GET-only downloads of public files; no message text is ever uploaded.

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
  Netlify). To avoid Netlify's header *merging* (a CSP on the `/*` wildcard is
  appended to — not replaced by — a page-specific CSP, and browsers then enforce
  the most restrictive intersection), the wildcard `/*` rule carries **only the
  singleton security headers** (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`) and **no CSP at all**. Every HTML page
  — including both its pretty URL (`/app`) and `.html` form (`/app.html`) —
  declares its **own complete CSP**, so no two CSPs ever combine. No inline
  scripts anywhere. `connect-src` never includes `'self'` on any page, so a
  script has nowhere on the allowlist to POST message content. Only the contact
  pages relax `form-action` to `'self'` (for the no-JS Netlify form POST);
  `app`, `verify` and `ai-lab` keep `form-action 'none'`. `ai-lab` adds
  `'wasm-unsafe-eval'`, `'unsafe-eval'`, and `blob:` to `script-src`
  because onnxruntime-web uses JavaScript code generation for browser inference —
  no third-party script host is listed, so eval applies only to the vendored code
  running from our own origin. This eval permission is granted **only to
  `/ai-lab`** and **never to the Builder, Verify, or any other page**. `connect-src`
  allows GET-only *binary* downloads from jsDelivr (the ONNX `.wasm`) and the
  Hugging Face model hosts (model weights) — but still no `'self'`, so never an
  upload path for message text.
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

## AI Review Lab

`ai-lab.html` is an **optional** feature that demonstrates browser-based AI
without compromising the trustworthiness of the exhibit pipeline.

- **What it does.** It loads a small sentence-embedding model
  (`Xenova/all-MiniLM-L6-v2`) into the browser via
  [Transformers.js](https://github.com/huggingface/transformers.js), embeds a
  user-supplied claim and their pasted messages, ranks messages by **cosine
  similarity**, and groups them into *Strongly related*, *Possibly related*,
  *Needs context* and *Low match* — with cautious, rule-based reason labels, a
  rule-based summary, a gaps checklist and a downloadable `.txt` review memo.
- **Semantic similarity, not legal judgment.** Scores are "evidence clarity" /
  "possible relevance", never "case strength" or "legal score". It never says a
  message proves anything — only that it *may* relate or *may* need context.
- **Local and private.** All embedding runs on-device. Message text is **not**
  sent to OpenAI, Claude, any paid API, or a backend (there is no backend). The
  Transformers.js bundle and the executable ONNX loader glue are vendored and
  run from our own origin, so no external JavaScript executes in the same page
  context as pasted messages; the only cross-origin traffic is GET requests for
  *binary* data (the ONNX `.wasm` runtime and the public model weights). Nothing
  is written to localStorage/sessionStorage/IndexedDB/cookies; refreshing clears
  everything. (The browser may cache the downloaded runtime/model *files* in the
  Cache API — public binaries, not your messages.)
- **Separate from the official builder.** The court-ready exhibit pipeline
  (`app.html` → `pdf.js`) stays **deterministic and AI-free**. AI never
  rewrites evidence, decides admissibility, gives legal advice, or changes the
  exhibit PDF. The AI memo is explicitly *not* part of the exhibit.
- **Library/model pinning.** Transformers.js and the ONNX loader glue are
  vendored at a fixed version (`3.8.1`) in `js/ai/vendor/`, so an upstream
  change can't silently alter the page. The ONNX `.wasm` binary is fetched from
  jsDelivr at the *same* pinned version (`ORT_PKG_VERSION` in
  `js/ai/evidence-map.js`) — keep the vendored `.mjs` and that constant in
  lock-step when upgrading, since the loader glue and wasm share an ABI. If the
  model id ever stops resolving, swap `MODEL_ID` for the smallest available
  feature-extraction model and note it in that file.

**Limitations (stated plainly):** the model may miss relevant messages; it may
rank irrelevant messages highly; short replies ("yes", "that works") need
surrounding context; and users must always review the original messages
themselves. Human review is required.

> Portfolio note: ExhibitKit includes an optional AI Review Lab that uses local
> browser embeddings and cosine similarity to map selected messages to a
> user-defined claim. I kept the official exhibit pipeline deterministic and
> AI-free, separating AI assistance from evidence generation to preserve trust
> and reduce legal risk.

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

Open `http://localhost:8000/tests/ai-lab-test.html` for the AI Review Lab tests.
The pure-logic tests (parsing, cosine similarity, scoring, labelling, gap rules
and memo assembly) run automatically with no network; a button runs the
money / repair / short-reply / missing-timestamp acceptance fixtures through the
real local model on demand.

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
