// The access-code guard and size limits on every function (spec §12, T-SET-1 server side),
// the server-side case detector (T-DET-5) and the TS-S01/S02 codes in the logs (T-ERR-1, T-ERR-2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guard } from '../../netlify/lib/guard.mjs';
import { limits } from '../../shared/limits.js';
import { CASE_BLOCK_MESSAGE } from '../../shared/caseDetector.js';
import check from '../../netlify/functions/check.mjs';
import keyQuestion from '../../netlify/functions/key-question.mjs';
import readTree from '../../netlify/functions/read-tree.mjs';
import reviewTree from '../../netlify/functions/review-tree.mjs';
import signOff from '../../netlify/functions/sign-off.mjs';

const CODE = 'test-class-code';
const MODEL_FUNCTIONS = { 'key-question': keyQuestion, 'read-tree': readTree, 'review-tree': reviewTree, 'sign-off': signOff };

function post(body, { code = CODE, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (code !== null) h['X-TS-Access-Code'] = code;
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: h,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const logged = () => console.log.mock.calls.map((c) => JSON.parse(c[0]));

beforeEach(() => {
  vi.stubEnv('TS_ACCESS_CODE', CODE);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('guard', () => {
  it('accepts a POST with the right code and returns the parsed body', async () => {
    const { body, response } = await guard(post({ attempt: 1 }));
    expect(response).toBeUndefined();
    expect(body).toEqual({ attempt: 1 });
  });

  it('rejects other methods with 405', async () => {
    const { response } = await guard(new Request('http://localhost/api/test'));
    expect(response.status).toBe(405);
  });

  it.each([
    ['missing', null],
    ['wrong', 'nope'],
    ['wrong but same length', 'test-class-codX'],
  ])('rejects a %s access code with 401 and the Canvas message', async (_label, code) => {
    const { response } = await guard(post({}, { code }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'bad_access_code',
      message: "That access code isn't recognised. Check Canvas.",
    });
  });

  it("does not accept Question Time's header", async () => {
    const { response } = await guard(post({}, { code: null, headers: { 'X-QT-Access-Code': CODE } }));
    expect(response.status).toBe(401);
  });

  it('T-ERR-1 TS-S01: fails closed with 500 when TS_ACCESS_CODE is not set; only the log names it', async () => {
    vi.stubEnv('TS_ACCESS_CODE', '');
    const res = await check(post({}));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('TS_ACCESS_CODE');
    expect(JSON.parse(text)).toEqual({ error: 'server_misconfigured', message: 'Tree Surgery is not set up correctly. Tell your instructor.' });
    expect(logged().at(-1)).toMatchObject({ endpoint: 'check', outcome: 500, code: 'TS-S01', missing: 'TS_ACCESS_CODE' });
  });

  it('T-ERR-2 TS-S02: logs the code for a bad access code', async () => {
    await check(post({}, { code: 'nope' }));
    expect(logged().at(-1)).toMatchObject({ ts: 'call', endpoint: 'check', outcome: 401, code: 'TS-S02' });
  });

  it('checks the access code before the size limit', async () => {
    const big = 'x'.repeat(limits.requestMaxBytes + 1);
    const { response } = await guard(post(big, { code: 'nope' }));
    expect(response.status).toBe(401);
  });

  it('rejects a request over 1 MB with 413, unless the function allows more', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(limits.requestMaxBytes) });
    expect((await guard(post(big))).response.status).toBe(413);
    expect((await guard(post(big), { maxBytes: limits.readTreeMaxBytes })).response).toBeUndefined();
  });

  it('counts bytes, not characters, against the request limit', async () => {
    // Each 中 is 3 bytes in UTF-8.
    const chars = Math.ceil(limits.requestMaxBytes / 3) + 10;
    const { response } = await guard(post(JSON.stringify({ pad: '中'.repeat(chars) })));
    expect(response.status).toBe(413);
  });

  it.each([
    ['context', { context: { text: 'a'.repeat(limits.contextMaxChars + 1), pageCount: 1 } }],
    ['key question', { keyQuestion: 'a'.repeat(limits.keyQuestionMaxChars + 1) }],
    ['sub-question', { subQuestions: ['ok', 'a'.repeat(limits.subQuestionMaxChars + 1)] }],
    ['too many sub-questions', { subQuestions: Array(limits.subQuestionsMax + 1).fill('How?') }],
    ['slide shapes', { tree: { kind: 'pptx', shapes: 'a'.repeat(limits.treeShapesMaxChars + 1) } }],
    ['page text', { tree: { kind: 'pdf', pageText: 'a'.repeat(limits.treeShapesMaxChars + 1) } }],
    ['outline', { outline: 'a'.repeat(limits.outlineMaxChars + 1) }],
    ['revised outline', { revisedOutline: 'a'.repeat(limits.outlineMaxChars + 1) }],
    ['first email', { firstEmail: 'a'.repeat(limits.emailMaxChars + 1) }],
  ])('rejects an over-long %s with 413', async (_label, body) => {
    expect((await guard(post(body))).response.status).toBe(413);
  });

  it('accepts text at the limits', async () => {
    const { response } = await guard(post({
      keyQuestion: 'a'.repeat(limits.keyQuestionMaxChars),
      subQuestions: Array(limits.subQuestionsMax).fill('a'.repeat(limits.subQuestionMaxChars)),
      outline: 'a'.repeat(limits.outlineMaxChars),
    }));
    expect(response).toBeUndefined();
  });

  it.each(['not json', '[1,2]', 'null'])('rejects a body of %s with 400', async (raw) => {
    const { response } = await guard(post(raw));
    expect(response.status).toBe(400);
  });

  it('logs metadata only, never the request content', async () => {
    await keyQuestion(post({ keyQuestion: 'SECRET STUDENT TEXT' }));
    const lines = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).not.toContain('SECRET STUDENT TEXT');
    expect(logged()[0]).toMatchObject({ ts: 'call', endpoint: 'key-question' });
  });
});

