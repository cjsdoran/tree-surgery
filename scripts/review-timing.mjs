#!/usr/bin/env node
// Times the Stage 2 first review (IT-12, spec §7.1) on the calibration trees that pass Stage 1:
// each tree is read as the app reads it, then reviewed `--runs` times. REAL MODEL CALLS.
// Writes each review, with its internal findings, for Chris to read, and a timings.csv.
//
//   node scripts/review-timing.mjs --yes [--runs 2] [--only good,g2] [--out pilot/out/review-timing]
//
// The fuller pilot (verdicts, mustCatch, sign-off) is scripts/pilot-run.mjs in milestone 8.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callModel } from '../netlify/lib/anthropic.mjs';
import { readTreeStage, reviewTreeStage } from '../netlify/lib/stages.mjs';
import { renderOutline } from '../shared/outline.js';
import { config } from '../shared/limits.js';
import { buildContext, processPaste } from '../src/extract/context.js';
import { loadEnv, prepare } from './read-test.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** One stage call with the app's retries: a reply that fails its checks goes back with the errors. */
export async function withRetries(makeStage, body) {
  let previousErrors = [];
  const tries = [];
  for (let attempt = 1; attempt <= config.emailMaxAttempts; attempt++) {
    const stage = makeStage({ ...body, attempt, ...(previousErrors.length ? { previousErrors } : {}) });
    const startedAt = Date.now();
    const reply = await callModel({ ...stage, startedAt });
    const ms = Date.now() - startedAt;
    if (!reply.ok) {
      tries.push({ attempt, ms, outcome: reply.error });
      previousErrors = reply.error === 'truncated' && stage.truncatedError ? [stage.truncatedError] : [];
      continue;
    }
    const r = stage.read(reply.text);
    tries.push({ attempt, ms, outcome: r.ok ? 'ok' : 'invalid', errors: r.ok ? undefined : r.errors, outputTokens: reply.outputTokens });
    if (r.ok) return { ok: true, data: r.data, tries };
    previousErrors = r.errors;
  }
  return { ok: false, tries };
}

function emailText(email) {
  return [
    `Subject: ${email.subject}`, '', `**${email.opener}**`, '', email.whatWorks, '',
    ...email.questions.map((q, i) => `${i + 1}. ${q.question}${q.followUp ? ` ${q.followUp}` : ''}`),
    ...email.pointers.map((p) => `- ${p}`),
    ...(email.ps ? ['', `P.S. ${email.ps}`] : []),
  ].join('\n');
}

async function main() {
  loadEnv();
  if (!args.includes('--yes')) {
    console.log('Real model calls: add --yes to run.');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Nothing was sent.');
    process.exit(1);
  }
  const runs = Number(option('--runs', '2'));
  const only = option('--only', '').split(',').filter(Boolean);
  const out = option('--out', join('pilot', 'out', 'review-timing'));
  mkdirSync(out, { recursive: true });

  const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));
  const notes = processPaste(readFileSync(expected.context, 'utf8'));
  const built = buildContext([notes.item]);
  const context = { text: built.text, pageCount: built.pageCount };
  const trees = expected.trees.filter((t) => t.stage1 === 'OK' && (!only.length || only.includes(t.id)));
  console.log(`Review timing: ${trees.length} trees × ${runs} review run(s), REAL model calls (${config.models.reviewTree.model}, max ${config.models.reviewTree.maxTokens} tokens).`);

  const rows = [['tree', 'call', 'run', 'attempt', 'ms', 'outcome', 'outputTokens']];
  const summary = [];
  for (const tree of trees) {
    const prepared = await prepare(tree);
    if (!prepared.ok) {
      console.log(`${tree.id}: refused (${prepared.code})`);
      continue;
    }
    const read = await withRetries(readTreeStage, { round: 'first', keyQuestion: tree.keyQuestion, tree: prepared.tree });
    read.tries.forEach((t) => rows.push([tree.id, 'read', 1, t.attempt, t.ms, t.outcome, t.outputTokens]));
    if (!read.ok || read.data.status !== 'read') {
      console.log(`${tree.id}: no reading`);
      continue;
    }
    const outline = renderOutline(read.data.nodes, read.data.notes);
    const report = [`# Review timing: ${tree.id}`, '', `Chris's verdict: ${tree.stage2}`, '', '## Outline sent', '', '```', outline, '```', ''];
    const verdicts = [];
    for (let run = 1; run <= runs; run++) {
      const r = await withRetries(reviewTreeStage, { keyQuestion: tree.keyQuestion, outline, context });
      r.tries.forEach((t) => rows.push([tree.id, 'review', run, t.attempt, t.ms, t.outcome, t.outputTokens]));
      const times = r.tries.map((t) => `${(t.ms / 1000).toFixed(1)} s ${t.outcome}`).join(', ');
      if (!r.ok) {
        verdicts.push(`run ${run}: failed (${times})`);
        report.push(`## Run ${run}: failed`, '', ...r.tries.map((t) => `- attempt ${t.attempt}: ${t.outcome}${t.errors ? ` — ${t.errors.join('; ')}` : ''}`), '');
        continue;
      }
      const d = r.data;
      verdicts.push(`run ${run}: ${d.verdict} (${times})`);
      report.push(
        `## Run ${run}: ${d.verdict} (${times})`, '',
        `Key question check: ${d.keyQuestionCheck}`, '', `Why: ${d.verdictReason}`, '',
        '| # | Level | Test | Finding | In email |', '| --- | --- | --- | --- | --- |',
        ...d.findings.map((f) => `| ${f.n} | ${f.level} | ${f.test} | ${String(f.finding).replace(/\|/g, '/')} | ${f.inEmail ? 'yes' : 'held'} |`),
        '', '### Email', '', emailText(d.email), '',
      );
    }
    writeFileSync(join(out, `${tree.id}.md`), report.join('\n'));
    console.log(`${tree.id} (Chris: ${tree.stage2}): ${verdicts.join('; ')}`);
    summary.push(`| ${tree.id} | ${tree.stage2} | ${verdicts.join('; ')} |`);
  }
  writeFileSync(join(out, 'timings.csv'), `${rows.map((r) => r.map((v) => `"${v ?? ''}"`).join(',')).join('\n')}\n`);
  writeFileSync(join(out, 'summary.md'), ['# Review timing', '', '| Tree | Chris | EM |', '| --- | --- | --- |', ...summary, ''].join('\n'));
  console.log(`Written to ${out}`);
}

if (process.argv[1]?.endsWith('review-timing.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
