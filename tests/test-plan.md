# Tree Surgery: test plan

Unit and e2e tests run with every model call mocked (no cost). The read test (RT) and the pilot checks (P) make real model calls and run only when Chris asks. Requirement IDs refer to `docs/spec.md` §16. Updated with Chris's answers of 2 Nov 2026 (spec D15–D20).

## 1. Fixtures

### Committed

- `tests/fixtures/upload/` (synthetic, made in milestone 4):
  - `tree-connectors.pptx`: a left-to-right tree of boxes joined by connectors with `stCxn`/`endCxn`.
  - `tree-loose-lines.pptx`: the same tree with elbow connectors that have no connections (as `g2`).
  - `tree-grouped.pptx`: boxes inside nested groups, joined by plain `line` shapes (as `good`).
  - `tree-smartart.pptx`: a SmartArt hierarchy (as `g5`).
  - `tree-picture.pptx`: one slide holding a PNG of a tree; one holding an EMF.
  - `tree-topdown.pdf`, `tree-3pages.pdf` (tree on page 2), `tree-26pages.pdf`, `blank-slide.pptx`.
- Generated in the tests: a password-protected PDF, a corrupt PDF, a `.ppt`, a 21 MB file.
- `tests/helpers/`: `fakeAnthropic.js` (scripted streams, silence for pings, stop reasons), `storage.js` (throwing and quota-limited `localStorage`), and model JSON fixtures for each schema (valid, and one invalid per rule in §9.1 of the spec).
- Question Time's case detector fixtures and synthetic briefs, copied.

### Private (git-ignored; never committed)

- `calibration/private/trees/`: the nine PEIP trees (RT-1, P-1..P-3).
- `tests/fixtures/private/cases/` and `briefs/`: Question Time's Sets A and B, reused for T-DET-3 and T-DET-4. These tests skip until the folders exist.

## 2. Automated tests

