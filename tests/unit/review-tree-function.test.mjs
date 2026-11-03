// /api/review-tree in two calls (IT-6, spec §7.1, D24): T-REV-2 (what the model receives),
// T-SEC-2 (Part A reaches the browser only sealed), the token's checks and request validation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import reviewTree, { EXPIRED_MESSAGE } from '../../netlify/functions/review-tree.mjs';
import { reviewTreeMessage } from '../../netlify/lib/stages.mjs';
import { open, seal } from '../../netlify/lib/seal.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { loadPrompt } from '../../netlify/lib/prompts.mjs';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';
import { FINDING_MARKER, partA, partB, passReply, reworkReply } from '../helpers/stage2.js';

const CODE = 'class-code';
const KEY = 'sk-ant-test';
const KQ = 'How can PEIP achieve positive operating cash flow within the next 12 months?';
const OUTLINE = `KEY QUESTION (level 0): ${KQ}\n[Level 4 left out (12 boxes) to keep the reading short.]\n\n1. How to increase cash inflow?\n2. How to decrease cash outflow?`;
const body = (extra = {}) => ({
  part: 'findings', keyQuestion: KQ, outline: OUTLINE,
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
const final = async (b) => (await readEvents(await reviewTree(post(b)))).at(-1);
const sealed = (reply_) => seal(partA(reply_), { keyQuestion: KQ, outline: OUTLINE }, { secret: KEY });

beforeEach(() => {
  vi.stubEnv('TS_ACCESS_CODE', CODE);
  vi.stubEnv('ANTHROPIC_API_KEY', KEY);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setClientFactoryForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('T-REV-2: what the model receives', () => {
  it('Part A: the part, key question, outline with its notes, and context', () => {
    expect(reviewTreeMessage(body(), 'findings')).toBe([
      '<part>findings</part>',
      `<key_question>\n${KQ}\n</key_question>`,
      `<tree_outline>\n${OUTLINE}\n</tree_outline>`,
      '<context>\n[[p.1]]\nPEIP makes jam.\n</context>',
    ].join('\n\n'));
  });

  it('Part B: the same, plus Part A as findings', () => {
    const m = reviewTreeMessage(body(), 'email', partA(reworkReply()));
    expect(m.startsWith('<part>email</part>')).toBe(true);
    expect(m).toContain(`<findings>\n${JSON.stringify(partA(reworkReply()), null, 2)}\n</findings>`);
  });

  it('both parts use persona + Stage 2 prompt v1.2; Part A with reviewTree settings, Part B with reviewEmail', async () => {
    reply(partA(reworkReply()));
    await final(body());
    expect(client.beta.calls[0].system[0].text.startsWith(loadPrompt('persona').text)).toBe(true);
    expect(client.beta.calls[0].system[0].text).toContain('### Part A — `<part>findings</part>`');
    expect(client.beta.calls[0]).toMatchObject({ max_tokens: 2000 });
    reply(partB(reworkReply()));
    await final(body({ part: 'email', token: sealed(reworkReply()) }));
    expect(client.beta.calls[0]).toMatchObject({ max_tokens: 1500 });
    expect(client.beta.calls[0].messages[0].content).toContain(FINDING_MARKER);
  });
});

describe('T-SEC-2: Part A reaches the browser only sealed', () => {
  it('the findings call returns a token, not the findings', async () => {
    reply(partA(reworkReply()));
    const res = await reviewTree(post(body()));
    const raw = await res.clone().text();
    expect(raw).not.toContain(FINDING_MARKER);
    for (const k of ['"findings":', 'verdict', 'keyQuestionCheck']) expect(raw).not.toContain(k);
    const ev = (await readEvents(res)).at(-1);
    expect(ev).toMatchObject({ type: 'result', part: 'findings' });
    expect(Buffer.from(ev.token, 'base64url').toString('latin1')).not.toContain('STAGE2');
    expect(open(ev.token, { keyQuestion: KQ, outline: OUTLINE }, { secret: KEY })).toEqual(partA(reworkReply()));
    expect(console.log.mock.calls.flat().join('\n')).not.toContain(FINDING_MARKER);
  });

  it('the email call returns the verdict from Part A and the email, nothing else', async () => {
    reply(partB(reworkReply()));
    const res = await reviewTree(post(body({ part: 'email', token: sealed(reworkReply()) })));
    const raw = await res.clone().text();
    expect(raw).not.toContain(FINDING_MARKER);
    expect((await readEvents(res)).at(-1)).toMatchObject({ type: 'result', part: 'email', verdict: 'rework', email: reworkReply().email });
  });

  it('the email is checked against the sealed verdict', async () => {
    reply(partB(passReply()));
    const ev = await final(body({ part: 'email', token: sealed(reworkReply()) }));
    expect(ev.type).toBe('invalid');
    expect(ev.errors[0]).toMatch(/^The opener must be exactly/);
  });
});

describe('the token', () => {
  it.each([
    ['forged', () => 'bm90LWEtdG9rZW4tYXQtYWxsLWp1c3QtdGV4dA'],
    ['for another tree', () => seal(partA(reworkReply()), { keyQuestion: KQ, outline: 'another outline' }, { secret: KEY })],
    ['sealed with another key', () => seal(partA(reworkReply()), { keyQuestion: KQ, outline: OUTLINE }, { secret: 'other' })],
    ['expired', () => seal(partA(reworkReply()), { keyQuestion: KQ, outline: OUTLINE }, { secret: KEY, now: Date.now() - 2 * 3600 * 1000 })],
  ])('a token %s is refused with 400 and no model call', async (_label, make) => {
    reply(partB(reworkReply()));
    const res = await reviewTree(post(body({ part: 'email', token: make() })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_token', message: EXPIRED_MESSAGE });
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });
});

describe('request checks', () => {
  it.each([
    ['no part', { part: undefined }],
    ['an unknown part', { part: 'both' }],
    ['an email call with no token', { part: 'email' }],
    ['no outline', { outline: '' }],
    ['no context', { context: { text: '' } }],
    ['attempt 4', { attempt: 4 }],
  ])('400 for %s, with no model call', async (_label, extra) => {
    reply(partA(reworkReply()));
    expect((await reviewTree(post(body(extra)))).status).toBe(400);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });
});
