# Deploying Tree Surgery

Tree Surgery deploys to Netlify the same way as Question Time: a static site from `dist/` plus five functions in `netlify/functions/` (`check`, `key-question`, `read-tree`, `review-tree`, `sign-off`). All settings are in `netlify.toml`, so the Netlify site needs only two environment variables and a domain. It is its own site, beside Question Time's, with its own key and access code.

## 1. Before the first deploy

- [x] Everything is on `main` at [github.com/cjsdoran/tree-surgery](https://github.com/cjsdoran/tree-surgery) (private), and `npm test` and `npm run e2e` pass on it. The e2e run also passes against the production build under `netlify serve`, with the real security headers (step 6).
- [ ] The open questions in `docs/spec.md` (Q1, Q2, Q5, Q9, Q11–Q13) are fine on their defaults, and your case titles are in `config/case-markers.json`.
- [ ] In the Anthropic Console, create an API key for Tree Surgery only, and set a **monthly spend limit** on its workspace. A student's run makes four to seven calls: the key question (once per attempt, up to 3), the read, the review's two parts, and for a revision a second read and the sign-off, plus a regeneration for any reply that fails its check. At the indicative rates the pilot's `runs.csv` gives about US$0.13 for a run that passes first time and about US$0.25 with a revision.
- [ ] Choose this term's access code: one word, not guessable, eg `ts-mgmt5760-aut26`. Not the same as Question Time's.

## 2. The code on GitHub

Done: the repository is `cjsdoran/tree-surgery`. Nothing secret is in it: `.env`, `calibration/private/`, `tests/fixtures/private/` and `pilot/` are git-ignored.

## 3. Create the Netlify site

1. In Netlify, **Add new site → Import an existing project → GitHub**, and pick `cjsdoran/tree-surgery`.
2. Netlify reads `netlify.toml`: build command `npm run build`, publish directory `dist`, functions in `netlify/functions`, Node 22. Leave the form as it is.
3. Before the first deploy finishes, add the environment variables (step 4). If the first deploy runs without them, the app shows "Tree Surgery is not set up correctly. Tell your instructor." (TS-S01) until you add them and redeploy.

Each push to `main` then deploys automatically. Other branches (eg `prd-v1.5`) get their own preview deploys, which use the same variables unless you scope them.

(Without GitHub: `netlify deploy --build` makes a draft deploy from this folder, and `netlify deploy --build --prod` publishes it.)

## 4. Environment variables

In **Site configuration → Environment variables**, add:

| Key | Value | Settings |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | the Tree Surgery key from the Anthropic Console | Mark as secret. Scope: Functions. Deploy contexts: all |
| `TS_ACCESS_CODE` | this term's access code | Scope: Functions. Deploy contexts: all |

Set both for **all deploy contexts** (Production, Deploy previews, Branch deploys), not only Production; otherwise a deploy preview fails with TS-S01. Then **Deploys → Trigger deploy → Deploy site**, because functions only see variables set before the deploy.

The key never reaches the browser: only the functions read it, and the security test (T-SEC-1) checks the build. The key also seals the review's internal findings between its two calls (spec D24), so changing the key mid-term only makes a review that is in progress at that moment ask the student to send the tree again.

## 5. Custom domain (as for Question Time)

The default `*.netlify.app` address is unreliable from mainland China, so students use a domain of your own.

1. **Domain management → Add a domain**, and enter the address, eg `treesurgery.<your-domain>`.
2. At your domain's DNS provider, add the record Netlify shows: for a subdomain, a `CNAME` from `treesurgery` to `<site-name>.netlify.app`. Use the same DNS provider and pattern as Question Time.
3. Wait for Netlify to issue the HTTPS certificate (usually minutes), then turn on **Force HTTPS**.
4. Test from mainland China: ask a student there, or use a mainland speed-test site, to load the address and get past the setup screen. The app loads nothing from any outside service: fonts and the PDF reader's files (`/pdfjs/`) are self-hosted and there is no analytics.

## 6. Check the live site

Replace `<site>` with your address. The first three checks already pass locally under `netlify serve` (3 Nov 2026).

- [ ] Security headers are present:

```bash
curl -s -D - -o /dev/null https://<site>/
```

  Look for `Content-Security-Policy`, `Strict-Transport-Security` and `X-Frame-Options: DENY`.
- [ ] Prompts are not published: `https://<site>/prompts/stage2-tree-review.md` returns 404.
- [ ] The whole flow runs under the real CSP, with the model calls mocked (no cost). From this folder:

```bash
E2E_BASE_URL=https://<site> npm run e2e
```

  Both tests pass; any CSP violation in the browser fails the run.
- [ ] Hashed assets are cached for a year: run the curl command on one `/assets/index-….js` file (its name is in the page source) and look for `cache-control: public, max-age=31536000, immutable`.
- [ ] A wrong access code is refused: enter it on the setup screen and see "That access code isn't recognised. Check Canvas." (TS-S02)
- [ ] One full run with real calls: your own notes as the context, a key question, a PDF tree and a .pptx tree (one each round), through the revision to the record PDF. In Netlify, **Logs → Functions** shows one line per call with `durationMs` and, on a failure, its error `code`; every call should be under 24,000 (the budget; the pilot's slowest was about 18,800).
- [ ] The record PDF opens, prints on A4, and shows the right app version, prompt versions and model, with no findings or prompt text.

## 7. Give it to students

Post on Canvas:

- the address, eg `https://treesurgery.<your-domain>`
- the access code
- what to upload: client briefs, kick-off notes or their own notes as the context, never a case PDF; the tree as a PDF or .pptx, one tree on the chosen page or slide
- that the record PDF is what they submit, and that a run locks once Daniel passes or signs off the tree.

## 8. Each term

- Change `TS_ACCESS_CODE`, then redeploy (step 4).
- Check spend in the Anthropic Console against the limit.
- Add any new case titles to `config/case-markers.json`, run `npm test`, and push.
- Changes start in the PRD (CLAUDE.md, "Changing the app"): the PRD, the spec, the prompts and the code go in one push, and the record shows the prompt versions each student used. Don't deploy prompt changes while an assignment is running.

## If something goes wrong

- **Roll back:** **Deploys**, pick the last good deploy, **Publish deploy**. It takes seconds.
- **Error codes:** every refusal or failure shows a code the student can quote (TS-U01–U09 for uploads, TS-S01–S05 for the server; the list is in `docs/spec.md` §12.1). Function logs carry the same code. An unreadable tree is not an error: Daniel emails the student to send it again, and it doesn't use up the revision.
- **"Tree Surgery is not set up correctly" (TS-S01):** a variable is missing or was added after the deploy. The function log names the missing variable. Check step 4 and redeploy.
- **"Daniel is taking too long to reply" (TS-S03):** a call hit the `functionBudgetSeconds` budget (24 s, below Netlify's limit on this project). Check the durations in the function logs; each line names its endpoint. If it happens often, lower `maxTokens` for that call in `config/app.json`. The review's findings call (`reviewTree`) is the slowest.
- **TS-S04:** Daniel's reply failed the email checks three times. The student can press **Ask Daniel again**; the function log shows each attempt's outcome. If it repeats, rerun that student's case through `scripts/pilot-run.mjs` to see the failed checks.
- **"We couldn't open X" (TS-U07, with an error name):** the browser couldn't read the file. Ask the student for the name after the code and which browser they use; exporting the tree to PDF usually helps.
- **Students in mainland China can't load the site:** check the domain's DNS and HTTPS in step 5, and that they use the custom address, not `*.netlify.app`.
