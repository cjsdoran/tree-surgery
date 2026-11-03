// T-PIL-1: the pilot harness with the model mocked: Stage 1 on each tree, then for an OK the
// read and the two-call review; the outputs Chris rates. No cost.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPilot, cost } from '../../scripts/pilot-run.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { fakeClient } from '../helpers/fakeAnthropic.js';
import { makePptx, simpleTree } from '../helpers/pptx.js';
import { notOkReply, okReply } from '../helpers/stage1.js';
import { partA, partB, reworkReply } from '../helpers/stage2.js';

const KQ = 'How can Acme double profit by 2027?';
const READ = { status: 'read', reason: null, rootAsWritten: KQ, rootDiffers: false, outline: `0 ${KQ}\n1 How can Acme grow revenue?\n1 How can Acme cut costs?`, notes: [] };

// Answers each call by what it is: Stage 1 (OK for "ok" trees), the read, then each review part.
function answer(params) {
  const system = params.system[0].text;
  const message = JSON.stringify(params.messages);
  let reply;
  if (system.includes('Stage 1: key question review')) reply = message.includes('NOT-OK-TREE') ? notOkReply() : okReply();
  else if (system.includes('reading an issue tree')) reply = READ;
  else if (message.includes('<part>findings</part>')) reply = partA(reworkReply());
  else reply = partB(reworkReply());
  return { chunks: [JSON.stringify(reply)], usage: { input_tokens: 1000, output_tokens: 500 } };
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ts-pilot-'));
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  setClientFactoryForTests(() => fakeClient(answer));
});
afterEach(() => {
  setClientFactoryForTests();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function setUp() {
  const file = join(dir, 'tree.pptx');
  writeFileSync(file, await makePptx([{ shapes: simpleTree() }]));
  const trees = [
    { id: 't1', file, page: 1, keyQuestion: KQ, subQuestions: [], stage1: 'OK', stage2: 'Rework', mustCatch: ['Inflow vs outflow is generic'], mustNot: ['Faults the twigs'] },
    { id: 't2', file, page: 1, keyQuestion: 'NOT-OK-TREE: how can Acme survive and grow?', subQuestions: [], stage1: 'Not OK', stage1Faults: ['two questions'] },
  ];
  return { expected: { context: 'calibration/context/peip-student-notes.md', trees }, trees };
}

describe('T-PIL-1: pilot harness', () => {
  it('a dry run prepares every tree and calls no model', async () => {
    const client = fakeClient(answer);
    setClientFactoryForTests(() => client);
    const { expected, trees } = await setUp();
    const lines = [];
    await runPilot({ expected, trees, out: dir, live: false, log: (l) => lines.push(l) });
    expect(lines).toEqual([
      `t1: ready (pptx page 1); Stage 1 on "${KQ}"`,
      't2: ready (pptx page 1); Stage 1 on "NOT-OK-TREE: how can Acme survive and grow?"',
    ]);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });

  it('a run writes verdicts, points for Chris, timings and each tree with its findings', async () => {
    const { expected, trees } = await setUp();
    const { verdicts, runs } = await runPilot({ expected, trees, out: dir, live: true, log: () => {} });
    expect(verdicts).toEqual([
      { id: 't1', stage1Expected: 'OK', stage1: 'OK', stage2Expected: 'Rework', stage2: 'Rework', match: 'yes' },
      { id: 't2', stage1Expected: 'Not OK', stage1: 'Not OK', stage2Expected: '', stage2: '', match: 'yes' },
    ]);
    expect(runs.map((r) => `${r[0]} ${r[1]}`)).toEqual([
      't1 key-question', 't1 read-tree', 't1 review-tree:findings', 't1 review-tree:email', 't2 key-question',
    ]);
    const t1 = readFileSync(join(dir, 't1.md'), 'utf8');
    expect(t1).toContain('## Stage 2: Rework (Chris: Rework)');
    expect(t1).toContain('STAGE2-FINDING');
    expect(t1).toContain('1. How can Acme grow revenue?');
    const pointsCsv = readFileSync(join(dir, 'points.csv'), 'utf8');
    expect(pointsCsv).toContain('"t1","mustCatch","Inflow vs outflow is generic","Stage 2"');
    expect(pointsCsv).toContain('"t1","mustNot","Faults the twigs"');
    expect(pointsCsv).toContain('"t2","stage1Fault","two questions","Stage 1"');
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toContain('| t1 | OK / OK | Rework / Rework | yes |');
    expect(readFileSync(join(dir, 'runs.csv'), 'utf8').split('\n')[0]).toBe('"tree","call","attempt","ms","outcome","inputTokens","outputTokens","servedBy","costUSD"');
  });

  it('prices calls at the indicative rates', () => {
    expect(cost('claude-opus-5-5', 1_000_000, 100_000)).toBeCloseTo(6);
    expect(cost('unknown', 1, 1)).toBe(0);
  });
});
