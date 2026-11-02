// /api/key-question (IT-3, spec §5): the message the model gets (T-KQ-6), the request checks,
// and the reply the browser gets: verdict and email, never the findings (T-SEC-2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import keyQuestion from '../../netlify/functions/key-question.mjs';
import { keyQuestionMessage } from '../../netlify/lib/stages.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { loadPrompt } from '../../netlify/lib/prompts.mjs';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';
import { FINDING_MARKER, json, notOkReply, okReply } from '../helpers/stage1.js';

const CODE = 'class-code';
const body = (extra = {}) => ({
  keyQuestion: '  How can PEIP achieve sustainable cashflow of $200k within 18 months?  ',
  subQuestions: ['', 'How can PEIP grow jam sales?'],
  context: { text: '[[p.1]]\nPEIP makes jam.', pageCount: 1 },
  attempt: 1,
  mode: 'generic',
  caseId: null,
  ...extra,
});
const post = (b) => new Request('http://localhost/api/key-question', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TS-Access-Code': CODE }, body: JSON.stringify(b),
});

let client;
function reply(obj) {
  client = fakeClient({ chunks: [typeof obj === 'string' ? obj : json(obj)] });
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

describe('T-KQ-6: what the model receives', () => {
  it('tags the key question, numbered sub-questions and context', () => {
    expect(keyQuestionMessage(body())).toBe([
      '<key_question>\nHow can PEIP achieve sustainable cashflow of $200k within 18 months?\n</key_question>',
      '<sub_questions>\n1. How can PEIP grow jam sales?\n</sub_questions>',
      '<context>\n[[p.1]]\nPEIP makes jam.\n</context>',
    ].join('\n\n'));
  });

  it('says None when there are no sub-questions, and appends previous errors on a retry', () => {
    const m = keyQuestionMessage(body({ subQuestions: [], previousErrors: ['The opener must be exactly: "x"'] }));
    expect(m).toContain('<sub_questions>\nNone\n</sub_questions>');
    expect(m.endsWith('<previous_errors>\n- The opener must be exactly: "x"\n</previous_errors>')).toBe(true);
  });

  it('sends persona + Stage 1 prompt as the system prompt, with the Stage 1 model settings', async () => {
    reply(okReply());
    await (await keyQuestion(post(body()))).text();
    const params = client.beta.calls[0];
    const system = params.system[0].text;
    expect(system.startsWith(loadPrompt('persona').text)).toBe(true);
    expect(system).toContain('# Tree Surgery — Stage 1: key question review');
    expect(system).toContain('Return one JSON object and nothing else');
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 900 });
    expect(params.messages[0].content).toContain('<key_question>');
  });
});

describe('the reply the browser gets', () => {
  it('T-SEC-2: Not OK: verdict and email only, no findings', async () => {
    reply(notOkReply());
    const res = await keyQuestion(post(body()));
    const raw = await res.clone().text();
    expect(raw).not.toContain(FINDING_MARKER);
    expect(raw).not.toContain('findings');
    const final = (await readEvents(res)).at(-1);
    expect(final).toMatchObject({ type: 'result', verdict: 'not_ok', email: notOkReply().email });
    expect(final.promptVersion).toBe('stage1-key-question 1.1; persona 1.0');
    const logs = console.log.mock.calls.flat().join('\n');
    expect(logs).not.toContain(FINDING_MARKER);
  });

  it('OK: verdict and a null email', async () => {
    reply(okReply());
    const final = (await readEvents(await keyQuestion(post(body())))).at(-1);
    expect(final).toMatchObject({ type: 'result', verdict: 'ok', email: null });
  });

  it('a reply that fails a check comes back as invalid with form-only errors', async () => {
    const bad = notOkReply();
    bad.email.opener = 'Try again.';
    reply(bad);
    const final = (await readEvents(await keyQuestion(post(body())))).at(-1);
    expect(final.type).toBe('invalid');
    expect(final.errors[0]).toMatch(/^The opener must be exactly/);
    expect(JSON.stringify(final)).not.toContain(FINDING_MARKER);
  });

  it('a reply that is not JSON, or breaks the schema, comes back as invalid', async () => {
    reply('Sorry, here is my review: ...');
    expect((await readEvents(await keyQuestion(post(body())))).at(-1)).toEqual({
      type: 'invalid', errors: ['Your reply was not a single valid JSON object. Return only the JSON object.'],
    });
    reply({ verdict: 'maybe', findings: [], email: null });
    const final = (await readEvents(await keyQuestion(post(body())))).at(-1);
    expect(final.type).toBe('invalid');
    expect(final.errors[0]).toMatch(/^Schema: /);
  });
});

describe('request checks', () => {
  it.each([
    ['no key question', { keyQuestion: '  ' }],
    ['no context', { context: { text: '', pageCount: 0 } }],
    ['sub-questions not strings', { subQuestions: [1] }],
    ['attempt 0', { attempt: 0 }],
    ['attempt 4', { attempt: 4 }],
  ])('400 for %s, with no model call', async (_label, extra) => {
    reply(okReply());
    const res = await keyQuestion(post(body(extra)));
    expect(res.status).toBe(400);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });
});
