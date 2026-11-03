#!/usr/bin/env node
// Pilot harness (test plan §4, P-1..P-6): runs the calibration trees through the real prompts in
// generic mode, with the student-style context, for Chris to rate. Each tree: Stage 1 on its key
// question; if Daniel says OK, the tree is read and given the two-call first review. REAL MODEL
// CALLS with --yes: it costs money; run only when Chris asks.
//
//   node scripts/pilot-run.mjs                 dry run: prepare everything, no model calls
//   node scripts/pilot-run.mjs --yes           real calls
//   options: --only good,g2   --out <dir> (default pilot/out/pilot)   --expected <file>
//
// Writes, per tree, <id>.md (Stage 1 findings and email, the outline, the review's findings and
// email: everything the browser never sees, for Chris only), and verdicts.csv (expected vs
// actual), points.csv (each mustCatch and mustNot with the email, and an empty column for
// Chris's call), runs.csv (time, tokens and estimated cost per call) and summary.md.
// Student trees and outputs stay on this machine: pilot/ is git-ignored.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyQuestionStage, readTreeStage, reviewEmailStage, reviewFindingsStage } from '../netlify/lib/stages.mjs';
import { renderOutline } from '../shared/outline.js';
import { config } from '../shared/limits.js';
import { detectCase } from '../shared/caseDetector.js';
import { buildContext, processPaste } from '../src/extract/context.js';
import { loadEnv, prepare } from './read-test.mjs';
import { withRetries } from './review-timing.mjs';

