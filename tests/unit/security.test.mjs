// T-SEC-1: the built site and the function responses hold no API key and no prompt text.
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import check from '../../netlify/functions/check.mjs';
import keyQuestion from '../../netlify/functions/key-question.mjs';
import readTree from '../../netlify/functions/read-tree.mjs';
import reviewTree from '../../netlify/functions/review-tree.mjs';
import signOff from '../../netlify/functions/sign-off.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { fakeClient } from '../helpers/fakeAnthropic.js';

const FAKE_KEY = 'sk-ant-test-0000000000000000000000';
const ACCESS = 'secret-class-code-123';

// Distinctive lines of every prompt: long enough not to match ordinary UI copy.
const promptLines = readdirSync('prompts')
  .flatMap((f) => readFileSync(join('prompts', f), 'utf8').split('\n'))
  .map((l) => l.replace(/^[-#*\d.\s>|]+/, '').replace(/\*\*/g, '').trim())
  .filter((l) => l.length >= 40 && !l.startsWith('<!--') && !/^[{"[]/.test(l))
  .map((l) => l.slice(0, 50));

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('T-SEC-1: built site', () => {
  let outDir;
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'ts-dist-'));
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    process.env.TS_ACCESS_CODE = ACCESS;
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  }, 120000);
  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TS_ACCESS_CODE;
    rmSync(outDir, { recursive: true, force: true });
  });

  it('contains no API key, access code or prompt text', () => {
    const files = filesUnder(outDir).filter((f) => /\.(js|mjs|css|html|json|map|txt)$/.test(f));
    expect(files.length).toBeGreaterThan(2);
    expect(promptLines.length).toBeGreaterThan(50);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain(FAKE_KEY);
      expect(text, file).not.toContain('sk-ant-');
      expect(text, file).not.toContain(ACCESS);
      expect(text, file).not.toContain('ANTHROPIC_API_KEY');
      for (const line of promptLines) expect(text.includes(line), `${file}: ${line}`).toBe(false);
    }
  });

  it('publishes no source maps, prompts, calibration, docs, tests or env files', () => {
    const names = filesUnder(outDir).map((f) => f.slice(outDir.length + 1).replace(/\\/g, '/'));
    expect(names.filter((n) => /\.map$|^prompts\/|^\.env|^reference\/|^tests\/|^calibration\/|^docs\//.test(n))).toEqual([]);
  });
});

describe('T-SEC-1: function responses', () => {
  const post = (body, code = ACCESS) => new Request('http://localhost/api/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TS-Access-Code': code }, body: JSON.stringify(body),
  });
  beforeEach(() => {
    vi.stubEnv('TS_ACCESS_CODE', ACCESS);
    vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setClientFactoryForTests(() => fakeClient({ chunks: ['{"ok":true}'] }));
  });
  afterEach(() => {
    setClientFactoryForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const context = { text: '[[p.1]]\nBrief', pageCount: 1 };
  const CALLS = [
    ['check', check, {}],
    ['key-question', keyQuestion, { keyQuestion: 'How can PEIP survive?', subQuestions: [], context, attempt: 1 }],
    ['read-tree', readTree, { round: 'first', keyQuestion: 'How can PEIP survive?', tree: { kind: 'pptx', page: 1, shapes: 'S1 "How?"' } }],
    ['review-tree', reviewTree, { part: 'findings', keyQuestion: 'How can PEIP survive?', outline: 'KEY QUESTION (level 0): How?', context, attempt: 1 }],
    ['sign-off', signOff, { keyQuestion: 'How?', firstOutline: 'A', firstEmail: 'B', revisedOutline: 'C', context, attempt: 1 }],
  ];

  it.each(CALLS)('/api/%s returns no key, access code or prompt text, on success or failure', async (_name, fn, body) => {
    for (const res of [await fn(post(body)), await fn(post(body, 'wrong')), await fn(post({ junk: true }))]) {
      const text = await res.text();
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain(ACCESS);
      for (const line of promptLines) expect(text.includes(line), line).toBe(false);
      for (const [k, v] of res.headers) expect(`${k}: ${v}`).not.toContain(FAKE_KEY);
    }
  });
});