| ID | Req | Test | Pass |
| --- | --- | --- | --- |
| T-BRF-1 | IT-1 | A new run opens on Daniel's briefing: subject, "key question first", then the tree, one page, in our template; signature; button **Set up →**. The email stays in the inbox and greets the student by first name after setup | As stated |
| T-SET-1 | TS-1 | Setup rejects each missing field, a name over 60 characters, and a bad access code (`/api/check` returns 401) | Each rejected with its message |
| T-CTX-1..5 | IT-11 | Question Time's T-CTX-1..5, ported: extraction with page markers; caps (11-page PDF, 5,001-word paste); scanned PDF refused (TS-U05); cap text visible; Continue disabled without context; every model function returns 400 without context, with no model call | As in QT |
| T-DET-1..5 | IT-11 | QT's T-DET-1..5, ported. T-DET-5 also posts a blocked key question, sub-question, slide shapes text and outline to each function | 422 `case_blocked`; no model call |
| T-KQ-1 | IT-3 | Key question required; 401 characters refused; up to 5 sub-questions; empty sub-question rows ignored | As stated |
| T-KQ-2 | IT-3 | Mocked Not OK: email in the inbox with the exact `openers.keyQuestion` line; "Attempt 2 of 3"; text kept for editing | As stated |
| T-KQ-3 | IT-3, TS-8 | Mocked OK on attempt 2: the "agreed" email ("That Key Question will work to structure the tree.") appears; key question and sub-questions frozen; Tree step opens | As stated |
| T-KQ-4 | IT-3 | Three mocked Not OK: the form closes with the "rework and come back" message; tree upload stays locked; the run is **not** locked or ended | As stated |
| T-KQ-7 | IT-3 | After T-KQ-4, a reload resumes there; **I have a new key question** opens round 2 ("Attempt 1 of 3"); an OK then opens the Tree step | As stated |
| T-KQ-8 | IT-3, IT-10 | The record lists every attempt by round, with each Stage 1 email | As stated |
| T-KQ-5 | IT-3 | The Tree step can't be reached (step bar, resume, URL) before an OK | Blocked |
| T-KQ-6 | IT-3 | The function's user message has `<key_question>`, `<sub_questions>` ("None" when empty) and `<context>`; the system prompt is persona + Stage 1 | As stated |
| T-TPL-1 | IT-2 | Template link hidden when `public/Tree-Surgery-template.pptx` is absent; shown and downloads when present | As stated |
| T-UP-1 | IT-4 | `.docx`, `.txt` refused (TS-U01); `.ppt` (TS-U02); 21 MB (TS-U03); 26 pages (TS-U04); corrupt PDF (TS-U07 with the error name); password PDF (TS-U08) | Each refused with message and code; recorded in `blockedUploads` |
| T-UP-2 | IT-4 | One-page PDF and one-slide .pptx skip the picker | Chosen automatically |
| T-UP-3 | IT-4 | `tree-3pages.pdf`: thumbnails with page numbers; **Use this page** disabled until one is chosen; page 2 chosen | Page 2 sent |
| T-UP-4 | IT-4 | Multi-slide .pptx: picker shows slide numbers and first text | As stated |
| T-UP-5 | TS-9 | `blank-slide.pptx` and the EMF picture slide refused with TS-U09; the PNG picture slide accepted as an image; a scanned PDF page accepted | As stated |
| T-UP-6 | TS-10 | Rendered page: long side 2,000 px, PNG; over 3.5 MB re-encoded as JPEG; record copy JPEG 1,600 px; the full-size image is not in `localStorage` | As stated |
| T-UP-7 | IT-4 | Panel shows "Up to 25 pages or slides, 20 MB" as text | Visible |
| T-SHP-1 | IT-4 | `tree-connectors.pptx` → shapes text has every box with position and every connector with `start=`/`end=` | Matches the expected block |
| T-SHP-2 | IT-4 | `tree-loose-lines.pptx` → elbow connectors with geometry and "(no connection)" | Matches |
| T-SHP-3 | IT-4 | `tree-grouped.pptx` → nested group transforms applied: positions equal the slide positions PowerPoint shows; `line` shapes listed with endpoints, `flipH`/`flipV` honoured | Within 1 pt |
| T-SHP-4 | IT-4 | `tree-smartart.pptx` → nested list from the diagram data part, marked "[from a SmartArt diagram]", parent–child matching the source | Matches |
| T-SHP-5 | IT-4 | Shapes text over 40,000 characters refused (TS-U03 "too much text") | Refused |
| T-READ-1 | IT-5 | Mocked read: outline stored; not rendered on screen; review call follows with the rendered outline | As stated |
| T-READ-2 | IT-5, TS-11 | `read-tree` system prompt has no persona text; user message has the image block (PDF) or `<slide_shapes>` (.pptx) and `<agreed_key_question>`, and no `<context>` | As stated |
| T-READ-8 | IT-5 (D19) | PDF with a text layer: `<page_text>` sent with the image, lines merged, positions from the top-left in points; scanned PDF: image only, no `<page_text>` | As stated |
| T-READ-3 | IT-5 | Outline checks: first node not level 0, or a level jump of 2, fails and is retried | Retried with `previousErrors` |
| T-READ-4 | IT-5, TS-12 | Mocked `unreadable` with each `reason` → Daniel's email with that sentence; upload screen again; revision not used; unreadable count on the record | As stated |
| T-READ-5 | IT-5 | Fourth unreadable in one round (if Q11 caps at 3) | Message to try the template or ask the instructor |
| T-READ-6 | IT-5 | `rootDiffers: true` → the review's outline carries the transcription note quoting the root as written | As stated |
| T-READ-7 | IT-5 | Outline rendering matches the calibration format for a fixture (levels 0–4) | Exact text |
| T-REV-1 | IT-6 | Mocked review for each verdict renders: subject, greeting, bold opener (exact), what works, numbered questions with follow-ups (First cut, Rework) or pointers (Pass), P.S., "Daniel", signature | As stated, three verdicts |
| T-REV-2 | IT-6 | The function's user message has `<key_question>`, `<tree_outline>`, `<context>`; system prompt persona + Stage 2 | As stated |
| T-REV-3 | IT-6, TS-6 | First mocked response fails the email check, second passes | Called twice; `previousErrors` name the failed rule; email renders |
| T-REV-4 | IT-6, TS-6 | Three failures | TS-S04 with **Ask Daniel again**, which reruns only the review (not the read) |
| T-REV-5 | IT-6 | Model silent for 12 s (mocked) | `ping` events during the silence; no `text` events at all |
| T-REV-6 | IT-6 | Truncated, refusal, timeout and model-error streams | TS-S05, TS-S05, TS-S03, TS-S05; retried as QT |
| T-EML-1 | TS-6 | Opener differs from the verdict's opener by one word; curly vs straight apostrophe | First fails; second passes |
| T-EML-2 | TS-6 | Rework with 2 questions, and with 6 | Both fail |
| T-EML-3 | TS-6 | A question with two "?"; a follow-up with two "?"; a question not ending in "?" | All fail |
| T-EML-4 | TS-6 | Pass with a question; Pass with 3 pointers | Both fail |
| T-EML-5 | TS-6 | Word counts at each boundary (§9.1): Stage 1 59/60/170/171, Stage 2 119/120/250/251, sign-off 250/251 | Pass inside, fail outside |
| T-EML-6 | TS-6 | Stage 1 `ok` with an email; `not_ok` without one; findings not exactly the five tests | All fail |
| T-EML-7 | TS-6 | Sign-off `signed_off` with `stillFails`; `not_there_yet` without | Both fail |
| T-EML-8 | TS-6 | Omitted empty fields (`ps`, `followUp`, `pointers`) filled before the schema check | Pass first time |
| T-FLOW-1 | IT-7 | Pass → Record, run locked, Revision shown as "Not needed" | As stated |
| T-FLOW-2 | IT-7 | Rework → Revision → one upload → sign-off → Record | As stated |
| T-FLOW-3 | IT-7 | After a readable revision, no further upload is offered | As stated |
| T-SIGN-1 | IT-8 | The function's user message has `<key_question>`, `<first_outline>`, `<first_review>`, `<revised_outline>`, `<context>`, and no findings | As stated |
| T-SIGN-2 | IT-8 | Mocked `signed_off` and `not_there_yet` render with the exact openers, what improved, what still fails, held points, the lesson | As stated |
| T-SIGN-3 | IT-8 | The sign-off reads the same agreed key question as the first review | As stated |
| T-SIGN-4 | IT-8 | Retry and failure behaviour as T-REV-3, T-REV-4 | As stated |
| T-LOCK-1 | IT-9 | After a Pass: no upload or Send control anywhere; a reload resumes into the locked run | As stated |
| T-LOCK-2 | IT-9 | After a sign-off: as T-LOCK-1 | As stated |
| T-LOCK-3 | IT-9 | **Start a new run** (if Q7 keeps it) asks to confirm, gives a new attempt ID, keeps setup | As stated |
| T-PDF-1 | IT-10 | Record contains the header fields (spec §11), every Stage 1 attempt with its email, the agreed email, the tree images (PDF) or the .pptx note, both Stage 2 emails, the appendix outlines; footer on every page; file name format | As stated |
| T-PDF-2 | IT-10, TS-5 | Search the record text for prompt phrases (eg "Internal findings", "Part A", "How to review, in order"), for finding text from the mocked model output, for context text and for slide shapes text | None found |
| T-PDF-3 | IT-10 | Record for a run paused at Stage 1 (three Not OK); for a Pass; for a sign-off | Each opens and contains its sections only |
| T-PDF-4 | IT-10 | A4 page size; images fitted inside the margins | As stated |
| T-SAV-1 | TS-2 | Reload at each step | Resume restores state exactly, including the attempt count and unreadable count |
| T-SAV-2 | TS-2 | `localStorage` throws; quota exceeded on saving a tree image | App works; warning shown |
| T-SAV-3 | TS-2 | A saved session of another version | Not resumed; deleted; notice shown |
| T-ERR-1 | TS-4 | Every code TS-U01..U09 and TS-S01..S05 shown with message and code; TS-S01 response doesn't name the variable, the log does | As stated |
| T-ERR-2 | TS-4 | Console on a refused upload and function logs on each failure | Code and error name only; no student text |
| T-SEC-1 | TS-7 | Built `dist/` and every function response: no API key, no prompt text; every model function returns 401 without the access code and makes no model call | As stated |
| T-SEC-2 | TS-5 | Every model function, with a mocked output whose findings contain a unique marker string: the response body contains neither `findings` nor the marker; neither do the logs | As stated |
| T-TIME-1 | IT-12 | Each function aborts at `functionBudgetSeconds` and sends a timeout event (mocked slow stream) | As stated |
| T-TIME-2 | IT-12 | Every function logs its duration | As stated |
| T-A11Y-1 | TS-3 | axe-core on each screen (Playwright): no contrast or label violations at 375 px and 1280 px; verdicts carry text, not colour alone | 0 violations |
| T-PIL-1 | TS-13 | Pilot harness with the model mocked: `--dry-run` reads all inputs and calls nothing; a run writes findings and emails to `pilot/out/` and a `runs.csv` with durations | As stated |
| T-PIL-2 | TS-13 | Read-test comparator: on a fixture outline vs a mocked reading with one node moved to another parent and one reworded, reports exactly those two misses | As stated |
| T-E2E-1 | All | Playwright, mocked: briefing → setup → context → key question (Not OK, then OK) → tree PDF (page picker) → unreadable → re-upload → Rework → revision → sign-off → record PDF downloaded | Completes; PDF downloaded |

