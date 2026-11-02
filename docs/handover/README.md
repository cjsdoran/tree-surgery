# Tree Surgery v1.0 handover

1. Put this folder beside Question Time, named `Tree Surgery` (so `../Question Time App` is Question Time).
2. Start Claude Code (desktop app) in the `Tree Surgery` folder and paste the prompt below.

```
Read CLAUDE.md first, then docs/prd.md, the three files in prompts/, and calibration/README.md.
Question Time is in ../Question Time App: read its CLAUDE.md, docs/spec.md and code, because Tree Surgery reuses them.
1. Run git init, commit everything except calibration/private/ (it is git-ignored) as "Tree Surgery v1.0 baseline: PRD, prompts, build brief, calibration set".
2. Do milestone 0 in CLAUDE.md: write docs/spec.md and tests/test-plan.md, and list your assumptions and questions, including the seven in "Assumptions to confirm with Chris".
3. Stop and wait for me before milestone 1.
```

Files in this handover:
- `CLAUDE.md`: the build brief.
- `docs/prd.md`: PRD v1.0, exported from the Claude Doc.
- `prompts/`: Stage 1 and Stage 2 (calibrated), and Question Time's persona.
- `calibration/`: the nine PEIP trees, Chris's verdicts, outlines and a student-style context.
- `.claude/commands/prd-update.md`: the `/prd-update` command, as in Question Time.
