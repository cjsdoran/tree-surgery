---
description: Apply the latest PRD change (docs/prd.md) to spec, prompts, config, tests and code — only what changed
---

Follow "Changing the app: PRD updates" in CLAUDE.md.

1. Diff `docs/prd.md` against the last commit that touched it on `main`.
2. Classify each change and show me a table (IT ID · change · files · tests), plus any questions. Stop and wait for my confirmation.
3. After I confirm: update `docs/spec.md` for the affected IDs only, tests first, then the smallest code, prompt or config change.
4. Run `npm test` and `npm run e2e`. Ask before running the pilot script.
5. Bump `appVersion` and any edited prompt versions, commit "PRD vX.Y: <summary> (IT-…)", push the branch, and give me the deploy-preview link.

$ARGUMENTS
