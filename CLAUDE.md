# Tree Surgery — build brief for Claude Code

Tree Surgery is a web app for HKUST consulting students (MGMT 5760 and GBUS 4910). Each student works alone. They upload or paste their client context, paste their team's key question, and get it checked by a fictional engagement manager (EM), Daniel Hart of Halden & Rowe (Stage 1). Once the key question is OK, they upload their issue tree as a PDF or PowerPoint file, and Daniel reviews the tree as read, with no correction step (Stage 2). A Pass ends the run; otherwise the student revises once and gets a sign-off. The student downloads a record PDF for Canvas.

It is Question Time's sibling. Same firm, same EM, same stack, same Netlify limits, same house style. **Reuse Question Time's code wherever it fits** (sibling folder `../Question Time App`): copy, then adapt. Don't import across folders.

Owner: Chris Doran (course instructor). British English everywhere: UI copy, prompts, code comments.

## Source of truth

1. `docs/prd.md`: Markdown export of the master PRD (a Claude Doc, "PRD — Tree Surgery", v1.0). Chris owns it and re-exports it for each release; never edit it here. It says what and why.
2. `docs/spec.md`: how. **You write it in milestone 0** from the PRD and this brief. Requirement IDs match the PRD's IT-1 to IT-12; add TS-n IDs for anything the spec adds.
3. `prompts/`: the runtime prompts. `stage1-key-question.md` and `stage2-tree-review.md` are calibrated: change wording only with Chris's agreement (see "Prompts" below). `persona.md` is Question Time's shared persona, prepended to every system prompt.
4. `schemas/`: JSON contracts between browser, functions and model. Validate every model output against them.
5. `config/`: app settings (models, limits, attempts, openers). Chris edits these without touching code.
6. `calibration/`: the nine PEIP trees, Chris's verdicts (`expected.json`), Claude's outlines of each tree, and a student-style context. Used by the pilot harness, the read test and acceptance. `calibration/private/` is student work: git-ignored, never committed.

## Stack

Copy Question Time's choices and pinned versions (`../Question Time App/package.json`):

- Vite + React 19 single-page app, published from `dist/`.
- Netlify Functions in `netlify/functions/`, ESM, current API (`export default async (req, context) => Response`), streaming where useful.
- `@anthropic-ai/sdk` on the server only. `ANTHROPIC_API_KEY` from Netlify environment variables, and from a git-ignored `.env` locally.
- Browser-side file handling: `pdfjs-dist` (PDF text, and rendering the chosen page to PNG), `jszip` (.pptx slide XML), `mammoth` (.docx context only).
- Record PDF built in the browser with `pdf-lib`.
- Tests: `vitest` for units; Playwright for one end-to-end run with the model calls mocked.

## What to reuse from Question Time

| Reuse (copy, then rename and trim) | Replace |
| --- | --- |
| `netlify/lib/anthropic.mjs` (client, streaming, timeout, duration log), `guard.mjs` (access code, size limits), `prompts.mjs` | QT's `review.mjs` and its five-part review |
| `shared/caseDetector.js`, `errorCodes.js`, `limits.js`, `schemaCheck.js`, `modelJson.js`, and `config/case-markers.json` | `shared/formatCheck.js` and `reviewParts.js` (QT-specific rules) |
| `src/extract/*` (PDF, text, office, context), `src/store/session.js` (autosave), components (`Header`, `Inbox`, `EmailView`, `StepBar`, `Footer`, `StorageWarning`, `ResumePrompt`, `FormErrors`) | QT's `DraftScreen`, `FeedbackScreen` and its review renderer |
| `ContextScreen` (context upload or paste, case detector, page caps, readable-text rule) | QT's team setup: Tree Surgery has one student, not a team |
| `src/styles/tokens.css`, `app.css` (Praxis tokens, Halden & Rowe style), `src/record/layout.js` | QT's record contents |
| `netlify.toml` (headers, CSP, functions settings), `docs/deploy.md`, `scripts/pilot-run.mjs` pattern, test helpers (`fakeAnthropic`, `storage`) | — |

## Layout

```
netlify/functions/   check.mjs          access code at setup; no model call
                     key-question.mjs   Stage 1: one call
                     read-tree.mjs      reads the uploaded tree into an outline: one call
                     review-tree.mjs    Stage 2 first review: one call (split if needed, see Hard constraints)
                     sign-off.mjs       sign-off after the revision: one call
netlify/lib/         anthropic.mjs  guard.mjs  prompts.mjs
shared/              caseDetector.js  errorCodes.js  limits.js  schemaCheck.js  modelJson.js  emailCheck.js
src/                 screens, inbox, context and tree extraction, autosave store, record PDF
prompts/ schemas/ config/   bundled into functions with included_files in netlify.toml
scripts/pilot-run.mjs      runs calibration/ through the real prompts for Chris to rate
calibration/               trees, expected verdicts, outlines, context
tests/                     unit and e2e tests; tests/test-plan.md lists them
```

