// Tests on Chris's real files, reused from Question Time (test plan §1). They live in tests/fixtures/private/, which is
// git-ignored, and each block skips until its folder exists:
//   cases/   Set A: published case PDFs              T-DET-3 (all blocked)
//   briefs/  Set B: capstone briefs and kick-off notes  T-DET-4 (none blocked)
//   edge/    Set E: scanned.pdf, long.pdf (11+ pages)  T-CTX-3, T-CTX-2
// Nothing here calls a model.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectCase } from '../../shared/caseDetector.js';
import { fileKind, processFile } from '../../src/extract/context.js';
import { extractPdf } from '../../src/extract/pdf.js';
import { extractDocx, extractPptx } from '../../src/extract/office.js';
import { loadNodePdfjs } from '../helpers/fixtures.js';

const ROOT = 'tests/fixtures/private';
const filesIn = (sub) => {
  const dir = join(ROOT, sub);
  return existsSync(dir) ? readdirSync(dir).filter((f) => fileKind(f)).map((f) => join(dir, f)) : [];
};
const asFile = (path) => new File([readFileSync(path)], path.split(/[\\/]/).pop());

// Full text, with no page cap, so the detector sees the whole document.
async function fullText(path) {
  const data = readFileSync(path);
  const kind = fileKind(path);
  const r = kind === 'pdf' ? await extractPdf(data, await loadNodePdfjs()) : kind === 'docx' ? await extractDocx(data) : await extractPptx(data);
  return r.pages.join('\n');
}

const cases = filesIn('cases');
const briefs = filesIn('briefs');

describe.skipIf(!cases.length)('T-DET-3: Set A case PDFs are all blocked', () => {
  it.each(cases)('%s', async (path) => {
    const result = detectCase(await fullText(path));
    expect(result.blocked, `no marker matched in ${path}`).toBe(true);
    // Through the upload path, nothing is kept either way (blocked, too long or unreadable).
    expect((await processFile(asFile(path), { loadPdfjs: loadNodePdfjs })).ok).toBe(false);
  }, 60000);
});

describe.skipIf(!briefs.length)('T-DET-4: Set B briefs are never blocked', () => {
  it.each(briefs)('%s', async (path) => {
    const result = detectCase(await fullText(path));
    expect(result, `blocked by ${result.reasons.join(', ')}`).toEqual({ blocked: false, reasons: [] });
  }, 60000);
});

describe.skipIf(!existsSync(join(ROOT, 'edge')))('Set E edge cases', () => {
  it.skipIf(!existsSync(join(ROOT, 'edge', 'scanned.pdf')))('T-CTX-3: the scanned PDF is refused with the no-text message', async () => {
    const r = await processFile(asFile(join(ROOT, 'edge', 'scanned.pdf')), { loadPdfjs: loadNodePdfjs });
    expect(r.reason).toBe('no_text');
  }, 60000);

  it.skipIf(!existsSync(join(ROOT, 'edge', 'long.pdf')))('T-CTX-2: the long PDF is refused with its page count', async () => {
    const r = await processFile(asFile(join(ROOT, 'edge', 'long.pdf')), { loadPdfjs: loadNodePdfjs });
    expect(r.reason).toBe('too_many_pages');
    expect(r.message).toMatch(/^This file has \d+ pages\. Context is limited to 10 pages\./);
  }, 60000);
});
