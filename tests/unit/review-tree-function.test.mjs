// /api/review-tree (IT-6, spec §7): T-REV-2 (what the model receives), T-SEC-2 (no findings
// reach the browser), checks and request validation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import reviewTree from '../../netlify/functions/review-tree.mjs';
import { reviewTreeMessage } from '../../netlify/lib/stages.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { loadPrompt } from '../../netlify/lib/prompts.mjs';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';
import { FINDING_MARKER, passReply, reworkReply } from '../helpers/stage2.js';

const CODE = 'class-code';
const OUTLINE = 'KEY QUESTION (level 0): How can PEIP achieve positive operating cash flow within the next 12 months?\n[Level 4 left out (12 boxes) to keep the reading short.]\n\n1. How to increase cash inflow?\n2. How to decrease cash outflow?';
const body = (extra = {}) => ({
  keyQuestion: 'How can PEIP achieve positive operating cash flow within the next 12 months?',
  outline: OUTLINE,
  context: { text: '[[p.1]]\nPEIP makes jam.', pageCount: 1 },
  attempt: 1, mode: 'generic', caseId: null,
  ...extra,
});
const post = (b) => new Request('http://localhost/api/review-tree', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TS-Access-Code': CODE }, body: JSON.stringify(b),
});
let client;
function reply(obj) {
  client = fakeClient({ chunks: [typeof obj === 'string' ? obj : JSON.stringify(obj)] });
  setClientFactoryForTests(() => client);
}

beforeEach(() => {
  vi.stubEnv('TS_ACCESS_CODE', CODE);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setClientFactoryForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('T-REV-2: what the model receives', () => {
  it('tags the key question, the outline with its notes, and the context', () => {
    expect(reviewTreeMessage(body())).toBe([
      '<key_question>\nHow can PEIP achieve positive operating cash flow within the next 12 months?\n</key_question>',
      `<tree_outline>\n${OUTLINE}\n</tree_outline>`,
      '<context>\n[[p.1]]\nPEIP makes jam.\n</context>',
    ].join('\n\n'));
  });

  it('sends persona + Stage 2 prompt v1.1 with the review model settings', async () => {
    reply(reworkReply());
    await (await reviewTree(post(body()))).text();
    const params = client.beta.calls[0];
    expect(params.system[0].text.startsWith(loadPrompt('persona').text)).toBe(true);
    expect(params.system[0].text).toContain('# Tree Surgery — Stage 2: tree review');
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 2000 });
  });
});

describe('the reply the browser gets', () => {
  it('T-SEC-2: verdict and email only; no findings, reasons or key question check', async () => {
    reply(reworkReply());
    const res = await reviewTree(post(body()));
    const raw = await res.clone().text();
    expect(raw).not.toContain(FINDING_MARKER);
    for (const key of ['findings', 'verdictReason', 'keyQuestionCheck']) expect(raw).not.toContain(key);
    const final = (await readEvents(res)).at(-1);
    expect(final).toMatchObject({ type: 'result', verdict: 'rework', email: reworkReply().email, promptVersion: 'stage2-tree-review 1.1; persona 1.0' });
    expect(console.log.mock.calls.flat().join('\n')).not.toContain(FINDING_MARKER);
  });

  it('a Pass', async () => {
    reply(passReply());
    expect((await readEvents(await reviewTree(post(body())))).at(-1)).toMatchObject({ type: 'result', verdict: 'pass' });
  });

  it('a reply that breaks a rule comes back as invalid, with form-only errors', async () => {
    const bad = reworkReply();
    bad.email.questions = bad.email.questions.slice(0, 2);
    reply(bad);
    const final = (await readEvents(await reviewTree(post(body())))).at(-1);
    expect(final.type).toBe('invalid');
    expect(JSON.stringify(final)).not.toContain(FINDING_MARKER);
  });
});

describe('request checks', () => {
  it.each([
    ['no outline', { outline: '' }],
    ['no key question', { keyQuestion: ' ' }],
    ['no context', { context: { text: '' } }],
    ['attempt 4', { attempt: 4 }],
  ])('400 for %s, with no model call', async (_label, extra) => {
    reply(reworkReply());
    expect((await reviewTree(post(body(extra)))).status).toBe(400);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });
});
