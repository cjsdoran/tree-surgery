#!/usr/bin/env node
// The pre-launch read test (RT-1..3, PRD "Pre-launch read test"): reads each calibration tree the
// way the app does and compares the reading with calibration/outlines/. Every level 1 and level 2
// node must sit under the right parent. The outlines are Claude's transcriptions, so a miss may be
// the outline's fault: each report shows both.
//
//   node scripts/read-test.mjs                 prepare the inputs only (no model calls, no cost)
//   node scripts/read-test.mjs --yes           real model calls: costs money; run when Chris asks
//   options: --only g1,good   --runs 3 (RT-2)   --out <dir> (default pilot/out/read-test)
//   diagnostics, for this run only: --model <id>   --max-tokens N   --budget S (seconds)
//   node scripts/read-test.mjs --rescore      re-check the readings saved in <out> (no model calls)
//
// Needs ANTHROPIC_API_KEY in the environment or in .env. Student trees stay on this machine:
// pilot/ is git-ignored, and nothing is sent anywhere except the model calls.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { openTreeFile, prepareTreePage, closeTree } from '../src/tree/treeUpload.js';
import { callModel } from '../netlify/lib/anthropic.mjs';
import { readTreeStage } from '../netlify/lib/stages.mjs';
import { compareOutlines, parseOutline, renderOutline } from '../shared/outline.js';
import { config } from '../shared/limits.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

export const nodeDeps = {
  createCanvas,
  encode: async (c, type, q) => new Uint8Array(await c.encode(type === 'image/png' ? 'png' : 'jpeg', q ? Math.round(q * 100) : undefined)),
  toBase64: (b) => Buffer.from(b).toString('base64'),
};

/** Reads KEY=value lines from .env into process.env, without overwriting what is set. */
export function loadEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const loadPdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs');

/** Prepares one tree's page exactly as the browser does. */
export async function prepare(tree) {
  const file = new File([readFileSync(tree.file)], basename(tree.file));
  const opened = await openTreeFile(file, { loadPdfjs, assetsBase: 'node_modules/pdfjs-dist/' });
  if (!opened.ok) return opened;
  try {
    return await prepareTreePage(opened.handle, tree.page, nodeDeps);
  } finally {
    await closeTree(opened.handle);
  }
}

/** One read, with the app's retries on a reply that fails its checks. */
async function readOnce(body) {
  let previousErrors = [];
  const tries = [];
  for (let attempt = 1; attempt <= config.emailMaxAttempts; attempt++) {
    const stage = readTreeStage({ ...body, attempt, ...(previousErrors.length ? { previousErrors } : {}) });
    const startedAt = Date.now();
    const reply = await callModel({ ...stage, startedAt });
    const ms = Date.now() - startedAt;
    if (!reply.ok) {
      tries.push({ attempt, ms, outcome: reply.error });
      // As the function does: a cut-off reading is retried with the instruction to cut short.
      previousErrors = reply.error === 'truncated' && stage.truncatedError ? [stage.truncatedError] : [];
      continue;
    }
    const r = stage.read(reply.text);
    tries.push({ attempt, ms, outcome: r.ok ? 'ok' : 'invalid', inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, servedBy: reply.servedBy });
    if (r.ok) return { ok: true, data: r.data, tries };
    previousErrors = r.errors;
  }
  return { ok: false, tries };
}

