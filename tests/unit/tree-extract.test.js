// Reading a tree slide (T-SHP-1..5, T-UP-1, T-UP-5) and a PDF page (T-UP-6, T-READ-8) in the
// browser code, without any model call.
import { describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { listSlides, openPptx, readSlide, shapesText, slideContent } from '../../src/tree/pptx.js';
import { parseXml, path } from '../../src/tree/xml.js';
import { openTreeFile, prepareTreePage } from '../../src/tree/treeUpload.js';
import { openPdf, pageImage, pageTextBlock, pageTextLines, recordImage } from '../../src/tree/pdfPage.js';
import { limits } from '../../shared/limits.js';
import { asFile, loadNodePdfjs, makePdf } from '../helpers/fixtures.js';
import { box, connector, group, line, makePptx, picture, simpleTree, smartArtData, smartArtFrame } from '../helpers/pptx.js';

const ASSETS = { standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/' };
const nodeDeps = {
  createCanvas,
  encode: async (c, type, q) => new Uint8Array(await c.encode(type === 'image/png' ? 'png' : 'jpeg', q ? Math.round(q * 100) : undefined)),
  toBase64: (b) => Buffer.from(b).toString('base64'),
};
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function slideOf(shapes, extra = {}) {
  const zip = await openPptx(await makePptx([{ shapes, ...extra }]));
  const deck = await listSlides(zip);
  return { zip, deck, read: await readSlide(zip, deck.slides[0].path) };
}

describe('xml reader', () => {
  it('reads elements, attributes, entities and self-closing tags', () => {
    const doc = parseXml('<?xml version="1.0"?><a:p x="1 &amp; 2"><a:t>Tom &amp; Jerry&#8217;s</a:t><a:br/><!-- note --></a:p>');
    expect(doc.name).toBe('a:p');
    expect(doc.attrs.x).toBe('1 & 2');
    expect(path(doc, 'a:t').text).toBe('Tom & Jerry’s');
    expect(doc.children.map((c) => c.name)).toEqual(['a:t', 'a:br']);
  });
});

describe('T-SHP-1: connected tree', () => {
  it('lists every box with its position and every connector with its connections', async () => {
    const { read, deck } = await slideOf(simpleTree());
    expect(read.shapes).toHaveLength(5);
    expect(read.shapes[0]).toEqual({ id: '2', text: 'How can Acme double profit by 2027?', x: 20, y: 240, w: 120, h: 60, rot: 0 });
    const text = shapesText(read, { n: 1, width: deck.width, height: deck.height });
    expect(text.split('\n')[0]).toBe('Slide 1, 960 × 540 pt');
    expect(text).toContain('S3 "How can Acme grow revenue?" x=200 y=120 w=120 h=40');
    expect(text).toContain('L10 bentConnector3 from (140,270) to (200,140) start=S2 end=S3');
    expect(text).toContain('L11 bentConnector3 from (140,270) to (200,400) start=S2 end=S4');
  });
});

describe('T-SHP-2: loose connectors', () => {
  it('gives their geometry and says they have no connection', async () => {
    const { read } = await slideOf(simpleTree({ connected: false }));
    const text = shapesText(read, { n: 1, width: 960, height: 540 });
    expect(text).toContain('L12 bentConnector3 from (320,140) to (380,95) (no connection)');
  });
});

describe('T-SHP-3: groups and plain lines', () => {
  it('applies nested group transforms and honours flips', async () => {
    // Outer group doubles its child space and moves it to (100, 50); the inner one moves by (10, 10).
    const shapes = group(20, { off: [100, 50], ext: [400, 200], chOff: [0, 0], chExt: [200, 100] }, [
      box(21, 'Inside outer', 10, 10, 50, 20),
      group(22, { off: [100, 0], ext: [100, 100], chOff: [0, 0], chExt: [100, 100] }, [box(23, 'Inside inner', 10, 10, 20, 10)]),
      line(24, 60, 20, 100, 5),
    ]);
    const { read } = await slideOf(shapes);
    expect(read.shapes.map((s) => [s.text, s.x, s.y, s.w, s.h])).toEqual([
      ['Inside outer', 120, 70, 100, 40],
      ['Inside inner', 320, 70, 40, 20],
    ]);
    // A line drawn up and to the right: flipV, so it starts bottom left.
    expect(read.lines[0]).toMatchObject({ x1: 220, y1: 90, x2: 300, y2: 60, shape: 'line', start: null, end: null });
  });
});

describe('T-SHP-4: SmartArt', () => {
  it('reads the hierarchy from the data part, in order', async () => {
    const data = smartArtData([['Root?', [['Grow?', [['New?'], ['Existing?']]], ['Cut?']]]]);
    const { read } = await slideOf(smartArtFrame(5, 'rIdDm'), { rels: { rIdDm: '../diagrams/data1.xml' }, files: { 'ppt/diagrams/data1.xml': data } });
    expect(read.smartArt).toEqual(['- Root?', '  - Grow?', '    - New?', '    - Existing?', '  - Cut?']);
    const c = slideContent(read, { n: 1, width: 960, height: 540 });
    expect(c.kind).toBe('shapes');
    expect(c.text).toContain('[from a SmartArt diagram]\n- Root?\n  - Grow?');
  });
});

describe('T-UP-5: something to read', () => {
  it('a slide with too few boxes, or an EMF picture, has no tree; a PNG picture is sent as an image', async () => {
    const few = await slideOf(box(2, 'Title', 10, 10));
    expect(slideContent(few.read, { n: 1, width: 960, height: 540 })).toEqual({ kind: 'none', reason: 'no_tree' });

    const emf = await slideOf(picture(3, 'rIdP', 0, 0, 900, 500), { rels: { rIdP: '../media/image1.emf' }, files: { 'ppt/media/image1.emf': 'x' } });
    expect(slideContent(emf.read, { n: 1, width: 960, height: 540 }).kind).toBe('none');

    const png = await makePptx([{ shapes: picture(3, 'rIdP', 0, 0, 900, 500), rels: { rIdP: '../media/image1.png' }, files: { 'ppt/media/image1.png': PNG_1PX } }]);
    const opened = await openTreeFile(asFile(png, 'tree.pptx'), { loadPdfjs: loadNodePdfjs });
    const prepared = await prepareTreePage(opened.handle, 1, nodeDeps);
    expect(prepared).toMatchObject({ ok: true, tree: { kind: 'pptx', page: 1, image: { mediaType: 'image/png', base64: PNG_1PX.toString('base64') } } });
    expect(prepared.record).toMatchObject({ mediaType: 'image/png' });
  });

  it('refuses a slide with no tree with TS-U09', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bytes = await makePptx([{ shapes: simpleTree() }, { shapes: box(2, 'Thank you', 10, 10) }]);
    const { handle } = await openTreeFile(asFile(bytes, 'deck.pptx'), { loadPdfjs: loadNodePdfjs });
    expect(handle.pages).toEqual([{ n: 1, label: 'New customers?' }, { n: 2, label: 'Thank you' }]);
    expect(await prepareTreePage(handle, 2, nodeDeps)).toMatchObject({
      ok: false, code: 'TS-U09', message: "We couldn't find a tree on slide 2. Check you picked the right slide, or export the slide to PDF and upload that.",
    });
    expect(await prepareTreePage(handle, 1, nodeDeps)).toMatchObject({ ok: true, tree: { kind: 'pptx', page: 1 }, record: null });
    vi.restoreAllMocks();
  });
});

describe('T-UP-1: file checks', () => {
  const opts = { loadPdfjs: loadNodePdfjs };
  it.each([
    ['notes.docx', 'TS-U01', "notes.docx isn't a PDF or .pptx file. Export your tree to PDF, or save it as .pptx, and upload again."],
    ['tree.txt', 'TS-U01', null],
    ['old.ppt', 'TS-U02', 'old.ppt is an older PowerPoint file. Save it as .pptx, or export it to PDF, and upload again.'],
  ])('%s → %s', async (name, code, message) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await openTreeFile(asFile(new Uint8Array([1]), name), opts);
    expect(r.code).toBe(code);
    if (message) expect(r.message).toBe(message);
    vi.restoreAllMocks();
  });

  it('TS-U03 over 20 MB, before reading; TS-U04 over 25 pages; TS-U07 for a damaged file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const arrayBuffer = vi.fn();
    expect(await openTreeFile({ name: 'big.pdf', size: 21 * 1024 * 1024, arrayBuffer }, opts)).toMatchObject({ code: 'TS-U03' });
    expect(arrayBuffer).not.toHaveBeenCalled();
    const long = await openTreeFile(asFile(await makePdf(Array(26).fill('x')), 'long.pdf'), { ...opts, assetsBase: null });
    expect(long).toMatchObject({ code: 'TS-U04', message: 'This file has 26 pages or slides. A tree file is limited to 25. Upload just the pages with your tree.' });
    expect((await openTreeFile(asFile(await makePdf(Array(25).fill('x')), 'ok.pdf'), { ...opts, assetsBase: null })).ok).toBe(true);
    expect(await openTreeFile(asFile(new Uint8Array([37, 80, 68, 70, 1]), 'broken.pdf'), opts)).toMatchObject({ code: 'TS-U07', detail: 'InvalidPDFException' });
    vi.restoreAllMocks();
  });

  it('blocks a case on the chosen slide (TS-U06)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bytes = await makePptx([{ shapes: simpleTree() + box(9, 'This case was written by Professor Lee solely as a basis for class discussion.', 10, 500) }]);
    const { handle } = await openTreeFile(asFile(bytes, 'case.pptx'), opts);
    expect(await prepareTreePage(handle, 1, nodeDeps)).toMatchObject({ ok: false, code: 'TS-U06' });
    vi.restoreAllMocks();
  });
});