## 3. Read test (real model calls; milestone 4; with Chris)

| ID | Check | Method | Pass mark |
| --- | --- | --- | --- |
| RT-1 | Read accuracy (PRD "Pre-launch read test") | `node scripts/read-test.mjs --yes` (without `--yes` it only prepares the inputs, at no cost): each of the nine trees in `calibration/private/trees/`, page from `expected.json`, through the browser extraction code and `read-tree`. Compare with `calibration/outlines/` | Every level 1 and level 2 node under the right parent, on all nine. Node-by-node misses reported with both versions, since the outline may be the one at fault |
| RT-2 | Stability | RT-1 run three times | Same result each time |
| RT-3 | Timing | Duration of every read call | All under 24 s |

## 4. Pilot checks (real model calls; with Chris)

`node scripts/pilot-run.mjs --dry-run` first, then `--yes`. Context: `calibration/context/peip-student-notes.md`. For each tree, Stage 1 on the key question and sub-questions in `expected.json`; for the five that pass, read and review. Outputs in `pilot/out/` (git-ignored): per tree a Markdown file with the Stage 1 findings and email, the outline, the Stage 2 findings and email; `verdicts.csv` (expected vs actual); `points.csv` (each `mustCatch` and `mustNot` with an empty column for Chris's judgement); `runs.csv` (duration, tokens, estimated cost per call).

| ID | Check | Pass mark |
| --- | --- | --- |
| P-1 | Stage 1 verdicts match `expected.json` | 9 of 9 |
| P-2 | Stage 2 verdicts match, on the five that pass Stage 1 | 5 of 5 |
| P-3 | Every `mustCatch` in the email; no `mustNot` (Chris judges from `points.csv`) | All. Misses go to Chris before any fix |
| P-4 | Sign-off samples: two revised trees (Chris to supply or approve) | Chris approves the draft prompt and both outputs before wiring (milestone 6) |
| P-5 | Timing: every call | None over 24 s; Stage 2 p95 under 20 s (else the split, spec §7.1); each email within about 60 s of Send |
| P-6 | Cost per run | Within Chris's per-term budget |
| P-7 | One student or TA runs the whole flow on a real brief | No blocking bug |
| P-8 | Holdout: trees from another case | Chris's call; before students use the tool (PRD open question) |

## 5. Where each test lives

Run `npm test` (vitest, `tests/unit/`) and `npm run e2e` (Playwright, `tests/e2e/`). Every model call is mocked. The read test and pilot are scripts that make real calls: `scripts/read-test.mjs`, `scripts/review-timing.mjs`, `scripts/sign-off-samples.mjs`, `scripts/pilot-run.mjs` (each a dry run without `--yes`).

| ID | File |
| --- | --- |
| T-BRF-1 | `briefing.test.jsx` |
| T-SET-1 | `setup.test.jsx`, `guard.test.mjs` |
| T-CTX-1..5 | `extract.test.js`, `context-screen.test.jsx`; real files in `private-fixtures.test.js` |
| T-DET-1..5 | `caseDetector.test.js`, `guard.test.mjs`, `tree-extract.test.js`; Sets A and B in `private-fixtures.test.js` |
| T-KQ-1..8 | `key-question-screen.test.jsx`, `key-question-function.test.mjs`, `record.test.js` (T-KQ-8) |
| T-TPL-1 | `tree-screen.test.jsx` (hidden while `public/Tree-Surgery-template.pptx` is absent; the shown case is checked once Chris adds the file) |
| T-UP-1..7, T-SHP-1..5 | `tree-extract.test.js`, `tree-screen.test.jsx` |
| T-READ-1..8 | `read-tree-function.test.mjs`, `outline.test.js`, `tree-screen.test.jsx` (T-READ-5 applies only if Q11 caps re-uploads; it doesn't today) |
| T-REV-1..6 | `review-flow.test.jsx`, `review-tree-function.test.mjs`, `model-call.test.mjs`, `key-question-screen.test.jsx` (retries) |
| T-EML-1..8 | `email-check.test.js`, `email-check-review.test.js`, `review-tidy.test.js`, `sign-off.test.mjs` |
| T-FLOW-1..3 | `review-flow.test.jsx`, `sign-off-flow.test.jsx` |
| T-SIGN-1..4 | `sign-off.test.mjs`, `sign-off-flow.test.jsx` |
| T-LOCK-1..3 | `record-screen.test.jsx`, `sign-off-flow.test.jsx` |
| T-PDF-1..4 | `record.test.js` |
| T-SAV-1..3 | `session.test.js`, `app.test.jsx`; a reload mid-run in `tests/e2e/full-run.spec.js` |
| T-ERR-1..2 | `error-codes.test.js`, `guard.test.mjs`, `setup.test.jsx`, `tree-extract.test.js`, `model-call.test.mjs` |
| T-SEC-1 | `security.test.mjs` (a fresh build and every function's responses) |
| T-SEC-2 | `model-call.test.mjs`, `key-question-function.test.mjs`, `review-tree-function.test.mjs` (findings sealed), `record.test.js` |
| T-TIME-1..2 | `model-call.test.mjs` |
| T-A11Y-1 | `tests/e2e/full-run.spec.js` (axe-core on every screen, WCAG 2.1 A/AA, and at 375 px) |
| T-PIL-1..2 | `pilot-run.test.mjs`, `outline.test.js` (the read-test comparator) |
| T-E2E-1 | `tests/e2e/full-run.spec.js` |

Not covered by automated tests: the Content Security Policy in `netlify.toml` (the e2e run uses the Vite dev server, which sends no CSP); check on the deploy preview, as Question Time did with `E2E_BASE_URL`.
