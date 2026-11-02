# Tree Surgery: v1 functional spec

Derived from "PRD — Tree Surgery" v1.0 (`docs/prd.md`, 2 Nov 2026), the build brief (`CLAUDE.md`) and Question Time's spec (QT D1–D24), whose scaffold this app reuses. Requirement IDs IT-1 to IT-12 match the PRD; TS-n IDs are added by this spec. v1 is generic mode only. Decisions are in §14, open questions for Chris in §15.

**Status:** Chris answered Q3, Q4, Q6, Q7, Q8 and Q10 on 2 Nov 2026 (recorded in §14 as D15–D20). The other questions in §15 are still open; the build follows the proposed defaults until Chris says otherwise.

## 1. What the student experiences

One student, working alone. Expect about 30–45 minutes of the student's time, most of it building the tree offline between steps 4 and 5 (verify in pilot P-7).

| Step | Screen | What happens | Model call |
| --- | --- | --- | --- |
| 1 | Briefing | Daniel's briefing email (IT-1) and one button, **Set up →** | none |
| 2 | Setup | Access code, name, student ID, course, client or project name (TS-1) | `/api/check` (no model) |
| 3 | Context | Required. Upload or paste the client context, as in Question Time (IT-11) | none |
| 4 | Key question | Paste the key question and optional first-level sub-questions; **Send to Daniel**. Not OK: Daniel's Stage 1 email; re-enter, 3 attempts per round; after a third Not OK the student goes away to rework it and comes back later with a new key question (IT-3, D16). OK: Daniel's short "agreed" email (TS-8) | `/api/key-question` |
| 5 | Tree | Template download (IT-2); upload one PDF or .pptx; pick the page or slide (IT-4); **Send to Daniel** | `/api/read-tree`, then `/api/review-tree` |
| 6 | Feedback | Daniel's first review, opening with its verdict (IT-6). Pass ends the run (IT-7) | none |
| 7 | Revision | Upload the revised tree, once (IT-7); then Daniel's sign-off (IT-8) | `/api/read-tree`, then `/api/sign-off` |
| 8 | Record | Download the record PDF for Canvas; the run is locked (IT-9, IT-10) | none |

The step bar shows Briefing · Setup · Context · Key question · Tree · Feedback · Revision · Record. A run that passes at step 6 skips Revision (shown as "Not needed").

