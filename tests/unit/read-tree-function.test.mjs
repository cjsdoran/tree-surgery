// /api/read-tree (IT-5, spec §6.5): T-READ-2 (no persona, the right blocks), T-READ-3 (bad
// outlines retried), the request checks, and what the browser gets back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import readTree from '../../netlify/functions/read-tree.mjs';
import { readTreeContent } from '../../netlify/lib/stages.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { loadPrompt } from '../../netlify/lib/prompts.mjs';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';

const CODE = 'class-code';
const KQ = 'How can Acme double profit by 2027?';
const pdfBody = (extra = {}) => ({
  round: 'first', keyQuestion: KQ, attempt: 1, mode: 'generic', caseId: null,
  tree: { kind: 'pdf', page: 2, image: { mediaType: 'image/png', base64: 'iVBORw0KGgo=' }, pageText: 'Page 2, 842 × 595 pt\n"Grow?" x=1 y=2 w=3 h=4' },
  ...extra,
});
const pptxBody = (extra = {}) => ({ ...pdfBody(), tree: { kind: 'pptx', page: 1, shapes: 'Slide 1, 960 × 540 pt\nS2 "Root?" x=1 y=2 w=3 h=4' }, ...extra });
const post = (b) => new Request('http://localhost/api/read-tree', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TS-Access-Code': CODE }, body: JSON.stringify(b),
});

const READ = { status: 'read', reason: null, rootAsWritten: KQ, rootDiffers: false, outline: `0 ${KQ}\n1 Grow?\n2 New?\n1 Cut?`, notes: [] };
let client;
function reply(obj) {
  client = fakeClient({ chunks: [typeof obj === 'string' ? obj : JSON.stringify(obj)] });
  setClientFactoryForTests(() => client);
}
const final = async (b) => (await readEvents(await readTree(post(b)))).at(-1);

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

describe('T-READ-2, T-READ-8: what the model receives', () => {
  it('a PDF page: the image block, then the key question and the text layer', () => {
    const content = readTreeContent(pdfBody());
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    expect(content[1].text).toBe(`<agreed_key_question>\n${KQ}\n</agreed_key_question>\n\n<page_text>\nPage 2, 842 × 595 pt\n"Grow?" x=1 y=2 w=3 h=4\n</page_text>`);
  });

  it('a scanned page: the image and the key question only', () => {
    const { pageText: _p, ...tree } = pdfBody().tree;
    expect(readTreeContent(pdfBody({ tree })).at(1).text).toBe(`<agreed_key_question>\n${KQ}\n</agreed_key_question>`);
  });

  it('a slide: text only, with the shapes', () => {
    expect(readTreeContent(pptxBody())).toBe(`<agreed_key_question>\n${KQ}\n</agreed_key_question>\n\n<slide_shapes>\nSlide 1, 960 × 540 pt\nS2 "Root?" x=1 y=2 w=3 h=4\n</slide_shapes>`);
  });

  it('uses the read-tree prompt with no persona, and no context', async () => {
    reply(READ);
    await final(pdfBody({ context: { text: 'CONTEXT', pageCount: 1 } }));
    const params = client.beta.calls[0];
    expect(params.system[0].text).toBe(loadPrompt('read-tree').text);
    expect(params.system[0].text).not.toContain('Daniel Hart');
    expect(JSON.stringify(params.messages)).not.toContain('CONTEXT');
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 2200 });
  });
});

