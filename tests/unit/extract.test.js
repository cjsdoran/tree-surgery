// T-CTX-1..3: extraction, page markers, caps and the no-text rule (IT-11, QT D1).
import { describe, expect, it } from 'vitest';
import { asFile, loadNodePdfjs, makeDocx, makePdf, makePptx, words } from '../helpers/fixtures.js';
import { MESSAGES, buildContext, checkTotals, fileKind, processFile, processPaste } from '../../src/extract/context.js';
import { countWords, decodeXml, splitByWords } from '../../src/extract/text.js';
import { CASE_BLOCK_MESSAGE } from '../../shared/caseDetector.js';

const opts = { loadPdfjs: loadNodePdfjs };
const line = (label) => `${label} ${words(20)}`;

describe('text helpers', () => {
  it('splits every 500 words and keeps line breaks', () => {
    const pages = splitByWords(`First line\n${words(1100)}`, 500);
    expect(pages.map(countWords)).toEqual([500, 500, 102]);
    expect(pages[0].startsWith('First line\n')).toBe(true);
  });

  it('decodes XML entities', () => {
    expect(decodeXml('A &amp; B &lt;C&gt; &#8211; &#x2014; &quot;q&quot;')).toBe('A & B <C> – — "q"');
  });

  it('recognises file types by extension', () => {
    expect(['a.PDF', 'b.docx', 'c.pptx', 'd.doc', 'e'].map(fileKind)).toEqual(['pdf', 'docx', 'pptx', null, null]);
  });
});

describe('T-CTX-1: extraction with page markers', () => {
  it('PDF: one page per page', async () => {
    const pdf = await makePdf([line('Brief page one'), line('Brief page two')]);
    const r = await processFile(asFile(pdf, 'brief.pdf'), opts);
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ name: 'brief.pdf', kind: 'pdf', pageCount: 2, approx: false });
    expect(r.item.pages[0]).toMatch(/^Brief page one retail/);
    expect(r.item.pages[1]).toMatch(/^Brief page two retail/);
  });

  it('.docx: pages from <Pages>, markers every 500 words, approximate', async () => {
    const docx = await makeDocx(`Kick-off notes\n${words(1100)}`, { pages: 3 });
    const r = await processFile(asFile(docx, 'notes.docx'), opts);
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ kind: 'docx', pageCount: 3, approx: true });
    expect(r.item.pages).toHaveLength(3);
    expect(r.item.pages[0]).toMatch(/^Kick-off notes/);
  });

  it('.docx without <Pages>: words ÷ 500 rounded up', async () => {
    const docx = await makeDocx(words(1001));
    const r = await processFile(asFile(docx, 'notes.docx'), opts);
    expect(r.item.pageCount).toBe(3);
  });

  it('.pptx: one page per slide, in order, notes ignored', async () => {
    const slides = Array.from({ length: 11 }, (_, i) => [`Slide ${i + 1} title`, words(25)]);
    const r = await processFile(asFile(await makePptx(slides.slice(0, 10)), 'deck.pptx'), opts);
    expect(r.ok).toBe(true);
    expect(r.item.pageCount).toBe(10);
    expect(r.item.pages[9]).toMatch(/^Slide 10 title\n/);
    expect(r.item.pages.join(' ')).not.toContain('SPEAKER NOTES');
  });

  it('paste: approximate pages every 500 words', () => {
    const r = processPaste(`Our notes\n${words(700)}`);
    expect(r.item).toMatchObject({ name: 'Pasted notes', kind: 'paste', pageCount: 2, approx: true, words: 702 });
  });

  it('D1: numbers pages straight through all files, each headed by its name', () => {
    const a = { name: 'brief.pdf', kind: 'pdf', pageCount: 2, pages: ['A1', 'A2'], approx: false };
    const b = { name: 'deck.pptx', kind: 'pptx', pageCount: 1, pages: ['B1'], approx: false };
    const c = { name: 'Pasted notes', kind: 'paste', pageCount: 2, pages: ['C1', 'C2'], approx: true };
    const built = buildContext([a, b, c]);
    expect(built.text).toBe(
      '=== File: brief.pdf (p.1–2) ===\n[[p.1]]\nA1\n\n[[p.2]]\nA2\n\n' +
      '=== File: deck.pptx (p.3) ===\n[[p.3]]\nB1\n\n' +
      '=== File: Pasted notes (p.4–5) ===\n[[p.4]]\nC1\n\n[[p.5]]\nC2',
    );
    expect(built.pageCount).toBe(5);
    expect(built.approxPages).toEqual([4, 5]);
    expect(built.files.map((f) => [f.firstPage, f.lastPage])).toEqual([[1, 2], [3, 3], [4, 5]]);
  });
});

