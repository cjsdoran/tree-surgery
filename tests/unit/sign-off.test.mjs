// The sign-off (IT-8, spec §8): T-SIGN-1 (what the model receives: both trees, the first review,
// no findings), T-SIGN-2 (the checks behind the email), T-EML-7, and the assembled prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import signOff from '../../netlify/functions/sign-off.mjs';
import { fillSignOff, signOffMessage } from '../../netlify/lib/stages.mjs';
import { loadPrompt, promptSection, signOffSystemPrompt } from '../../netlify/lib/prompts.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { checkSignOff, countWords } from '../../shared/emailCheck.js';
import { checkSchema } from '../../shared/schemaCheck.js';
import { config } from '../../shared/limits.js';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';
import { notThereYet, signedOff } from '../helpers/signoff.js';

const CODE = 'class-code';
const KQ = 'How can PEIP achieve positive operating cash flow within the next 12 months?';

const body = (extra = {}) => ({
  keyQuestion: KQ,
  firstOutline: `KEY QUESTION (level 0): ${KQ}\n\n1. How to increase cash inflow?\n2. How to decrease cash outflow?`,
  firstVerdict: 'first_cut',
  firstEmail: 'Subject: PEIP issue tree: first review\n\nThe first cut needs rethinking. Send back to me when you have reworked it.',
  revisedOutline: `KEY QUESTION (level 0): ${KQ}\n\n1. How can PEIP grow operating cash flow from jam?\n2. How can PEIP improve cash flow from non-jam businesses?`,
  context: { text: '[[p.1]]\nPEIP makes jam.', pageCount: 1 },
  attempt: 1, mode: 'generic', caseId: null,
  ...extra,
});
const post = (b) => new Request('http://localhost/api/sign-off', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TS-Access-Code': CODE }, body: JSON.stringify(b),
});
let client;
function reply(obj) {
  client = fakeClient({ chunks: [JSON.stringify(obj)] });
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

describe('the sign-off prompt', () => {
  it('inserts Stage 2 Steps 1 and 2 and Never word for word, and nothing else of Stage 2', () => {
    const p = signOffSystemPrompt();
    const stage2 = loadPrompt('stage2-tree-review').text;
    expect(p.text).toContain(promptSection(stage2, '### Step 2', '### Step 3'));
    expect(p.text).toContain(promptSection(stage2, '### Never', '## Output'));
    expect(p.text).not.toContain('### Step 3');
    expect(p.text).not.toContain('### Step 4');
    expect(p.text).not.toContain('{{STAGE2_RULES}}');
    expect(p.text.startsWith(loadPrompt('persona').text)).toBe(true);
    expect(p.version).toBe('sign-off 1.0; stage2 rules 1.2; persona 1.0');
  });
});

describe('T-SIGN-1: what the model receives', () => {
  it('tags the key question, both outlines, the first review and the context; no findings', () => {
    const m = signOffMessage(body());
    expect(m.split('\n\n<').map((s) => s.match(/^<?([a-z_]+)>/)?.[1])).toEqual(['key_question', 'first_outline', 'first_review', 'revised_outline', 'context']);
    expect(m).toContain('<first_review>\nVerdict: first_cut\n\nSubject: PEIP issue tree: first review');
    expect(m).not.toContain('findings');
  });

  it('uses the sign-off model settings', async () => {
    reply(signedOff());
    await (await signOff(post(body()))).text();
    expect(client.beta.calls[0]).toMatchObject({ max_tokens: config.models.signOff.maxTokens });
    expect(client.beta.calls[0].system[0].text).toContain('# Tree Surgery — sign-off after the revision');
  });
});

describe('T-SIGN-2, T-EML-7: the checks', () => {
  it('passes both fixtures and their schema', () => {
    for (const r of [signedOff(), notThereYet()]) {
      expect(checkSchema('sign-off', r).ok).toBe(true);
      expect(checkSignOff(r)).toEqual({ ok: true, errors: [] });
    }
  });

  it('Signed off with stillFails, or with nothing improved, fails; Not there yet without stillFails fails', () => {
    const a = signedOff();
    a.email.stillFails = ['x'];
    expect(checkSignOff(a).errors).toContain('Signed off has nothing in stillFails: stillFails must be [].');
    const b = signedOff();
    b.email.improved = [];
    expect(checkSignOff(b).errors).toContain('Signed off needs at least one point in improved.');
    const c = notThereYet();
    c.email.stillFails = [];
    expect(checkSignOff(c).errors[0]).toMatch(/needs 1–4 points in stillFails/);
  });

  it('wants the verdict’s opener, at most 4 held points, a one-sentence lesson and 100–250 words', () => {
    const a = notThereYet();
    a.email.opener = config.openers.signedOff;
    expect(checkSignOff(a).errors[0]).toMatch(/^The opener must be exactly/);
    const b = signedOff();
    b.email.heldPoints = ['a', 'b', 'c', 'd', 'e'];
    b.email.lesson = 'One. Two.';
    expect(checkSignOff(b).errors).toEqual(expect.arrayContaining(['heldPoints has at most 4 points; it has 5.', 'lesson must be one sentence.']));
    const long = signedOff();
    long.email.heldPoints = [Array(200).fill('word').join(' ')];
    expect(checkSignOff(long).errors.at(-1)).toMatch(/100–250 words; it has \d+/);
    expect(countWords(Object.values(signedOff().email).flat().join(' '))).toBeGreaterThan(100);
  });

  it('fills omitted empty fields and drops a model-written P.S. prefix', () => {
    const r = signedOff();
    delete r.email.stillFails;
    r.email.ps = 'P.S. Check node 2.1.';
    const filled = fillSignOff(r);
    expect(filled.email.stillFails).toEqual([]);
    expect(filled.email.ps).toBe('Check node 2.1.');
  });
});

describe('the function', () => {
  it('returns the verdict and the email', async () => {
    reply(notThereYet());
    expect((await readEvents(await signOff(post(body())))).at(-1)).toMatchObject({ type: 'result', verdict: 'not_there_yet', email: notThereYet().email });
  });

  it.each([
    ['no revised outline', { revisedOutline: '' }],
    ['a first verdict of Pass (a Pass has no revision)', { firstVerdict: 'pass' }],
    ['no first email', { firstEmail: '' }],
    ['attempt 0', { attempt: 0 }],
  ])('400 for %s, with no model call', async (_label, extra) => {
    reply(signedOff());
    expect((await signOff(post(body(extra)))).status).toBe(400);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });
});