UI pattern (Common Module, as Question Time): firm-style header (Halden & Rowe · Tree Surgery · client name · student name), inbox on the left (Daniel's emails, plus "Your task"), reading pane or step screen on the right. Praxis tokens, IBM Plex Sans and Mono, copied from Question Time's `tokens.css` and `app.css`. Every screen carries the footer:

> [COURSE] practice tool. Feedback is AI-generated; you remain responsible for your work.

## 2. Briefing email (IT-1)

The first screen of every run; it stays in the inbox. The app writes subject, greeting and signature. Draft wording (from the PRD's flow, step 2; **Chris to confirm**, Q1):

> **Subject:** Your issue tree: key question first
>
> Hi [first name — "Hi," before setup],
>
> Before the team problem-solving session, I want each of you to draft your own issue tree on the key question the team agreed.
>
> Send me your key question first, with your first-level sub-questions if they carry the target. Once we've agreed it, send me your draft issue tree before the team session: one page, in our template, to four levels below the key question, with the agreed key question at the root.
>
> Attach the client brief or your notes too, so I can see the client's situation.
>
> Daniel
>
> Daniel Hart | Engagement Manager | Halden & Rowe

Before setup there is no name, so the greeting is "Hi," and the briefing re-renders with the name afterwards. Button: **Set up →**.

## 3. Setup (TS-1)

| Field | Rule |
| --- | --- |
| Access code | Required. Checked at once by `POST /api/check` and again by every function against `TS_ACCESS_CODE`; 401 gives "That access code isn't recognised. Check Canvas." (TS-S02) |
| Name | Required, 60 characters or fewer, in English letters as on Canvas (QT D12) |
| Student ID | Required, free text, 20 characters or fewer |
| Course | Dropdown: `MGMT 5760`, `GBUS 4910` |
| Client or project name | Required, 60 characters or fewer. Used in the header, email subjects and the record (Q2) |

Generate an attempt ID (8 characters, base32) and a start time. Keep `mode: "generic"` and `caseId: null` in the session and in every request, for case mode later. No case picker.

## 4. Context (IT-11)

Copied from Question Time (QT spec §3, §4) with the same rules, messages and codes (renamed TS-…):

- Required: **Continue** stays disabled until a file or pasted note is added.
- .pptx, .docx, PDF or paste; 10 pages and 10 MB in total; paste 5,000 words or fewer (500 words a page).
- Checks in order: type, size, open, page cap, readable text, case detector. Nothing kept from a file that fails.
- Required checkbox: "I confirm this material may be shared with an AI tool. If it comes from a client, I have checked our NDA allows it." (singular "I": one student). Printed on the record.
- Page markers `[[p.N]]`, numbered across files, with a line naming each file (QT D1).
- Panel copy: "Upload your client brief, kick-off notes or your own notes. **Context: up to 10 pages.** Do not upload a case PDF. Publisher terms bar case text from AI tools, and the app will block it."

The EM reads the context for the client's situation only (IT-11); the prompts already say so.

## 5. Stage 1: key question (IT-3)

### 5.1 Screen

- **Your key question** (required, one text box, 400 characters or fewer).
- **First-level sub-questions** (optional): up to 5 rows, 300 characters each, with "Add a sub-question". Hint: "Add them only if a sub-question carries your number and date."
- **Send to Daniel** (confirmation not needed). Attempt counter: "Attempt 1 of 3".
- While waiting: "Daniel is reading your key question…" with elapsed seconds.

### 5.2 Call

`POST /api/key-question` with `{ keyQuestion, subQuestions[], context: { text, pageCount }, attempt, previousErrors?, mode, caseId }`. The function assembles:

```
<key_question>…</key_question>
<sub_questions>
1. …
</sub_questions>            (or "None")
<context>…</context>
<previous_errors>…</previous_errors>   (regeneration only)
```

System prompt: `persona.md` + `stage1-key-question.md`. Model output: JSON per `schemas/key-question.schema.json` (§10). The function validates it, runs the email check, drops the findings and returns only `{ verdict, email }` (TS-5, §9).

### 5.3 Outcomes

- **Not OK:** Daniel's email appears in the inbox and above the form on the key question screen. The opener is exactly `openers.keyQuestion`. The screen keeps the student's last text for editing and shows "Attempt 2 of 3".
- **OK:** the app adds Daniel's short "agreed" email (TS-8, wording from `config/app.json` `emails.keyQuestionOk`; Chris's wording, D15):

  > **Subject:** Re: your key question
  > Hi [first name], That Key Question will work to structure the tree. Daniel

  The agreed key question and sub-questions are frozen in the session, and the Tree step opens.
- **Third Not OK in a round** (`keyQuestionMaxAttempts`, 3; D16): the student is sent away to rework it. The tree upload stays locked and the key question form closes, with: "Daniel has sent this back three times. Rework your key question, with your team if you can, and come back when you have a new one." The run is **not** ended or locked: it stays saved in the browser. A button, **I have a new key question**, opens a new round of 3 attempts. Every attempt in every round, and each email, is kept and printed on the record. Rounds are not capped.

## 6. Tree upload and reading (IT-2, IT-4, IT-5)

### 6.1 Template (IT-2)

A **Download the template** link to `/Tree-Surgery-template.pptx`, shown only if the file exists in `public/` (checked by a `HEAD` request at build time via a Vite define, so no runtime 404). Until Chris supplies it, the link is hidden (assumption 6).

### 6.2 Upload checks

Panel copy:

> Upload your tree as one PDF or PowerPoint (.pptx) file. **Up to 25 pages or slides, 20 MB.** If it has several pages, you'll pick the one with the tree. Use one page for the whole tree, with the agreed key question at the root. Daniel reads the tree as it stands: there is no chance to correct his reading, so keep the text in boxes and the lines clear.

Checks in order, in the browser (reusing QT's `processFile` steps where they apply):

1. **Type.** PDF or .pptx. .ppt: re-save message (TS-U02). .docx and anything else: TS-U01 ("… isn't a PDF or .pptx file. Export your tree to PDF, or save it as .pptx, and upload again.").
2. **Size.** `treeMaxMB` 20 MB (TS-U03).
3. **Open.** pdf.js legacy build (QT D18) or jszip. Password-protected PDF: TS-U08. Other failures: TS-U07 with the error name.
4. **Page cap.** `treeMaxPages` 25 (TS-U04).
5. **Picker.** One page or slide: chosen automatically. Several: a grid of radio choices. PDF: a thumbnail of each page with its number. .pptx: the slide number and its first 80 characters of text (no thumbnails, assumption 5). Default selection: none; **Send to Daniel** is disabled until one is chosen (one button: the chosen page is prepared, checked and sent).
6. **Something to read** (replaces the readable-text rule, TS-9): a PDF page always passes (it is read as an image; a scan is allowed). A .pptx slide must yield at least `treeMinShapes` (5) text shapes, or a SmartArt diagram, or a single embedded PNG/JPEG picture (§6.4); otherwise TS-U09: "We couldn't find a tree on slide N. Check you picked the right slide, or export the slide to PDF and upload that."
7. **Case detector** on the slide text (.pptx) or the page's text layer (PDF, if any), as for the context (TS-U06).
8. **PDF text layer** (D19): the chosen page's text items, if any, are kept with their positions for the read call (§6.3).

Every refusal is added to `blockedUploads` (time, stage `tree` or `revision`, code).

### 6.3 PDF page to image

The chosen page is rendered with pdf.js to a canvas, long side `treeImageLongSide` (2,000 px), white background, then encoded as PNG. If the PNG exceeds `treeImageMaxBytes` (3.5 MB), it is re-encoded as JPEG at quality 0.9, then 0.8 (TS-10). Fonts must render, so this path loads pdf.js with fonts enabled (unlike QT's text-only `extractPdf`). A second copy, JPEG at 1,600 px and quality 0.85, is kept in the session for the record (§11) and resume; the full-size image is sent once and not stored.

**Text layer (D19).** Many PDFs exported from PowerPoint carry text with positions. pdf.js `getTextContent()` on the chosen page gives each text item and its transform; items on the same baseline are merged into lines and sent with the image as `<page_text>`, one line each: `"How can PEIP …?" x=… y=… w=… h=…`, in PDF points from the top-left. A scanned page has no text layer, so only the image is sent. The read prompt tells the model to take exact wording from the text layer and structure (boxes and lines) from the image, and to trust the image where they disagree. Capped at `treeShapesMaxChars`.

### 6.4 .pptx slide to shapes text

Read from the slide XML with jszip, in EMU converted to points (÷ 12,700) and rounded:

- **Shapes** (`p:sp` with text): id, text (paragraphs joined with " / "), x, y, width, height, and rotation if any. Group shapes (`p:grpSp`) are flattened by applying each group's `a:off`/`a:ext`/`a:chOff`/`a:chExt` transform, so positions are slide coordinates (`good.pptx` uses groups).
- **Lines**: connectors (`p:cxnSp`) and line shapes (`p:sp` with `prstGeom prst="line"` or any `*Connector*` preset), each with start and end points (from the frame and `flipH`/`flipV`), and `stCxn`/`endCxn` shape ids when present. The calibration set has connectors with no connections (`g2.pptx`, elbow connectors) and plain lines (`good.pptx`), so geometry is always sent, not only connections.
- **SmartArt** (`graphicData` of type diagram, as in `g5.pptx`): read the diagram data part (`ppt/diagrams/dataN.xml`): its points' text and `parOf` connections give the hierarchy directly, sent as a nested list marked "[from a SmartArt diagram]". The drawing part's positions are not needed.
- **Picture-only slide**: if the slide has no text shapes and one embedded PNG or JPEG image covering most of the slide, that image is sent instead, as for a PDF page (§6.3). EMF/WMF pictures are refused with TS-U09.
- Tables: cell text in row order, marked "[table]". Charts and think-cell objects are ignored.

The result is a plain-text block (`<slide_shapes>`), at most `treeShapesMaxChars` (40,000 characters). Format:

```
Slide 1, 960 × 540 pt
S12 "How can PEIP …?" x=20 y=240 w=150 h=60
…
L3 from (170,270) to (200,120) start=S12 end=S15
L4 from (170,270) to (200,400)             (no connection)
```

### 6.5 Read call (IT-5)

`POST /api/read-tree` with `{ round: "first"|"revision", keyQuestion, tree: { kind: "pdf"|"pptx", page, image?: { mediaType, base64 }, pageText?: string, shapes?: string }, mode, caseId }`. The function sends the image as an image content block with `<page_text>` when the page has a text layer, or the shapes as text, plus `<agreed_key_question>`. System prompt: `persona.md` is **not** prepended (this is a transcription task, not Daniel's voice; TS-11) — `read-tree.md` only. Output: `schemas/read-tree.schema.json` (§10.3).

- **Read:** the outline (nodes with levels) is stored in the session. It is not shown on screen; it is printed in the record appendix (PRD: "which only the EM sees"; Q5). The app goes straight on to the review call.
- **Unreadable:** the app adds Daniel's in-world email (TS-12), from `config/app.json` `emails.unreadable` plus the reason sentence for the model's `reason` code:

  | `reason` | Sentence |
  | --- | --- |
  | `blurred` | "The page is too blurred to read the boxes." |
  | `several_trees` | "There's more than one tree on the page, so I can't tell which is yours." |
  | `not_a_tree` | "I can't see an issue tree on that page." |
  | `too_small` | "The text is too small to read." |
  | `other` | "I can't follow the structure on that page." |

  > **Subject:** Re: your issue tree — can't read it
  > Hi [first name], I can't read the tree you sent. [sentence] Send it to me again as one clear page, in our template. Daniel

  The student uploads again. This does not use up the revision (IT-5) and has no cap, but each unreadable result is counted and printed on the record.
- **Root check:** the model returns the root as written. If it differs materially from the agreed key question (the model judges; wording changes of a few words are not material), the review call adds a transcription note: `[Transcription note: the root on the page reads "…", which differs from the agreed key question.]` (assumption 4). The calibrated Stage 2 prompt already treats square-bracket text as transcription notes, so no prompt wording changes.

## 7. Stage 2: first review (IT-6, IT-7)

`POST /api/review-tree` with `{ keyQuestion, subQuestions, outline, rootNote?, context: { text, pageCount }, attempt, previousErrors?, mode, caseId }`. User message:

```
<key_question>…</key_question>
<tree_outline>
KEY QUESTION (level 0): …
[Transcription note: …]          (if any)
1. …
   1.1 …
</tree_outline>
<context>…</context>
<previous_errors>…</previous_errors>
```

System prompt: `persona.md` + `stage2-tree-review.md` (Output section replaced by the JSON contract, §10.2). The function validates, runs the email check, drops the findings, and returns `{ verdict, email }`.

- Verdicts: `first_cut`, `rework`, `pass`. The email opens with the exact opener from `config/app.json` (`openers.firstCut`, `openers.rework`, `openers.pass`).
- **Pass:** the run ends; the Record step opens and the run locks (IT-7, IT-9).
- **First cut or Rework:** the Revision step opens: "Revise your tree and upload it once more. Daniel will sign it off." (IT-7)

### 7.1 Time budget and the split fallback (IT-12)

One call, `models.reviewTree.maxTokens` 2000, `effort: "low"`. At about 100 tokens a second that is about 20 s, close to the 24 s budget. The pilot (P-5) logs every call. If its p95 exceeds 20 s, the review is split in two browser-driven calls, as Question Time did (QT D24): `part: "findings"` (verdict and findings table, kept server-side in the pilot only — see TS-5) and `part: "email"`. Because the browser must not receive findings, the split version passes them between calls encrypted with a server-held key (AES-GCM, key from `TS_FINDINGS_KEY`), so the browser carries an opaque token it can't read (D7). This is built only if the pilot needs it.

## 8. Revision and sign-off (IT-7, IT-8)

- One revised upload, with the same checks, picker and read as §6. An unreadable revision gets the §6.5 email and a re-upload; it does not use up the revision.
- The revision is read against the same agreed key question.
- `POST /api/sign-off` with `{ keyQuestion, firstOutline, firstEmail, firstVerdict, revisedOutline, rootNote?, context, attempt, previousErrors?, mode, caseId }`. User message tags: `<key_question>`, `<first_outline>`, `<first_review>` (verdict and email as rendered), `<revised_outline>`, `<context>`. It needs no hidden findings (CLAUDE.md).
- System prompt: `persona.md` + `sign-off.md` (written in milestone 6 from the PRD's review rounds and the Stage 2 rules; draft and two sample outputs to Chris before wiring).
- Verdicts: `signed_off` or `not_there_yet`, with openers `openers.signedOff` and `openers.notThereYet`.
- Email content (IT-8): what improved; what still fails, each named plainly by its test or symptom; the lower-level points held back from the first review; one lesson for next time. Direct, not Socratic.
- After the sign-off the run ends and locks (IT-9).

## 9. Model output handling (TS-5, TS-6)

All four model functions follow one pattern, different from Question Time's pass-through stream, because internal findings must never reach the browser:

1. Guard: method, access code, size limits, case detector (§12).
2. One model call, streamed from Anthropic into a server-side buffer. The response to the browser is NDJSON: `meta`, then `ping` every `keepAliveSeconds` (5) while the model works (QT D20), then **one** final event. No `text` events are sent.
3. On `message_stop`: parse the JSON (`shared/modelJson.js`), fill omitted empty fields (as QT D23), validate against the schema, run the email check (`shared/emailCheck.js`, not for read-tree).
4. Final event:
   - `{ type: "result", verdict, email, promptVersion, servedBy, durationMs }` — the findings array is deleted from the object before serialising. For read-tree: `{ type: "result", status, outline?, rootAsWritten?, rootDiffers?, reason? }`.
   - `{ type: "invalid", errors: [...] }` — JSON, schema or email-check failure. The errors describe the email's form only (eg "Question 3 contains two question marks"); they never quote findings.
   - `{ type: "error", error, message }` — timeout, truncated, refusal, model error (as QT).
5. The browser retries on `invalid` with `attempt + 1` and `previousErrors`, up to `emailMaxAttempts` (3: the first plus 2 regenerations), and on a retryable `error` the same way. After the last attempt: TS-S04 (format) or the call's own code, with **Ask Daniel again**.

`scripts/pilot-run.mjs` calls the same core functions in `netlify/lib/stages.mjs` in-process and writes the findings to `pilot/out/` for Chris. The deployed handlers wrap those cores and strip findings; a test asserts no handler response contains a `findings` key or any finding text (T-SEC-2).

### 9.1 Email check (`shared/emailCheck.js`, TS-6)

Replaces QT's `formatCheck.js`. Word counts cover the opener, "what works", questions or points, pointers and P.S.; subject, greeting and signature are excluded. Limits live in `config/app.json` `emailCheck`. Chris set a hard ceiling of 250 words on every email, so each call stays inside the time cap (D17):

| Email | Rule |
| --- | --- |
| All | `opener` equals the verdict's opener in `config/app.json` exactly (after trimming and normalising curly quotes and dashes) |
| Stage 1 Not OK | 1–5 `points`; 60–170 words (target about 120) |
| Stage 1 OK | `email` is null |
| Stage 2 First cut / Rework | 3–5 `questions`; each `question` has exactly one "?" and ends with one; `followUp` optional, at most one "?"; no `pointers`; 120–250 words (target about 200) |
| Stage 2 Pass | 0 `questions`; 0–2 `pointers`; 40–200 words |
| Sign-off | `improved` non-empty; `stillFails` 0+ items (non-empty for `not_there_yet`, empty for `signed_off`); `heldPoints` 0–4; `lesson` one sentence; 100–250 words |
| All | `whatWorks` is one sentence (Stage 1: may be empty); `ps` optional, one or two sentences |

## 10. Schemas (`schemas/`)

JSON Schema 2020-12, validated with ajv in the functions (and in the tests). The calibrated prompts' Output sections are replaced by these contracts with the same content (CLAUDE.md "Output sections"); each edited prompt's version line goes to 1.1.

### 10.1 `key-question.schema.json`

```json
{
  "verdict": "ok | not_ok",
  "findings": [{ "test": "smart|one_question|no_overlap|open|clear_words", "result": "pass|fail", "evidence": "string" }],
  "email": null | {
    "subject": "string",
    "opener": "string",
    "whatWorks": "string (may be empty)",
    "points": ["string", "… one per failed test, worst first"]
  }
}
```

`findings` has exactly the five tests. `email` is null if and only if `verdict` is `ok`.

### 10.2 `tree-review.schema.json`

```json
{
  "keyQuestionCheck": "string (sound / weak, one line)",
  "verdict": "first_cut | rework | pass",
  "verdictReason": "string",
  "findings": [{ "n": 1, "level": "0-4 | whole tree", "test": "string", "finding": "string", "inEmail": true }],
  "email": {
    "subject": "string",
    "opener": "string",
    "whatWorks": "string",
    "questions": [{ "question": "string", "followUp": "string|null" }],
    "pointers": ["string"],
    "ps": "string|null"
  }
}
```

### 10.3 `read-tree.schema.json`

```json
{
  "status": "read | unreadable",
  "reason": "blurred | several_trees | not_a_tree | too_small | other | null",
  "rootAsWritten": "string|null",
  "rootDiffers": "boolean",
  "outline": "one node per line: \"<level> <text exactly as written>\"",
  "notes": ["string (transcription notes, eg illegible word)"]
}
```

The outline is compact lines rather than an array of objects, so a 90-node tree (as `g5`) fits in about half the output tokens (D21). The function parses it into nodes `{ level, text }`, which go to the browser. Nodes are in reading order (depth first). The first node is level 0; each next node's level is at most one deeper than the one before (checked in code, not only by schema). Illegible words are written as `[illegible]`. The app renders the outline in the calibration format (`KEY QUESTION (level 0): …`, `1.`, `1.1`, then `-` bullets indented by level), which the review and sign-off prompts receive.

### 10.4 `sign-off.schema.json`

```json
{
  "verdict": "signed_off | not_there_yet",
  "email": {
    "subject": "string", "opener": "string",
    "improved": ["string"], "stillFails": ["string"], "heldPoints": ["string"],
    "lesson": "string", "ps": "string|null"
  }
}
```

Final shape fixed in milestone 6 with the prompt.

### 10.5 Rendering

The app adds the greeting ("Hi [first name],"), the sign-off ("Daniel") and the signature block; the model writes subject and body (as QT's assumption 5). The prompts' Output sections say so. Questions render as a numbered list, each with its follow-up in the same item; pointers and points as bullets; P.S. last, before the sign-off. The verdict opener is the first paragraph, in bold. Nothing depends on colour alone.

## 11. Record PDF (IT-10)

Built in the browser with pdf-lib, A4, Helvetica (QT D12), Question Time's `layout.js`, footer disclaimer on every page.

1. **Header:** tool, course, client or project, student name and ID, attempt ID, started and finished, context files (names and page counts), upload confirmation, blocked uploads (time, stage, code), unreadable uploads (count), outcome (eg "Stage 1 agreed on attempt 2 · First review: Rework · Sign-off: Signed off"), app version, prompt versions, model(s) that answered.
2. **Key question:** each attempt's key question and sub-questions, grouped by round, with Daniel's Stage 1 email after each Not OK, and the "agreed" email.
3. **First tree:** the file name and page, the page image (PDF and picture-only .pptx), fitted to the page width; for a .pptx with no image, "PowerPoint slide: see Daniel's reading in the appendix" (assumption 5).
4. **First review:** Daniel's email as rendered.
5. **Revised tree** and **sign-off** (if any), as 3 and 4.
6. **Appendix: Daniel's reading of each tree**, the outline exactly as sent to the review, with any transcription notes.

Never: prompt text, internal findings, the context text, the slide shapes text. File name: `<COURSE>_TreeSurgery_<Name>_<AttemptID>.pdf`, spaces removed, characters outside A–Z, a–z, 0–9, `_`, `-` stripped.

## 12. Functions: common rules

| Function | Model call | Body limit | Notes |
| --- | --- | --- | --- |
| `POST /api/check` | none | — | 204 or 401 |
| `POST /api/key-question` | `models.keyQuestion` | 1 MB | |
| `POST /api/read-tree` | `models.readTree` | `readTreeMaxBytes` 5 MB | Netlify's synchronous request limit is 6 MB |
| `POST /api/review-tree` | `models.reviewTree` | 1 MB | |
| `POST /api/sign-off` | `models.signOff` | 1 MB | |

- Guard order (QT §10): method, access code (`X-TS-Access-Code` header vs `TS_ACCESS_CODE`, timing-safe), declared and actual size, JSON shape, text limits (context ≤ 60,000 characters; key question ≤ 400; each sub-question ≤ 300, at most 5; outline ≤ 12,000; shapes ≤ 40,000; email text ≤ 4,000), then the case detector on every text field (context, key question, sub-questions, shapes, outlines). 422 `case_blocked` on a match.
- One model call per invocation; budget `functionBudgetSeconds` (24); keep-alive pings; system prompt cached (`cache_control`); `effort` and `fallbacks: "default"` (QT D10) from config.
- Log only: endpoint, round, duration, input and output tokens, attempt, outcome, error code, and for TS-S01 the missing variable name. Never student content, never findings.
- Prompts load from `prompts/` (bundled with `included_files`); the browser receives only prompt versions.
- Errors: 400 bad request; 401 (TS-S02); 413; 422 (TS-U06); 500 `server_misconfigured` (TS-S01); 502 model error; 504 or a final `error` event for timeout (TS-S03).

### 12.1 Error codes (TS-4)

QT's codes renamed `TS-`, plus TS-U09:

| Code | When |
| --- | --- |
| TS-U01 | File type not accepted |
| TS-U02 | Older .ppt or .doc |
| TS-U03 | Over the size limit |
| TS-U04 | Over the page cap |
| TS-U05 | Context: no readable text |
| TS-U06 | Case detector block (browser or server) |
| TS-U07 | File couldn't be opened (plus the error name) |
| TS-U08 | Password-protected PDF |
| TS-U09 | No tree found on the chosen slide (§6.2 step 6) |
| TS-S01 | Server not configured (`TS_ACCESS_CODE` or `ANTHROPIC_API_KEY` missing) |
| TS-S02 | Access code not recognised |
| TS-S03 | Daniel timed out |
| TS-S04 | Daniel's reply failed the checks after its retries |
| TS-S05 | Any other failure reaching Daniel |

An unreadable tree (§6.5) is an in-world email, not an error code.

## 13. Autosave, lock and runs (TS-2, IT-9)

- The session lives in `localStorage` key `ts.v1.session` (`SESSION_VERSION` 1), saved after every step and on edits (debounced 1 s), with the resume prompt, storage warning and try/catch as QT §9. Stored tree images are the 1,600 px JPEG copies (§6.3), so a full run stays well under browsers' ~5 MB `localStorage` allowance; a failed save shows the storage warning.
- **Lock (IT-9), a loose lock (D18):** after a Pass or a sign-off, the session is marked `endedAt` and `locked: true`. A locked run shows only the inbox and the Record screen: no further uploads or calls. There is no server, so the lock lives in the browser; clearing site data or using another browser starts afresh, which Chris accepts. Each run has its own attempt ID, so repeat runs show on Canvas. A third Stage 1 Not OK does not lock (D16).
- **New run:** the Record screen offers **Start a new run (another case)**, with a confirmation, starting from the briefing with setup filled in (QT T-RUN-1), for the final case (China).
- Function calls do not carry the attempt ID: nothing is stored server-side, and the logs don't need it.

## 14. Decisions (build defaults; Chris to confirm in §15)

| ID | Decision |
| --- | --- |
| D1 | Folder `Tree Surgery App` beside `Question Time App` (the brief says `Tree Surgery`; the actual folder name has "App", matching Question Time's). New private GitHub repo `tree-surgery`, its own Netlify site. |
| D2 | `TS_ACCESS_CODE`, separate from Question Time's. Header `X-TS-Access-Code`. |
| D3 | The key question box takes optional first-level sub-questions (up to 5). |
| D4 | The agreed key question is the review's root; a differing root on the page goes to the review as a transcription note (§6.5). |
| D5 | The lock is per run, in the browser (§13). |
| D6 | Findings never leave the server: functions buffer the model's output and return only verdict and email (§9). The visible cost: the student sees no streaming text, only a progress line with elapsed seconds. |
| D7 | If the pilot forces a split Stage 2 review, findings pass between the two calls as an encrypted token (§7.1). Built only if needed. |
| D8 | Tree page image: PNG at 2,000 px long side, JPEG fallback over 3.5 MB; a 1,600 px JPEG kept for the record. To confirm in milestone 4 against the model's current image limits (very large images are downscaled by the API, so 2,000 px may give no gain over about 1,600). |
| D9 | .pptx: shapes, lines and connectors by geometry, groups flattened, SmartArt by its data model, picture-only slides sent as an image (§6.4), because the nine calibration trees use all of these. |
| D10 | `read-tree` runs without Daniel's persona (a transcription task) and without the context. It receives the agreed key question only to help find the root, and must not change node wording to match it. |
| D11 | The model writes subject and body; the app writes greeting, "Daniel" and signature (as QT). |
| D12 | Email check limits as §9.1; regeneration up to 2 times (3 attempts). |
| D13 | The pilot harness renders PDF pages in Node with `@napi-rs/canvas` (dev dependency only), so the read test uses the same image size as the browser. |
| D14 | Record file name uses the student's name: `MGMT5760_TreeSurgery_ChrisDoran_AB3CD7EF.pdf`. |
| D15 | Chris, 2 Nov 2026 (Q3). Stage 1 OK gets an app-written email: "That Key Question will work to structure the tree." |
| D16 | Chris, 2 Nov 2026 (Q4). After three Not OK attempts the student is sent away to rework and comes back later with a new key question: a new round of 3 attempts, rounds uncapped; the run is not ended or locked (§5.3). |
| D17 | Chris, 2 Nov 2026 (Q6). Hard ceiling of 250 words on every email, to stay under the 26-second cap (§9.1). |
| D18 | Chris, 2 Nov 2026 (Q7). A loose, browser-only lock is acceptable; "Start a new run" stays. |
| D19 | Chris, 2 Nov 2026 (Q8). A PDF page goes to the read call as the image plus its positioned text layer, when it has one (§6.3). |
| D21 | Build, milestone 4. The read call returns the outline as "<level> <text>" lines and `models.readTree.maxTokens` is 2500, so large trees are not cut short; the read test's timings (RT-3) confirm it fits the budget. |
| D22 | Build, milestone 4. pdf.js's standard fonts, CMaps and wasm decoders are served from `/pdfjs/` (copied into `dist/` at build), so pages render with non-embedded fonts and CJK text. |
| D20 | Chris, 2 Nov 2026 (Q10). The sign-off re-finds lower-level points itself; it gets no held findings from the first review. |

## 15. Questions for Chris

Answered 2 Nov 2026: Q3, Q4, Q6, Q7, Q8, Q10 (D15–D20). Still open: the seven assumptions, Q1, Q2, Q5, Q9, Q11, Q12, Q13. Until Chris answers, the build follows the defaults in brackets.

**The seven assumptions in CLAUDE.md** — my proposed answer in brackets:

1. Folder and repo (D1). [Yes, with the folder named `Tree Surgery App`.]
2. `TS_ACCESS_CODE`, separate from QT's (D2). [Yes.]
3. Optional first-level sub-questions in the key question box (D3). [Yes, up to 5.]
4. Agreed key question is the root; mismatch noted (D4, via a transcription note so the calibrated prompt stays word for word). [Yes.]
5. A .pptx tree has no page image in the record; the appendix outline stands in. [Yes, except a picture-only slide, whose picture is printed.]
6. Template download hidden until `public/Tree-Surgery-template.pptx` exists. [Yes. When can you supply it?]
7. Caps: context as QT; tree 20 MB, 25 pages or slides. [Yes.]

**New questions**

- **Q1 Briefing wording** (§2). The PRD has "[deadline]". With no case config, I propose "before the team problem-solving session". Is the draft email right?
- **Q2 Client or project name** at setup. Not in the PRD's setup list, but the header, subjects and record use it in Question Time. Add it? [Yes, required.]
- **Q3 Stage 1 OK email.** The calibrated prompt returns only "KEY QUESTION OK — proceed to Stage 2." I propose a short app-written "agreed" email (§5.3) from config. Wording OK?
- **Q4 Three Stage 1 failures.** The PRD doesn't say what happens. I propose: the run ends, the record shows the three attempts, and the run locks. Alternative: let the student upload the tree anyway on the last version. Which?
- **Q5 Showing the reading.** The PRD says the outline is "only the EM sees", yet the record prints it. Should the student see it on screen after the review, or only in the record? [Record only.]
- **Q6 Email-check numbers** (§9.1). "About 200 words" needs hard limits for the regeneration check. Are 120–280 (Stage 2), 60–170 (Stage 1), 100–280 (sign-off) acceptable? Tight limits mean more regenerations, which cost time against the 60 s target.
- **Q7 Lock and new runs** (§13). A browser lock can be undone by clearing site data. Is a per-run lock plus visible attempt IDs enough? And should a locked run offer "Start a new run" (for the final case, China), or should students need a fresh browser?
- **Q8 Read accuracy for PDFs.** The brief sends a PDF page as an image only. Many student PDFs are exported from PowerPoint and carry a text layer with positions. Sending that text alongside the image would give exact node wording and help the read test. May I send both (image plus positioned text, when present)? [Recommended.]
- **Q9 Outlines in the read test.** Comparing nodes needs a text match. I propose: case- and punctuation-insensitive, with 85% similarity; a node passes if it sits under a parent that matches. OK?
- **Q10 Sign-off held points.** The sign-off doesn't receive the first review's held findings (by design). It will re-find lower-level points itself, so "the points held back" may not match what the first review held. Acceptable? The alternative is passing the held findings as an encrypted token, as D7.
- **Q11 Unlimited unreadable re-uploads.** IT-5 says an unreadable page doesn't use the revision. With no cap, a student could use read calls to probe. Cap at 3 per round? [Yes, 3.]
- **Q12 Model.** The brief sets `claude-opus-5-5` for all four calls. Reading a tree is a perception task where a faster model may do as well; I'll keep Opus unless the read test's timings press against the budget. OK?
- **Q13 Stage 2 time budget.** `reviewTree.maxTokens` 2000 at ~100 tokens/s leaves little headroom inside 24 s. I'll measure first and split only if p95 > 20 s (§7.1). OK?

## 16. Requirements

| ID | Requirement | v1? | Tests |
| --- | --- | --- | --- |
| IT-1 | Briefing email: key question first, then the tree | v1 | T-BRF-1 |
| IT-2 | Template download (hidden until supplied) | v1 | T-TPL-1 |
| IT-3 | Stage 1: key question and optional sub-questions; EM review; 3 attempts per round, then rework and come back (D16); upload locked until OK | v1 | T-KQ-1..8 |
| IT-4 | Tree upload: one PDF or .pptx, page or slide picker, caps, no-tree refusal | v1 | T-UP-1..7 |
| IT-5 | Tree reading into an outline only the EM sees; no correction; unreadable → in-world email and re-upload that doesn't use the revision | v1 | T-READ-1..7, RT-1 |
| IT-6 | First review: verdict opener; 3–5 Socratic questions (First cut, Rework) or ≤2 pointers (Pass); about 200 words | v1 | T-REV-1..6, T-EML-1..8 |
| IT-7 | Pass ends the run; otherwise one revised upload | v1 | T-FLOW-1..3 |
| IT-8 | Sign-off: direct, compares revision with first draft; sign-off opener; held points; one lesson | v1 | T-SIGN-1..4 |
| IT-9 | Lock after a Pass or sign-off | v1 | T-LOCK-1..3 |
| IT-10 | Record PDF: identity, Stage 1 attempts and emails, tree images, Stage 2 emails, appendix of readings | v1 | T-PDF-1..4 |
| IT-11 | Context upload or paste, as QT: required, case detector, caps | v1 | T-CTX-1..5, T-DET-1..5 |
| IT-12 | Each call inside the hosting limit; each email within about 60 s | v1 | T-TIME-1..2, P-5 |
| TS-1 | Setup: access code, name, student ID, course, client | v1 | T-SET-1 |
| TS-2 | Autosave and resume | v1 | T-SAV-1..3 |
| TS-3 | Footer, header, house style, accessibility | v1 | T-A11Y-1 |
| TS-4 | Error codes | v1 | T-ERR-1..2 |
| TS-5 | Internal findings never reach the browser or the record | v1 | T-SEC-2 |
| TS-6 | Email check and regeneration | v1 | T-EML-1..8 |
| TS-7 | API key and prompts never reach the browser; access code on every function | v1 | T-SEC-1 |
| TS-8 | App-written "agreed" email after Stage 1 OK | v1 | T-KQ-3 |
| TS-9 | Tree "something to read" rule (§6.2 step 6) | v1 | T-UP-5 |
| TS-10 | PDF page rendered to an image, size rules | v1 | T-UP-6 |
| TS-11 | Read prompt without persona or context | v1 | T-READ-2 |
| TS-12 | Unreadable email from config | v1 | T-READ-4 |
| TS-13 | Pilot harness and read test | v1 | T-PIL-1..2, RT-1, P-1..P-6 |


## 17. Later versions (do not build; leave room)

Case mode (case config with reference tree, grain and traps; `mode` and `caseId` already carried); coverage test; hypotheses and analyses on leaves; prioritisation; in-app tree editor; a server-side lock.