## The flow (PRD "Scenario and user flow")

| Step | Screen | Model call |
| --- | --- | --- |
| 1 | Briefing email from Daniel (IT-1) | none |
| 2 | Setup: access code, name, student ID, course | none |
| 3 | Context: upload or paste, as in Question Time (IT-11) | none |
| 4 | Key question: paste it, plus optional first-level sub-questions; Daniel's Stage 1 email if Not OK; up to 3 attempts (IT-3) | `/api/key-question` |
| 5 | Tree upload: PDF or .pptx, page or slide picker (IT-4); template download (IT-2) | `/api/read-tree`, then `/api/review-tree` |
| 6 | Feedback: verdict and email (IT-6). Pass ends the run (IT-7) | — |
| 7 | Revision upload, once (IT-7) | `/api/read-tree`, then `/api/sign-off` |
| 8 | Record PDF; the tool locks for this run (IT-9, IT-10) | none |

## Hard constraints

- **Function wall clock.** Netlify stops this project's functions at about 26–30 seconds, streamed or not (Question Time spec D21); keep `functionBudgetSeconds` at 24. One model call per function invocation. Set `max_tokens` so each call finishes well inside the limit, and log every call's duration. If the Stage 2 review doesn't fit (p95 over 20 s in the pilot), split it into two calls, findings then email, driven by the browser, as Question Time does (D24).
- **No server-side storage.** No database or Netlify Blobs. All state lives in the browser (autosave to `localStorage`); the record PDF is the only lasting copy.
- **API key never reaches the browser.** Every function checks the access code (`TS_ACCESS_CODE`) before calling the model.
- **Internal findings never reach the browser.** The Stage 1 and Stage 2 prompts produce internal findings (Part A). The function keeps them server-side: they are dropped before the response, and written only by the pilot harness for Chris. The browser gets the verdict and the email. The sign-off call re-reads the first outline, the first email and the revised outline; it needs no hidden findings.
- **Case detector before any model call.** Run `shared/caseDetector.js` on the context in the browser and again in every function that receives it. A block is final.
- **One image, the tree.** Unlike Question Time, the tree page goes to the model as an image: the chosen PDF page rendered to PNG in the browser (long side about 2,000 px). For .pptx, extract each shape's text, position and size, and each connector's endpoints and connections (`stCxn`/`endCxn`), from the slide XML in the browser, and send that as text; no image. The context is text only, as in Question Time.
- **Prompts are server-side.** Functions load `prompts/*.md`; the browser never receives them.
- **Accessibility.** WCAG AA contrast, responsive down to phone width, nothing that depends on colour alone.

## Prompts

| Prompt | File | Status |
| --- | --- | --- |
| Stage 1: key question | `prompts/stage1-key-question.md` | Calibrated. Keep every section verbatim except Output (below) |
| Tree reading | `prompts/read-tree.md` | **Write it.** Input: the page image or the .pptx shapes and connectors, and the agreed key question. Output: an indented outline, key question as level 0, each node's text exactly as written; or `unreadable` with a reason (blurred scan, several trees on one page, not a tree). Don't fix, merge or reword nodes. Check it with the read test |
| Stage 2: first review | `prompts/stage2-tree-review.md` | Calibrated. Keep every section verbatim except Output (below) |
| Sign-off | `prompts/sign-off.md` | **Write it** from the PRD (Review rounds, sign-off verdicts, IT-8) and the Stage 2 prompt's rules. Show Chris the draft and two sample outputs before wiring it in |

**Output sections.** The calibrated prompts end with an Output section written for markdown (Part A findings, Part B email). Replace only that section with the JSON contract in `schemas/`, keeping the same content: the verdict, the findings table as an array, and the email (subject, opener, what works, numbered questions or pointers, optional P.S.). Bump each edited prompt's version line. Everything above the Output section stays word for word.