async function treePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Title page', { x: 50, y: 790, size: 12, font });
  const p = doc.addPage([842, 595]);
  p.drawText('How can Acme', { x: 40, y: 300, size: 12, font });
  p.drawText('double profit?', { x: 40, y: 285, size: 12, font });
  p.drawText('Grow revenue?', { x: 300, y: 400, size: 12, font });
  p.drawText('Cut', { x: 300, y: 200, size: 12, font });
  p.drawText('costs?', { x: 324, y: 200, size: 12, font });
  p.drawLine({ start: { x: 150, y: 300 }, end: { x: 290, y: 400 } });
  return doc.save();
}

describe('T-UP-6, T-READ-8: a PDF page', () => {
  it('renders the page at 2,000 px as PNG, and the record copy at 1,600 px as JPEG', async () => {
    const { doc, close } = await openPdf(await treePdf(), await loadNodePdfjs(), ASSETS);
    const img = await pageImage(doc, 2, nodeDeps);
    expect(img).toMatchObject({ mediaType: 'image/png', width: 2000 });
    expect(img.height).toBe(Math.ceil(2000 * 595 / 842));
    expect([...img.bytes.slice(1, 4)]).toEqual([80, 78, 71]);
    const rec = await recordImage(doc, 2, nodeDeps);
    expect(rec).toMatchObject({ mediaType: 'image/jpeg', width: 1600 });
    await close();
  });

  it('falls back to JPEG when the PNG is over the limit', async () => {
    const { doc, close } = await openPdf(await treePdf(), await loadNodePdfjs(), ASSETS);
    const saved = limits.treeImageMaxBytes;
    limits.treeImageMaxBytes = 10;
    try {
      expect((await pageImage(doc, 2, nodeDeps)).mediaType).toBe('image/jpeg');
    } finally {
      limits.treeImageMaxBytes = saved;
    }
    await close();
  });

  it('gives the text layer as lines from the top left, merging runs on one baseline', async () => {
    const { doc, close } = await openPdf(await treePdf(), await loadNodePdfjs(), ASSETS);
    const lines = await pageTextLines(doc, 2);
    expect(lines.map((l) => l.text)).toEqual(['Grow revenue?', 'How can Acme', 'double profit?', 'Cut costs?']);
    expect(lines[0]).toMatchObject({ x: 300 });
    expect(lines[0].y).toBeGreaterThan(180);
    expect(lines[0].y).toBeLessThan(195);
    const block = pageTextBlock(lines, { n: 2, width: 842, height: 595 });
    expect(block.split('\n')[0]).toBe('Page 2, 842 × 595 pt');
    expect(block).toContain('"Cut costs?" x=300');
    expect(pageTextBlock([], { n: 1, width: 1, height: 1 })).toBe('');
    await close();
  });

  it('prepares a page: image plus text layer, and the record copy', async () => {
    const { handle } = await openTreeFile(asFile(await treePdf(), 'tree.pdf'), { loadPdfjs: loadNodePdfjs, assetsBase: null });
    expect(handle.pageCount).toBe(2);
    const r = await prepareTreePage(handle, 2, nodeDeps);
    expect(r.ok).toBe(true);
    expect(r.tree).toMatchObject({ kind: 'pdf', page: 2, image: { mediaType: 'image/png' } });
    expect(r.tree.pageText).toContain('"Grow revenue?"');
    expect(r.record).toMatchObject({ mediaType: 'image/jpeg', width: 1600 });
  });

  it('a scanned page has no text layer, so only the image goes', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]).drawRectangle({ x: 100, y: 100, width: 300, height: 200 });
    const { handle } = await openTreeFile(asFile(await doc.save(), 'scan.pdf'), { loadPdfjs: loadNodePdfjs, assetsBase: null });
    const r = await prepareTreePage(handle, 1, nodeDeps);
    expect(r.tree.pageText).toBeUndefined();
    expect(r.tree.image.mediaType).toBe('image/png');
  });
});