// Indicative prices, US$ per million tokens (input, output). Check the Anthropic pricing page.
export const PRICES = { 'claude-opus-5-5': [4, 20] };
const STAGE2 = { Pass: 'pass', 'First cut': 'first_cut', Rework: 'rework' };
const LABEL = { ok: 'OK', not_ok: 'Not OK', pass: 'Pass', first_cut: 'First cut', rework: 'Rework' };

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (rows) => `${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;
export const cost = (model, input, output) => {
  const [i, o] = PRICES[model] ?? [0, 0];
  return ((input ?? 0) * i + (output ?? 0) * o) / 1e6;
};

function findingsTable(findings, cols) {
  return [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`,
    ...findings.map((f) => `| ${cols.map((c) => String(f[c] ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n');
}

function stage1Email(email) {
  if (!email) return '(none: OK)';
  return [`Subject: ${email.subject}`, '', `**${email.opener}**`, '', email.whatWorks, '', ...email.points.map((p) => `- ${p}`)].filter((l) => l !== undefined).join('\n');
}

function reviewEmail(email) {
  return [
    `Subject: ${email.subject}`, '', `**${email.opener}**`, '', email.whatWorks, '',
    ...email.questions.map((q, i) => `${i + 1}. ${q.question}${q.followUp ? ` ${q.followUp}` : ''}`),
    ...email.pointers.map((p) => `- ${p}`),
    ...(email.ps ? ['', `P.S. ${email.ps}`] : []),
  ].join('\n');
}

/**
 * Runs the pilot. Exported so the tests can run it with the model mocked.
 * @returns {Promise<{ verdicts: object[], runs: object[] }>}
 */
export async function runPilot({ expected, trees, out, live, log = console.log }) {
  mkdirSync(out, { recursive: true });
  const notes = processPaste(readFileSync(expected.context, 'utf8'));
  if (!notes.ok) throw new Error(`The context was refused: ${notes.message}`);
  const built = buildContext([notes.item]);
  const context = { text: built.text, pageCount: built.pageCount };
  if (detectCase(context.text).blocked) throw new Error('The context is blocked by the case detector.');

  const verdicts = [];
  const points = [['tree', 'kind', 'point', 'stage', 'email', 'Chris: in the email? (yes/no)', 'comment']];
  const runs = [['tree', 'call', 'attempt', 'ms', 'outcome', 'inputTokens', 'outputTokens', 'servedBy', 'costUSD']];
  const record = (id, call, tries) => tries.forEach((t) => runs.push([id, call, t.attempt, t.ms, t.outcome, t.inputTokens, t.outputTokens, t.servedBy,
    t.servedBy ? cost(t.servedBy, t.inputTokens, t.outputTokens).toFixed(4) : '']));

  for (const tree of trees) {
    const prepared = await prepare(tree);
    if (!live) {
      log(`${tree.id}: ${prepared.ok ? `ready (${prepared.tree.kind} page ${prepared.tree.page})` : `refused (${prepared.code})`}; Stage 1 on "${tree.keyQuestion}"`);
      continue;
    }
    const v = { id: tree.id, stage1Expected: tree.stage1, stage1: '', stage2Expected: tree.stage2 ?? '', stage2: '' };
    const report = [`# Pilot: ${tree.id}`, '', `Key question: ${tree.keyQuestion}`, ...(tree.subQuestions?.length ? [`Sub-questions: ${tree.subQuestions.join(' / ')}`] : []), ''];

    // Stage 1.
    const s1 = await withRetries(keyQuestionStage, { keyQuestion: tree.keyQuestion, subQuestions: tree.subQuestions ?? [], context });
    record(tree.id, 'key-question', s1.tries);
    if (!s1.ok) {
      v.stage1 = 'failed';
      report.push('## Stage 1: failed', '', ...s1.tries.map((t) => `- ${t.outcome}${t.errors ? `: ${t.errors.join('; ')}` : ''}`), '');
    } else {
      v.stage1 = LABEL[s1.data.verdict];
      report.push(`## Stage 1: ${v.stage1} (Chris: ${tree.stage1})`, '', findingsTable(s1.data.findings, ['test', 'result', 'evidence']), '', '### Email', '', stage1Email(s1.data.email), '');
      for (const f of tree.stage1Faults ?? []) points.push([tree.id, 'stage1Fault', f, 'Stage 1', stage1Email(s1.data.email), '', '']);
    }

    // Stage 2, only if Daniel agreed the key question.
    if (s1.ok && s1.data.verdict === 'ok' && prepared.ok) {
      const read = await withRetries(readTreeStage, { round: 'first', keyQuestion: tree.keyQuestion, tree: prepared.tree });
      record(tree.id, 'read-tree', read.tries);
      if (!read.ok || read.data.status !== 'read') {
        v.stage2 = read.ok ? `unreadable (${read.data.reason})` : 'read failed';
      } else {
        const notesOut = [...read.data.notes];
        if (read.data.rootDiffers && read.data.rootAsWritten) notesOut.unshift(`Transcription note: the root on the page reads "${read.data.rootAsWritten}", which differs from the agreed key question.`);
        const outline = renderOutline(read.data.nodes, notesOut);
        report.push('## Outline sent', '', '```', outline, '```', '');
        const body = { keyQuestion: tree.keyQuestion, outline, context };
        const a = await withRetries(reviewFindingsStage, body);
        record(tree.id, 'review-tree:findings', a.tries);
        const b = a.ok ? await withRetries((x) => reviewEmailStage(x, a.data), body) : { ok: false, tries: [] };
        record(tree.id, 'review-tree:email', b.tries);
        if (!a.ok || !b.ok) {
          v.stage2 = 'review failed';
        } else {
          v.stage2 = LABEL[a.data.verdict];
          const email = reviewEmail(b.data.email);
          report.push(`## Stage 2: ${v.stage2} (Chris: ${tree.stage2 ?? '-'})`, '', `Key question check: ${a.data.keyQuestionCheck}`, '', `Why: ${a.data.verdictReason}`, '',
            findingsTable(a.data.findings, ['n', 'level', 'test', 'finding', 'inEmail']), '', '### Email', '', email, '');
          for (const p of tree.mustCatch ?? []) points.push([tree.id, 'mustCatch', p, 'Stage 2', email, '', '']);
          for (const p of tree.mustNot ?? []) points.push([tree.id, 'mustNot', p, 'Stage 2', email, '', '']);
          for (const p of tree.alsoExpected ?? []) points.push([tree.id, 'alsoExpected', p, 'Stage 2', email, '', '']);
        }
      }
    }
    v.match = v.stage1 === v.stage1Expected && (!v.stage2Expected || v.stage2 === v.stage2Expected || v.stage1 !== 'OK') ? 'yes' : 'no';
    verdicts.push(v);
    writeFileSync(join(out, `${tree.id}.md`), report.join('\n'));
    log(`${tree.id}: Stage 1 ${v.stage1} (Chris ${v.stage1Expected})${v.stage2 ? `; Stage 2 ${v.stage2} (Chris ${v.stage2Expected})` : ''}`);
  }
  if (!live) return { verdicts, runs: [] };

  writeFileSync(join(out, 'verdicts.csv'), csv([['tree', 'Stage 1 (Chris)', 'Stage 1 (EM)', 'Stage 2 (Chris)', 'Stage 2 (EM)', 'match'],
    ...verdicts.map((v) => [v.id, v.stage1Expected, v.stage1, v.stage2Expected, v.stage2, v.match])]));
  writeFileSync(join(out, 'points.csv'), csv(points));
  writeFileSync(join(out, 'runs.csv'), csv(runs));

  const ok = runs.slice(1).filter((r) => r[4] === 'ok');
  const byCall = {};
  for (const r of runs.slice(1)) (byCall[r[1]] ??= []).push(r);
  const p95 = (xs) => xs.sort((x, y) => x - y)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)];
  const total = runs.slice(1).reduce((n, r) => n + Number(r[8] || 0), 0);
  writeFileSync(join(out, 'summary.md'), [
    '# Pilot summary', '', `${new Date().toISOString()} · ${config.models.reviewTree.model} · context: ${expected.context}`, '',
    '| Tree | Stage 1 (Chris / EM) | Stage 2 (Chris / EM) | Match |', '| --- | --- | --- | --- |',
    ...verdicts.map((v) => `| ${v.id} | ${v.stage1Expected} / ${v.stage1} | ${v.stage2Expected || '-'} / ${v.stage2 || '-'} | ${v.match} |`),
    '', '| Call | Calls | Retries | Slowest (s) | p95 (s) |', '| --- | --- | --- | --- | --- |',
    ...Object.entries(byCall).map(([call, rs]) => {
      const ms = rs.filter((r) => r[4] === 'ok').map((r) => Number(r[3]));
      return `| ${call} | ${rs.length} | ${rs.length - ms.length} | ${ms.length ? (Math.max(...ms) / 1000).toFixed(1) : '-'} | ${ms.length ? (p95(ms) / 1000).toFixed(1) : '-'} |`;
    }),
    '', `${ok.length} successful calls; estimated cost US$${total.toFixed(2)} (indicative prices).`,
    '', 'Mark each mustCatch and mustNot in points.csv. Misses go to Chris before any fix (CLAUDE.md, definition of done).', '',
  ].join('\n'));
  return { verdicts, runs: runs.slice(1) };
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const live = args.includes('--yes');
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or .env). Nothing was sent.');
    process.exit(1);
  }
  const expected = JSON.parse(readFileSync(option('--expected', 'calibration/expected.json'), 'utf8'));
  const only = option('--only', '').split(',').filter(Boolean);
  const trees = expected.trees.filter((t) => !only.length || only.includes(t.id));
  console.log(live ? `Pilot: ${trees.length} trees, REAL model calls.` : `Dry run: ${trees.length} trees, no model calls. Add --yes to run.`);
  await runPilot({ expected, trees, out: option('--out', join('pilot', 'out', 'pilot')), live });
}

if (process.argv[1]?.endsWith('pilot-run.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
