// The model call pattern every model function uses (spec §9): pings while Daniel works, then one
// final event built by the stage's `finish`, so the findings never leave the server (TS-5).
// Also the browser side, modelCall in src/api.js. T-REV-5, T-REV-6, T-TIME-1, T-TIME-2.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callModel, modelParams, respondWithModel, setClientFactoryForTests, FALLBACK_BETA } from '../../netlify/lib/anthropic.mjs';
import { modelCall } from '../../src/api.js';
import { config } from '../../shared/limits.js';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';

const FINDING = 'INTERNAL-FINDING-7f3a';
const REPLY = JSON.stringify({ verdict: 'rework', findings: [{ finding: FINDING }], email: { subject: 'Re: tree' } });

// A stage's finish: parse, then drop the findings before anything goes out.
const finish = (text) => {
  const { findings: _f, ...rest } = JSON.parse(text);
  return { type: 'result', ...rest };
};

function run(script, opts = {}) {
  const client = fakeClient(script);
  setClientFactoryForTests(() => client);
  const res = respondWithModel({
    call: 'reviewTree', endpoint: 'review-tree', system: 'SYSTEM', content: 'USER',
    promptVersion: 'stage2-tree-review 1.1', startedAt: Date.now(), attempt: 1, finish, ...opts,
  });
  return { client, res };
}

const logged = () => console.log.mock.calls.map((c) => JSON.parse(c[0]));

const saved = { keepAliveSeconds: config.keepAliveSeconds, functionBudgetSeconds: config.functionBudgetSeconds };

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setClientFactoryForTests();
  Object.assign(config, saved);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('respondWithModel', () => {
  it('sends meta, then one result built by finish, with no model text and no findings (TS-5)', async () => {
    const { res } = run({ chunks: [REPLY.slice(0, 20), REPLY.slice(20)], servedBy: 'claude-opus-5-5' });
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/x-ndjson/);
    const raw = await r.text();
    expect(raw).not.toContain(FINDING);
    expect(raw).not.toContain('findings');
    const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(events.map((e) => e.type)).toEqual(['meta', 'result']);
    expect(events[1]).toMatchObject({ verdict: 'rework', email: { subject: 'Re: tree' }, promptVersion: 'stage2-tree-review 1.1', servedBy: 'claude-opus-5-5' });
    expect(events[1].durationMs).toBeTypeOf('number');
  });

  it('sends invalid with the errors when finish rejects the reply', async () => {
    const { res } = run({ chunks: [REPLY] }, { finish: () => ({ type: 'invalid', errors: ['Question 3 has two question marks.'] }) });
    const events = await readEvents(await res);
    expect(events.at(-1)).toEqual({ type: 'invalid', errors: ['Question 3 has two question marks.'] });
    expect(logged().at(-1)).toMatchObject({ outcome: 'invalid', code: 'TS-S04' });
  });

  it('turns a finish that throws (eg bad JSON) into invalid, never an exception', async () => {
    const { res } = run({ chunks: ['not json'] });
    const events = await readEvents(await res);
    expect(events.at(-1).type).toBe('invalid');
  });

  it('T-REV-5: pings while the model is silent, then the result', async () => {
    config.keepAliveSeconds = 0.05;
    const { res } = run({ chunks: [REPLY], thinkMs: 200 });
    const events = await readEvents(await res);
    expect(events.filter((e) => e.type === 'ping').length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1).type).toBe('result');
  });

  it.each([
    ['truncated', { chunks: [REPLY], stopReason: 'max_tokens' }, "Daniel's reply was cut short. Try again.", 'TS-S05'],
    ['refusal', { chunks: [REPLY], stopReason: 'refusal' }, "Daniel couldn't reply to this. Check your text and try again.", 'TS-S05'],
    ['model_error', { failBeforeFirst: true }, "Daniel couldn't reply just now. Try again in a minute.", 'TS-S05'],
    ['model_error', { chunks: [REPLY, REPLY], failAfter: 1 }, "Daniel couldn't reply just now. Try again in a minute.", 'TS-S05'],
  ])('T-REV-6: %s ends with an error event and is logged with its code', async (error, script, message, code) => {
    const { res } = run(script);
    const events = await readEvents(await res);
    expect(events.at(-1)).toEqual({ type: 'error', error, message });
    expect(events.some((e) => e.type === 'result')).toBe(false);
    expect(logged().at(-1)).toMatchObject({ endpoint: 'review-tree', outcome: error, code });
  });

  it('T-TIME-1: stops at the function budget and sends a timeout event', async () => {
    config.functionBudgetSeconds = 1;
    const { res } = run({ chunks: [REPLY], hang: true });
    const events = await readEvents(await res);
    expect(events.at(-1)).toEqual({ type: 'error', error: 'timeout', message: 'Daniel is taking too long to reply. Try again.' });
    expect(logged().at(-1)).toMatchObject({ outcome: 'timeout', code: 'TS-S03' });
  });

  it('T-TIME-2: logs duration and tokens, never the prompt, the reply or findings', async () => {
    const { res } = run({ chunks: [REPLY], usage: { input_tokens: 1234, output_tokens: 321 } }, { round: 'first' });
    await (await res).text();
    const line = logged().at(-1);
    expect(line).toMatchObject({ ts: 'call', endpoint: 'review-tree', round: 'first', attempt: 1, outcome: 'ok', code: null, inputTokens: 1234, outputTokens: 321 });
    expect(line.durationMs).toBeTypeOf('number');
    const all = console.log.mock.calls.flat().join('\n');
    for (const secret of [FINDING, 'SYSTEM', 'USER', 'Re: tree']) expect(all).not.toContain(secret);
  });

  it('TS-S01: answers 500 without an API key and calls no model', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { client, res } = run({ chunks: [REPLY] });
    const r = await res;
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('ANTHROPIC_API_KEY');
    expect(client.calls.length + client.beta.calls.length).toBe(0);
    expect(logged().at(-1)).toMatchObject({ code: 'TS-S01', missing: 'ANTHROPIC_API_KEY' });
  });
});

