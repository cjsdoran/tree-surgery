#!/usr/bin/env node
// Sample sign-offs for Chris (milestone 6): the draft sign-off prompt on a first tree, its real
// first review, and hand-written revisions. REAL MODEL CALLS.
//
//   node scripts/sign-off-samples.mjs --yes [--tree g2] [--runs 1]
//
// Reads the first outline and the run 1 email from pilot/out/review-timing-v1.2/<tree>.md and
// each revision from pilot/in/sign-off/<tree>-revision-*.md (git-ignored: built on student work).
// Writes pilot/out/sign-off-samples/<tree>.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { signOffStage } from '../netlify/lib/stages.mjs';
import { buildContext, processPaste } from '../src/extract/context.js';
import { loadEnv } from './read-test.mjs';
import { withRetries } from './review-timing.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** The outline sent and the run 1 email, from a review-timing report. */
export function firstReview(report) {
  const outline = /## Outline sent\s*```\r?\n([\s\S]*?)```/.exec(report)?.[1]?.trim();
  const run = /## Run 1: (\w+)[\s\S]*?### Email\s*\r?\n([\s\S]*?)(?=\r?\n## Run|$)/.exec(report);
  return outline && run ? { outline, verdict: run[1], email: run[2].trim() } : null;
}

function emailText(email) {
  return [
    `Subject: ${email.subject}`, '', `**${email.opener}**`, '',
    ...(email.improved.length ? ['What improved:', ...email.improved.map((p) => `- ${p}`), ''] : []),
    ...(email.stillFails.length ? ['What still fails:', ...email.stillFails.map((p) => `- ${p}`), ''] : []),
    ...(email.heldPoints.length ? ['Lower-level points:', ...email.heldPoints.map((p) => `- ${p}`), ''] : []),
    `Lesson: ${email.lesson}`,
    ...(email.ps ? ['', `P.S. ${email.ps}`] : []),
  ].join('\n');
}

async function main() {
  loadEnv();
  if (!args.includes('--yes')) return console.log('Real model calls: add --yes to run.');
  const tree = option('--tree', 'g2');
  const runs = Number(option('--runs', '1'));
  const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));
  const t = expected.trees.find((x) => x.id === tree);
  const first = firstReview(readFileSync(join('pilot', 'out', 'review-timing-v1.2', `${tree}.md`), 'utf8'));
  if (!t || !first) throw new Error(`No first review for ${tree}: run scripts/review-timing.mjs first.`);
  const built = buildContext([processPaste(readFileSync(expected.context, 'utf8')).item]);
  const context = { text: built.text, pageCount: built.pageCount };

  const dir = join('pilot', 'in', 'sign-off');
  const revisions = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${tree}-revision-`)) : [];
  const out = join('pilot', 'out', 'sign-off-samples');
  mkdirSync(out, { recursive: true });
  const report = [`# Sign-off samples: ${tree}`, '', `First review verdict: ${first.verdict}`, '', '## First review email', '', first.email, ''];
  for (const file of revisions) {
    const revisedOutline = readFileSync(join(dir, file), 'utf8').trim();
    report.push(`## ${file}`, '', '```', revisedOutline, '```', '');
    for (let run = 1; run <= runs; run++) {
      const r = await withRetries(signOffStage, {
        keyQuestion: t.keyQuestion, firstOutline: first.outline, firstVerdict: first.verdict,
        firstEmail: first.email, revisedOutline, context,
      });
      const times = r.tries.map((x) => `${(x.ms / 1000).toFixed(1)} s ${x.outcome}${x.errors ? ` (${x.errors.join('; ')})` : ''}`).join(', ');
      console.log(`${file} run ${run}: ${r.ok ? r.data.verdict : 'failed'} — ${times}`);
      report.push(`### Run ${run}: ${r.ok ? r.data.verdict : 'failed'} (${times})`, '', r.ok ? emailText(r.data.email) : '', '');
    }
  }
  writeFileSync(join(out, `${tree}.md`), report.join('\n'));
  console.log(`Written to ${join(out, `${tree}.md`)}`);
}

if (process.argv[1]?.endsWith('sign-off-samples.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
