# Calibration set (PEIP, 2 Nov 2026)

Nine issue trees on the PEIP case, used to calibrate the EM prompts with Chris over three runs.

| ID | File | Tree on page | Chris's verdict |
| --- | --- | --- | --- |
| good | `private/trees/good.pptx` | 1 | Stage 1 OK · Pass |
| g1 | `private/trees/g1.pdf` | 2 | Key question needs rethinking |
| g2 | `private/trees/g2.pptx` | 1 | Stage 1 OK · First cut |
| g3 | `private/trees/g3.pdf` | 2 | Stage 1 OK · First cut |
| g4 | `private/trees/g4.pdf` | 2 | Stage 1 OK · First cut |
| g5 | `private/trees/g5.pptx` | 2 | Stage 1 OK · First cut |
| g6 | `private/trees/g6.pdf` | 1 | Key question needs rethinking |
| g7 | `private/trees/g7.pdf` | 2 | Key question needs rethinking |
| g8 | `private/trees/g8.pdf` | 2 | Key question needs rethinking |

- `expected.json`: the key question to paste for each tree, Chris's verdicts, and the points the Stage 2 email must (and must not) make.
- `outlines/`: Claude's transcription of each tree, key question as level 0. The reference for the read test. Transcriptions can be wrong: where the read test disagrees, show Chris both.
- `context/peip-student-notes.md`: a student-style client context for the generic-mode rerun (v1 has no case configs).
- `private/`: student work. Git-ignored; never commit it, never send it anywhere except the model calls of the pilot harness.

The calibration ran with a PEIP case config that v1 doesn't have, so the generic-mode rerun is part of the definition of done. After that, a holdout test on trees from another case comes before students use the tool.
