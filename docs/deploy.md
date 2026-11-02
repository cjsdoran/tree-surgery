# Deploying Question Time

> **Copied from Question Time, not yet adapted.** Rewritten for Tree Surgery in milestone 9 (functions `check`, `key-question`, `read-tree`, `review-tree`, `sign-off`; variables `ANTHROPIC_API_KEY` and `TS_ACCESS_CODE`; codes TS-…).

Question Time deploys to Netlify the same way as the Arvind simulator: a static site from `dist/` plus two functions in `netlify/functions/` (`check` and `review`). All settings are in `netlify.toml`, so the Netlify site needs only two environment variables and a domain.

## 1. Before the first deploy

- [ ] All milestone branches are merged into one branch (eg `main`), and `npm test` and `npm run e2e` pass on it.
- [ ] The open decisions in `docs/spec.md` §12 (D10–D12) and your case titles in `config/case-markers.json` are settled.
- [ ] In the Anthropic Console, create an API key for Question Time only, and set a **monthly spend limit** on its workspace. A full team run makes five review calls (the four sections, then the opening and summary; spec D21, D24), plus a regeneration for any part that fails its check; the pilot's `runs.csv` gives the cost per run.
- [ ] Choose this term's access code: one word, not guessable, eg `qt-mgmt5760-aut26`.

## 2. Put the code on GitHub

Create a **private** repository on GitHub (eg `question-time`), then from this folder:

```bash
git remote add origin https://github.com/<you>/question-time.git
```
```bash
git push -u origin main
```

Nothing secret is in the repository: `.env`, `tests/fixtures/private/` and `pilot/` are git-ignored.

## 3. Create the Netlify site

1. In Netlify, **Add new site → Import an existing project → GitHub**, and pick the repository.
2. Netlify reads `netlify.toml`: build command `npm run build`, publish directory `dist`, functions in `netlify/functions`, Node 22. Leave the form as it is.
3. Before the first deploy finishes, add the environment variables (step 4). If the first deploy runs without them, the app shows "Question Time is not set up correctly" until you add them and redeploy.

Each push to `main` then deploys automatically. Other branches get their own preview deploys, which use the same variables unless you scope them.

(Without GitHub: `netlify deploy --build` makes a draft deploy from this folder, and `netlify deploy --build --prod` publishes it.)

## 4. Environment variables

In **Site configuration → Environment variables**, add:

| Key | Value | Settings |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | the Question Time key from the Anthropic Console | Mark as secret. Scope: Functions. Deploy contexts: all |
| `QT_ACCESS_CODE` | this term's access code | Scope: Functions. Deploy contexts: all |

Set both for **all deploy contexts** (Production, Deploy previews, Branch deploys), not only Production; otherwise a deploy preview fails with "Question Time is not set up correctly" (QT-S01). Then **Deploys → Trigger deploy → Deploy site**, because functions only see variables set before the deploy. The key never reaches the browser: only the functions read it, and the security test (T-SEC-1) checks the build.

## 5. Custom domain (as for the Arvind simulator)

The default `*.netlify.app` address is unreliable from mainland China, so students use a domain of your own.

1. **Domain management → Add a domain**, and enter the address, eg `questiontime.<your-domain>`.
2. At your domain's DNS provider, add the record Netlify shows: for a subdomain, a `CNAME` from `questiontime` to `<site-name>.netlify.app`. Use the same DNS provider and pattern as the Arvind simulator.
3. Wait for Netlify to issue the HTTPS certificate (usually minutes), then turn on **Force HTTPS**.
4. Test from mainland China: ask a student there, or use a mainland speed-test site, to load the address and get past the setup screen. The app loads nothing from Google or any other outside service: fonts are self-hosted and there is no analytics.

## 6. Check the live site

Replace `<site>` with your address.

- [ ] Security headers are present:

```bash
curl -s -D - -o /dev/null https://<site>/
```

  Look for `Content-Security-Policy`, `Strict-Transport-Security` and `X-Frame-Options: DENY`.
- [ ] Hashed assets are cached for a year: run the same command on one `/assets/index-….js` file (its name is in the page source) and look for `cache-control: public, max-age=31536000, immutable`.
- [ ] Prompts are not published: `https://<site>/prompts/review.md` returns 404.
- [ ] A wrong access code is refused: enter it on the setup screen and see "That access code isn't recognised. Check Canvas."
- [ ] One full run with real calls, on a real brief: briefing to record PDF. In Netlify, **Logs → Functions** shows one line per call with `durationMs` and, on a failure, its error `code`; every call should be under 45,000 (P-5).
- [ ] The record PDF opens, prints on A4, and shows the right app version, prompt version and model.

## 7. Give it to students

Post on Canvas:

- the address, eg `https://questiontime.<your-domain>`
- the access code
- a line on what to upload: client briefs, kick-off notes or their own notes, never a case PDF; and that the record PDF is what they submit to the group assignment.

## 8. Each term

- Change `QT_ACCESS_CODE`, then redeploy (step 4).
- Check spend in the Anthropic Console against the limit.
- Add any new case titles to `config/case-markers.json`, run `npm test`, and push.
- Prompt changes: edit `prompts/*.md`, bump the version line, push. The record shows the version each team used.

## If something goes wrong

- **Roll back:** **Deploys**, pick the last good deploy, **Publish deploy**. It takes seconds.
- **Error codes:** every refusal or failure shows a code the team can quote (QT-U01–U08 for uploads, QT-S01–S05 for the server; the list is in `docs/spec.md` §3a). Function logs carry the same code.
- **"Question Time is not set up correctly" (QT-S01):** a variable is missing or was added after the deploy. The function log names the missing variable. Check step 4 and redeploy.
- **"Daniel is taking too long to reply" (QT-S03):** a call hit the `functionBudgetSeconds` budget (24 s, below Netlify's limit on this project). Check the durations in the function logs; each line names its `part`. If it happens often, lower `maxTokens` for that part in `config/app.json`.
- **"We couldn't open X" (QT-U07, with an error name):** the browser couldn't read the file. Ask the team for the name after the code, and which browser they use.
- **Students in mainland China can't load the site:** check the domain's DNS and HTTPS in step 5, and that they use the custom address, not `*.netlify.app`.