/** Re-checks the readings saved in each <id>.md against the reference outlines, at no cost. */
function rescore(trees, out) {
  for (const tree of trees) {
    const file = join(out, `${tree.id}.md`);
    if (!existsSync(file)) continue;
    const reference = parseOutline(readFileSync(join('calibration', 'outlines', `${tree.id}.md`), 'utf8'));
    const readings = [...readFileSync(file, 'utf8').matchAll(/### The reading\s*```\r?\n([\s\S]*?)```/g)].map((m) => parseOutline(m[1]));
    const results = readings.map((nodes, i) => {
      const cmp = compareOutlines(reference, nodes);
      const misses = cmp.misses.map((m) => `    L${m.level} "${m.text}": ${m.problem}${m.found ? ` ("${m.found}")` : ''}`).join('\n');
      return `run ${i + 1}: ${cmp.ok ? 'PASS' : 'FAIL'} (${cmp.checked - cmp.misses.length}/${cmp.checked})${misses ? `\n${misses}` : ''}`;
    });
    console.log(`${tree.id}: ${results.join('; ') || 'no reading saved'}`);
  }
}

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

async function main() {
  loadEnv();
  const live = flag('--yes');
  const runs = Number(option('--runs', '1'));
  const only = option('--only', '').split(',').filter(Boolean);
  const out = option('--out', join('pilot', 'out', 'read-test'));
  // Diagnostic overrides: they change this process's copy of the config only, never config/app.json.
  if (option('--model')) config.models.readTree.model = option('--model');
  if (option('--max-tokens')) config.models.readTree.maxTokens = Number(option('--max-tokens'));
  if (option('--budget')) config.functionBudgetSeconds = Number(option('--budget'));
  mkdirSync(out, { recursive: true });

  const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));
  const trees = expected.trees.filter((t) => !only.length || only.includes(t.id));
  if (flag('--rescore')) return rescore(trees, out);
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or .env). Nothing was sent.');
    process.exit(1);
  }
  console.log(live ? `Read test: ${trees.length} trees × ${runs} run(s), REAL model calls (${config.models.readTree.model}, max ${config.models.readTree.maxTokens} tokens, ${config.functionBudgetSeconds} s budget).` : `Dry run: preparing ${trees.length} trees; no model calls.`);

  const summary = [];
  const timings = [['tree', 'run', 'attempt', 'ms', 'outcome', 'inputTokens', 'outputTokens', 'servedBy']];
  for (const tree of trees) {
    const prepared = await prepare(tree);
    if (!prepared.ok) {
      console.log(`${tree.id}: refused before reading (${prepared.code}): ${prepared.message}`);
      summary.push({ id: tree.id, result: `refused (${prepared.code})` });
      continue;
    }
    const t = prepared.tree;
    const input = t.shapes ?? t.pageText ?? '';
    writeFileSync(join(out, `${tree.id}.input.txt`), `${t.kind} page ${t.page}${t.image ? `, image ${t.image.mediaType}, ${Math.round(t.image.base64.length * 0.75 / 1024)} KB` : ''}\n\n${input || '(no text layer)'}\n`);
    if (t.image) writeFileSync(join(out, `${tree.id}.${t.image.mediaType === 'image/png' ? 'png' : 'jpg'}`), Buffer.from(t.image.base64, 'base64'));
    if (!live) {
      console.log(`${tree.id}: ${t.kind} page ${t.page}: ${t.image ? `image${t.pageText ? ' + text layer' : ' only'}` : 'slide shapes'}, ${input.length} chars of text`);
      summary.push({ id: tree.id, result: 'prepared' });
      continue;
    }

    const reference = parseOutline(readFileSync(join('calibration', 'outlines', `${tree.id}.md`), 'utf8'));
    const body = { round: 'first', keyQuestion: tree.keyQuestion, tree: t };
    const report = [`# Read test: ${tree.id} (${basename(tree.file)}, page ${tree.page})`, ''];
    const results = [];
    for (let run = 1; run <= runs; run++) {
      const r = await readOnce(body);
      r.tries.forEach((x) => timings.push([tree.id, run, x.attempt, x.ms, x.outcome, x.inputTokens, x.outputTokens, x.servedBy]));
      if (!r.ok) {
        results.push(`run ${run}: no valid reading (${r.tries.map((x) => x.outcome).join(', ')})`);
        report.push(`## Run ${run}: no valid reading`, '', r.tries.map((x) => `- attempt ${x.attempt}: ${x.outcome}, ${x.ms} ms`).join('\n'), '');
        continue;
      }
      const d = r.data;
      if (d.status === 'unreadable') {
        results.push(`run ${run}: unreadable (${d.reason})`);
        report.push(`## Run ${run}: unreadable (${d.reason})`, '');
        continue;
      }
      const cmp = compareOutlines(reference, d.nodes);
      results.push(`run ${run}: ${cmp.ok ? 'PASS' : 'FAIL'} (${cmp.checked - cmp.misses.length}/${cmp.checked} level 1–2 nodes)`);
      report.push(
        `## Run ${run}: ${cmp.ok ? 'PASS' : `${cmp.misses.length} miss${cmp.misses.length === 1 ? '' : 'es'}`}`,
        '',
        `Root as written: ${d.rootAsWritten ?? '(none)'} · differs from the agreed key question: ${d.rootDiffers ? 'yes' : 'no'} · ${r.tries.at(-1).ms} ms`,
        '',
        ...(cmp.misses.length ? ['| Level | Reference node | Problem | Found |', '| --- | --- | --- | --- |', ...cmp.misses.map((m) => `| ${m.level} | ${m.text} | ${m.problem} | ${m.found ?? ''} |`), ''] : []),
        '### The reading', '', '```', renderOutline(d.nodes, d.notes), '```', '',
      );
    }
    report.push('## Reference outline (calibration/outlines)', '', '```', renderOutline(reference), '```', '');
    writeFileSync(join(out, `${tree.id}.md`), report.join('\n'));
    console.log(`${tree.id}: ${results.join('; ')}`);
    summary.push({ id: tree.id, result: results.join('; ') });
  }

  writeFileSync(join(out, 'summary.md'), ['# Read test summary', '', `${live ? 'Live' : 'Dry run'}, ${new Date().toISOString()}`, '', '| Tree | Result |', '| --- | --- |', ...summary.map((s) => `| ${s.id} | ${s.result} |`), ''].join('\n'));
  if (live) writeFileSync(join(out, 'timings.csv'), `${csv(timings)}\n`);
  console.log(`Written to ${out}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('read-test.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