**Email check** (`shared/emailCheck.js`, replaces QT's formatCheck): the opener matches the verdict's line exactly (`config/app.json`); First cut or Rework has 3–5 numbered questions, one question each with at most one follow-up; Pass has no numbered questions and at most two pointers; about 200 words (Stage 2) or 120 (Stage 1). On failure, regenerate (max 2), as in Question Time.

## Config (`config/app.json`)

Start from Question Time's. Tree Surgery adds:

```json
{
  "appName": "Tree Surgery",
  "appVersion": "1.0",
  "models": {
    "keyQuestion": { "model": "claude-opus-5-5", "maxTokens": 900, "effort": "low" },
    "readTree":    { "model": "claude-opus-5-5", "maxTokens": 1500, "effort": "low" },
    "reviewTree":  { "model": "claude-opus-5-5", "maxTokens": 2000, "effort": "low" },
    "signOff":     { "model": "claude-opus-5-5", "maxTokens": 1600, "effort": "low" }
  },
  "functionBudgetSeconds": 24,
  "keyQuestionMaxAttempts": 3,
  "treeRevisions": 1,
  "openers": {
    "keyQuestion": "The key question needs rethinking. Send back to me when you have reworked the tree with a new question.",
    "firstCut": "The first cut needs rethinking. Send back to me when you have reworked it.",
    "rework": "Good start, but the tree needs some rework. Send back to me for a quick check when done.",
    "pass": "Well structured tree. Go ahead and use this to develop the workplan.",
    "signedOff": "Signed off. Use this to develop the workplan.",
    "notThereYet": "Not there yet. Take what's left to the team session."
  }
}
```

Token limits are starting points: tune them in the pilot so every call ends inside the budget.

## Build order

Finish each milestone with passing tests before starting the next. Stop where marked and wait for Chris.

0. **Spec.** Read `docs/prd.md`, the prompts, `calibration/README.md` and Question Time's `CLAUDE.md`, `docs/spec.md` and code. Write `docs/spec.md` and `tests/test-plan.md`. List every assumption and question. **Stop for Chris.**
1. **Scaffold:** copy Question Time's scaffold (Vite + React, `netlify.toml`, functions skeleton with access-code guard, app shell, autosave store, footer disclaimer). Rename everything to Tree Surgery; strip QT-only parts.
2. **Intake:** briefing email, setup (one student), context screen reused from Question Time.
3. **Stage 1:** key question screen, `/api/key-question`, schema, email check, attempts cap, the Stage 1 email in the inbox.
4. **Tree upload and reading:** file picker, page or slide picker, PDF page render, .pptx shape and connector extraction, `/api/read-tree`, unreadable handling with a re-upload that doesn't use up the revision. Write `prompts/read-tree.md` and run the **read test** (below). **Stop for Chris** with the read-test results.
5. **Stage 2:** `/api/review-tree`, schema, email check, regeneration, verdict opener; Pass ends the run.
6. **Revision and sign-off:** second upload and read, `prompts/sign-off.md` (draft and samples to Chris first), `/api/sign-off`, sign-off openers.
7. **Record PDF and lock:** IT-10 contents; the tool locks after a Pass or a sign-off.
8. **Pilot harness and tests:** `scripts/pilot-run.mjs` over `calibration/` (real model calls only when Chris asks), everything in `tests/test-plan.md`.
9. **Deploy:** as Question Time (`docs/deploy.md`): Netlify site, `ANTHROPIC_API_KEY` and `TS_ACCESS_CODE`, custom domain so mainland-China students can reach it.

## Read test (milestone 4, PRD "Pre-launch read test")

Run `read-tree` on the nine trees in `calibration/private/trees/` (the page in `expected.json`). Compare with `calibration/outlines/`: every level 1 and level 2 node must sit under the right parent. Report node-by-node misses. The outlines are Claude's transcriptions, so a disagreement may be the outline's fault: show Chris both.

## Definition of done (v1)

- Every v1 requirement in `docs/spec.md` passes its test in `tests/test-plan.md`.
- The read test passes on all nine trees.
- **Calibration, generic mode:** with `calibration/context/peip-student-notes.md` as the context, the pilot run matches `expected.json` on all nine trees: the Stage 1 verdict for each, the Stage 2 verdict for the five that pass Stage 1, every `mustCatch` point in the email, and no `mustNot`. Report misses to Chris before fixing anything: each is a prompt or rule question for him.
- No function call exceeds 24 s in the pilot logs; each email arrives within about 60 s.
- The record PDF opens, prints on A4, and contains no prompt text or internal findings.
- The case detector blocks every test case PDF and none of the test briefs (reuse Question Time's tests).

## Changing the app: PRD updates

Same process as Question Time: the PRD is the master; every change starts there and reaches the code as a small, targeted update. Run `/prd-update` after Chris commits a new `docs/prd.md` on a branch `prd-vX.Y`. Classify each change (prompt, config, schema, flow, architecture), show Chris a table of IT ID, change, files and tests, and wait for confirmation. Then update `docs/spec.md` for the affected IDs only, tests first, the smallest change, run everything, bump `appVersion` and any edited prompt version, commit "PRD vX.Y: <summary> (IT-n, …)", push the branch and give Chris the deploy-preview link. Don't deploy prompt changes while an assignment is running.

## Assumptions to confirm with Chris in milestone 0

1. Folder and repo: `Tree Surgery`, beside `Question Time App`; a new private GitHub repo and its own Netlify site.
2. Access code `TS_ACCESS_CODE`, separate from Question Time's.
3. The key question box takes optional first-level sub-questions, because Stage 1 accepts a broad key question when a sub-question carries the target.
4. The agreed key question is the root for the review. If the uploaded tree's root differs, Daniel reviews against the agreed key question and notes the mismatch.
5. A .pptx tree has no page image in the record (no in-browser PowerPoint renderer); the appendix outline stands in for it.
6. Template download (IT-2): Chris supplies his one-page issue tree template as `public/Tree-Surgery-template.pptx`. Until then, the download is hidden.
7. Caps: context as Question Time (10 pages or 5,000 words pasted); tree file 20 MB, up to 25 pages or slides to pick from.