describe('T-DET-5: server-side case detector', () => {
  const CASE = 'This case was written by Professor Lee solely as a basis for class discussion.';
  const bodies = {
    context: { context: { text: `[[p.1]]\n${CASE}`, pageCount: 1 } },
    'key question': { keyQuestion: CASE },
    'sub-question': { subQuestions: [CASE] },
    'slide shapes': { tree: { kind: 'pptx', shapes: `S1 "${CASE}"` } },
    'page text': { tree: { kind: 'pdf', pageText: CASE } },
    outline: { outline: CASE },
    'revised outline': { revisedOutline: CASE },
  };

  for (const [name, fn] of Object.entries(MODEL_FUNCTIONS)) {
    it.each(Object.keys(bodies))(`/api/${name} returns 422 case_blocked for case text in the %s, and logs TS-U06`, async (where) => {
      const res = await fn(post(bodies[where]));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'case_blocked', message: CASE_BLOCK_MESSAGE });
      expect(logged().at(-1)).toMatchObject({ endpoint: name, outcome: 422, code: 'TS-U06' });
    });
  }

  it('checks the access code before the detector', async () => {
    const res = await reviewTree(post(bodies.outline, { code: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('lets a client brief through', async () => {
    const { response } = await guard(post({ context: { text: 'Client brief: grow revenue 15% by 2027.', pageCount: 1 } }));
    expect(response).toBeUndefined();
  });
});

describe('functions', () => {
  it('/api/check returns 204 for the right code and 401 otherwise', async () => {
    expect((await check(post(''))).status).toBe(204);
    expect((await check(post('', { code: 'nope' }))).status).toBe(401);
  });

  it('/api/key-question is guarded (401) and needs a key question, context and attempt (400)', async () => {
    expect((await keyQuestion(post({}, { code: 'nope' }))).status).toBe(401);
    expect((await keyQuestion(post({}))).status).toBe(400);
  });

  it('/api/read-tree is guarded (401) and needs a round, key question, tree and attempt (400)', async () => {
    expect((await readTree(post({}, { code: 'nope' }))).status).toBe(401);
    expect((await readTree(post({}))).status).toBe(400);
  });

  it('/api/review-tree is guarded (401) and needs a key question, outline, context and attempt (400)', async () => {
    expect((await reviewTree(post({}, { code: 'nope' }))).status).toBe(401);
    expect((await reviewTree(post({}))).status).toBe(400);
  });

  it('/api/sign-off is guarded (401) and needs both outlines, the first review and context (400)', async () => {
    expect((await signOff(post({}, { code: 'nope' }))).status).toBe(401);
    expect((await signOff(post({}))).status).toBe(400);
  });

  it('/api/read-tree takes a tree image over 1 MB; the others refuse it', async () => {
    const body = { tree: { kind: 'pdf', image: { mediaType: 'image/png', base64: 'A'.repeat(2 * 1024 * 1024) } } };
    // Past the size check, so the body checks answer: 400, not 413.
    expect((await readTree(post(body))).status).toBe(400);
    expect((await reviewTree(post(body))).status).toBe(413);
  });
});
