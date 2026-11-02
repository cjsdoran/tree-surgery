// A PDF tree page (spec §6.3, D8, D19): the page rendered to an image for the read call, a smaller
// JPEG for the record, thumbnails for the page picker, and the page's text layer with positions.
// The canvas is passed in (`createCanvas`, `encode`), so the browser uses its own canvas and the
// pilot harness @napi-rs/canvas.
import { limits } from '../../shared/limits.js';

/** pdf.js settings so text in non-embedded fonts and CJK text render (files served from /pdfjs/). */
export function pdfjsAssets(base) {
  return { standardFontDataUrl: `${base}standard_fonts/`, cMapUrl: `${base}cmaps/`, cMapPacked: true, wasmUrl: `${base}wasm/` };
}

export async function openPdf(data, pdfjs, assets = {}) {
  // A plain copy: pdf.js refuses a Node Buffer and may detach what it is given.
  const bytes = new Uint8Array(data);
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0, ...assets });
  const doc = await task.promise;
  return { doc, pageCount: doc.numPages, close: () => task.destroy() };
}

/** Renders page n so its long side is `longSide` pixels, on white. */
export async function renderPage(doc, n, { longSide, createCanvas }) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: longSide / Math.max(base.width, base.height) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

/**
 * The image the read call gets: PNG, or JPEG at 0.9 then 0.8 if the PNG is over
 * treeImageMaxBytes (TS-10).
 * @param {(canvas, type: string, quality?: number) => Promise<Uint8Array>} encode
 * @returns {Promise<{ mediaType: string, bytes: Uint8Array, width: number, height: number }>}
 */
export async function pageImage(doc, n, { createCanvas, encode, longSide = limits.treeImageLongSide }) {
  const canvas = await renderPage(doc, n, { longSide, createCanvas });
  let mediaType = 'image/png';
  let bytes = await encode(canvas, mediaType);
  for (const quality of [0.9, 0.8]) {
    if (bytes.length <= limits.treeImageMaxBytes) break;
    mediaType = 'image/jpeg';
    bytes = await encode(canvas, mediaType, quality);
  }
  return { mediaType, bytes, width: canvas.width, height: canvas.height };
}

/** The record's copy of the page: JPEG at treeRecordImageLongSide, quality 0.85 (spec §6.3). */
export async function recordImage(doc, n, { createCanvas, encode }) {
  const canvas = await renderPage(doc, n, { longSide: limits.treeRecordImageLongSide, createCanvas });
  return { mediaType: 'image/jpeg', bytes: await encode(canvas, 'image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}

/**
 * The page's text layer as lines with positions, in points from the top left (D19). Items on
 * the same baseline and close together are merged into one line. Empty for a scanned page.
 * @returns {Promise<{ text: string, x: number, y: number, w: number, h: number }[]>}
 */
export async function pageTextLines(doc, n) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((it) => typeof it.str === 'string' && it.str.trim())
    .map((it) => {
      const [x, baseline] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
      return { text: it.str.replace(/\s+/g, ' ').trim(), x, y: baseline - h, w: it.width, h };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.min(l.h, it.h) / 2
      && it.x >= l.x + l.w - it.h * 0.2 && it.x - (l.x + l.w) < it.h * 1.2);
    if (line) {
      line.text += ` ${it.text}`;
      line.w = it.x + it.w - line.x;
      line.h = Math.max(line.h, it.h);
    } else lines.push({ ...it });
  }
  page.cleanup();
  return lines.map((l) => ({ text: l.text, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) }));
}

/** The <page_text> block (D19), capped at treeShapesMaxChars. */
export function pageTextBlock(lines, { n, width, height }) {
  if (!lines.length) return '';
  const out = [`Page ${n}, ${Math.round(width)} × ${Math.round(height)} pt`];
  let size = out[0].length;
  for (const l of lines) {
    const line = `"${l.text.replace(/"/g, "'")}" x=${l.x} y=${l.y} w=${l.w} h=${l.h}`;
    if (size + line.length + 1 > limits.treeShapesMaxChars) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

export async function pageSize(doc, n) {
  const v = (await doc.getPage(n)).getViewport({ scale: 1 });
  return { width: v.width, height: v.height };
}