describe('what the browser gets', () => {
  it('a reading: nodes parsed from the outline lines', async () => {
    reply(READ);
    expect(await final(pdfBody())).toMatchObject({
      type: 'result', status: 'read', rootAsWritten: KQ, rootDiffers: false, notes: [],
      nodes: [{ level: 0, text: KQ }, { level: 1, text: 'Grow?' }, { level: 2, text: 'New?' }, { level: 1, text: 'Cut?' }],
      promptVersion: 'read-tree 1.1',
    });
  });

  it('an unreadable page, with its reason', async () => {
    reply({ status: 'unreadable', reason: 'several_trees', rootAsWritten: null, rootDiffers: false, outline: '', notes: [] });
    expect(await final(pdfBody())).toMatchObject({ type: 'result', status: 'unreadable', reason: 'several_trees', nodes: [] });
  });

  it('T-READ-3: a broken outline is invalid, so the browser retries', async () => {
    reply({ ...READ, outline: `0 ${KQ}\n2 Too deep?` });
    const r = await final(pdfBody());
    expect(r.type).toBe('invalid');
    expect(r.errors[0]).toMatch(/more than one level below/);
    reply({ ...READ, outline: '' });
    expect((await final(pdfBody())).errors).toContain('nodes must not be empty when status is "read".');
    reply({ status: 'unreadable', reason: null, rootAsWritten: null, rootDiffers: false, outline: '', notes: [] });
    expect((await final(pdfBody())).errors).toEqual(['An unreadable page needs a reason.']);
  });
});

describe('request checks', () => {
  it.each([
    ['a bad round', { round: 'third' }],
    ['no key question', { keyQuestion: '' }],
    ['a PDF with no image', { tree: { kind: 'pdf', page: 1, pageText: 'x' } }],
    ['a GIF', { tree: { kind: 'pdf', page: 1, image: { mediaType: 'image/gif', base64: 'R0lG' } } }],
    ['a slide with both shapes and an image', { tree: { kind: 'pptx', page: 1, shapes: 'S', image: { mediaType: 'image/png', base64: 'iVBO' } } }],
    ['a slide with neither', { tree: { kind: 'pptx', page: 1 } }],
    ['page 0', { tree: { ...pdfBody().tree, page: 0 } }],
    ['attempt 4', { attempt: 4 }],
  ])('400 for %s, with no model call', async (_label, extra) => {
    reply(READ);
    const res = await readTree(post(pdfBody(extra)));
    expect(res.status).toBe(400);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });

  it('accepts a picture-only slide sent as an image', async () => {
    reply(READ);
    const r = await final(pptxBody({ tree: { kind: 'pptx', page: 1, image: { mediaType: 'image/jpeg', base64: '/9j/4AAQ' } } }));
    expect(r.type).toBe('result');
  });
});

describe('large trees (prompt v1.1, Chris 2 Nov 2026)', () => {
  it('a reading cut off at max_tokens comes back as invalid, telling the model to leave out the bottom level', async () => {
    client = fakeClient({ chunks: ['{"status":"read","outline":"0 Root\n1 A'], stopReason: 'max_tokens' });
    setClientFactoryForTests(() => client);
    const r = await final(pdfBody());
    expect(r).toEqual({ type: 'invalid', errors: ['Your last reply was cut off because the tree is too large. Leave out the bottom level of the tree and add the note for it.'] });
    expect(console.log.mock.calls.map((c) => JSON.parse(c[0])).at(-1)).toMatchObject({ endpoint: 'read-tree', outcome: 'truncated' });
  });

  it('the prompt carries the 60-box rule and keeps levels 0 to 3', () => {
    const text = loadPrompt('read-tree').text;
    expect(text).toContain('more than 60 boxes');
    expect(text).toContain('Never leave out levels 0 to 3.');
    expect(loadPrompt('read-tree').version).toBe('1.1');
  });

  it('a cut-off key question review is still an error, not a retry hint', async () => {
    const { respondWithModel } = await import('../../netlify/lib/anthropic.mjs');
    client = fakeClient({ chunks: ['{'], stopReason: 'max_tokens' });
    setClientFactoryForTests(() => client);
    const res = await respondWithModel({ call: 'keyQuestion', endpoint: 'key-question', system: 'S', content: 'U', promptVersion: 'v', startedAt: Date.now(), finish: () => ({ type: 'result' }) });
    expect((await readEvents(res)).at(-1)).toMatchObject({ type: 'error', error: 'truncated' });
  });
});