describe('modelParams and callModel', () => {
  it('takes model, tokens, effort and fallback from config; caches the system prompt', () => {
    const p = modelParams('readTree', 'SYS', [{ type: 'text', text: 'hi' }]);
    expect(p).toMatchObject({
      model: config.models.readTree.model,
      max_tokens: config.models.readTree.maxTokens,
      output_config: { effort: 'low' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
  });

  it('returns the whole reply, for the pilot harness, findings included', async () => {
    setClientFactoryForTests(() => fakeClient({ chunks: [REPLY] }));
    const r = await callModel({ call: 'keyQuestion', system: 'S', content: 'U' });
    expect(r).toMatchObject({ ok: true, text: REPLY });
  });
});

describe('modelCall (browser)', () => {
  const ndjson = (...events) => new Response(events.map((e) => JSON.stringify(e)).join('\n'), { status: 200 });
  const call = (res) => modelCall('/api/review-tree', { a: 1 }, 'code', { fetchImpl: async () => res });

  it('sends the access code header and returns the result without its type', async () => {
    const fetchImpl = vi.fn(async () => ndjson({ type: 'meta' }, { type: 'ping' }, { type: 'result', verdict: 'pass' }));
    const r = await modelCall('/api/review-tree', { a: 1 }, 'secret', { fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers['X-TS-Access-Code']).toBe('secret');
    expect(r).toEqual({ ok: true, result: { verdict: 'pass' } });
  });

  it('reports invalid with the errors to send back', async () => {
    const r = await call(ndjson({ type: 'meta' }, { type: 'invalid', errors: ['x'] }));
    expect(r).toMatchObject({ ok: false, error: 'invalid', errors: ['x'] });
  });

  it('reports an error event, an HTTP error and a stream with no final event', async () => {
    expect(await call(ndjson({ type: 'error', error: 'timeout', message: 'slow' }))).toMatchObject({ ok: false, error: 'timeout', message: 'slow' });
    expect(await call(new Response('{"error":"case_blocked","message":"blocked"}', { status: 422 }))).toMatchObject({ ok: false, status: 422, error: 'case_blocked', message: 'blocked' });
    expect(await call(ndjson({ type: 'meta' }))).toMatchObject({ ok: false, error: 'incomplete' });
  });

  it('reports a network failure', async () => {
    const r = await modelCall('/api/x', {}, 'c', { fetchImpl: async () => { throw new Error('offline'); } });
    expect(r).toMatchObject({ ok: false, status: 0, error: 'network' });
  });
});