describe('T-CTX-2: caps', () => {
  it('refuses an 11-page PDF with its page count', async () => {
    const pdf = await makePdf(Array.from({ length: 11 }, (_, i) => line(`Page ${i + 1}`)));
    const r = await processFile(asFile(pdf, 'long.pdf'), opts);
    expect(r).toMatchObject({ ok: false, reason: 'too_many_pages', code: 'TS-U04' });
    expect(r.message).toBe(
      'This file has 11 pages. Context is limited to 10 pages. Upload a shorter extract or paste your notes.',
    );
  });

  it('refuses a 12-slide .pptx', async () => {
    const slides = Array.from({ length: 12 }, (_, i) => [`Slide ${i + 1}`, words(30)]);
    const r = await processFile(asFile(await makePptx(slides), 'deck.pptx'), opts);
    expect(r.message).toMatch(/^This file has 12 pages\./);
  });

  it('refuses a .docx whose <Pages> is 11', async () => {
    const r = await processFile(asFile(await makeDocx(words(800), { pages: 11 }), 'long.docx'), opts);
    expect(r.message).toMatch(/^This file has 11 pages\./);
  });

  it('refuses a paste of 5,001 words', () => {
    const r = processPaste(words(5001));
    expect(r).toMatchObject({ ok: false, reason: 'too_many_words' });
    expect(r.message).toBe('Your notes have 5,001 words. Pasted notes are limited to 5,000 words.');
    expect(processPaste(words(5000)).ok).toBe(true);
  });

  it('refuses context over 10 pages in total', () => {
    const item = (n) => ({ name: `f${n}`, kind: 'pdf', pageCount: n, pages: Array(n).fill('x'), sizeBytes: 10 });
    expect(checkTotals([item(6), item(4)])).toBeNull();
    expect(checkTotals([item(6), item(5)])).toMatchObject({ code: 'TS-U04', message: MESSAGES.totalPages(11, 10) });
  });

  it('refuses files over 10 MB in total', () => {
    const big = { name: 'a', kind: 'pdf', pageCount: 1, pages: ['x'], sizeBytes: 6 * 1024 * 1024 };
    expect(checkTotals([big, big])).toMatchObject({ code: 'TS-U03', message: 'That would bring your files to 12.0 MB. Context is limited to 10 MB in total.' });
  });

  it('refuses unsupported types', async () => {
    const r = await processFile(asFile(new Uint8Array([1, 2, 3]), 'notes.txt'), opts);
    expect(r).toMatchObject({ reason: 'wrong_type', code: 'TS-U01' });
  });

  it('refuses a damaged file without throwing', async () => {
    const r = await processFile(asFile(new Uint8Array([1, 2, 3]), 'broken.pdf'), opts);
    expect(r).toMatchObject({ ok: false, reason: 'unreadable', code: 'TS-U07' });
  });
});

describe('T-CTX-3: no extractable text', () => {
  it('refuses a scanned (image-only) PDF with the readable-text message', async () => {
    const r = await processFile(asFile(await makePdf(['', '', '']), 'scan.pdf'), opts);
    expect(r).toEqual({ ok: false, reason: 'no_text', code: 'TS-U05', message: MESSAGES.noText });
    expect(MESSAGES.noText).toBe("We couldn't read the text in this file. It may be scanned or saved as pictures. Upload the original .pptx, .docx or a text-based PDF.");
  });

  it('refuses when the whole file has under 200 non-space characters', async () => {
    const r = await processFile(asFile(await makePdf(['Page 1', 'Page 2']), 'thin.pdf'), opts);
    expect(r.reason).toBe('no_text');
  });

  it('refuses a .docx with no text', async () => {
    const r = await processFile(asFile(await makeDocx('', { pages: 2 }), 'images.docx'), opts);
    expect(r.reason).toBe('no_text');
  });
});

describe('case detector on uploads (IT-11)', () => {
  it('blocks a case PDF before anything is kept', async () => {
    const pdf = await makePdf([`${words(30)}\nThis case was written by Professor Lee solely as a basis for class discussion.`]);
    const r = await processFile(asFile(pdf, 'case.pdf'), opts);
    expect(r).toEqual({ ok: false, reason: 'case_blocked', code: 'TS-U06', message: CASE_BLOCK_MESSAGE });
    expect(CASE_BLOCK_MESSAGE).not.toMatch(/without context/);
  });

  it('blocks a case marker on any slide', async () => {
    const slides = [['Intro', words(30)], ['Source: Ivey Publishing', words(30)]];
    const r = await processFile(asFile(await makePptx(slides), 'case.pptx'), opts);
    expect(r.reason).toBe('case_blocked');
  });

  it('blocks pasted case text', () => {
    expect(processPaste('Copyright President and Fellows of Harvard College').reason).toBe('case_blocked');
  });
});
