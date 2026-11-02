// Tree upload (IT-4, spec §6.2): one PDF or .pptx, checked in the browser in order: type, size,
// open, page cap; then, for the page the student picks, something to read (TS-9) and the case
// detector. Every refusal carries an error code. The file itself is never stored.
import { limits } from '../../shared/limits.js';
import { CODES } from '../../shared/errorCodes.js';
import { CASE_BLOCK_MESSAGE, detectCase } from '../../shared/caseDetector.js';
import { formatNumber } from '../extract/text.js';
import { logRefusal, refuse } from '../extract/context.js';
import { openPdf, pageImage, pageSize, pageTextBlock, pageTextLines, pdfjsAssets, recordImage } from './pdfPage.js';
import { firstText, listSlides, openPptx, pictureBase64, readSlide, slideContent } from './pptx.js';

const MB = 1024 * 1024;
const RECORD_PICTURE_MAX_CHARS = 1_500_000;

export const TREE_MESSAGES = {
  wrongType: (name) => `${name} isn't a PDF or .pptx file. Export your tree to PDF, or save it as .pptx, and upload again.`,
  oldFormat: (name) => `${name} is an older PowerPoint file. Save it as .pptx, or export it to PDF, and upload again.`,
  tooBig: (name, mb) => `${name} is ${mb} MB. A tree file is limited to ${limits.treeMaxMB} MB. Compress the pictures, or export the tree page to PDF, and upload again.`,
  unreadable: (name) => `We couldn't open ${name}. It may be damaged. Save it again, or export it to PDF, and upload again.`,
  password: (name) => `${name} is password-protected. Remove the password, or export it again without one, and upload again.`,
  tooManyPages: (n) => `This file has ${formatNumber(n)} pages or slides. A tree file is limited to ${limits.treeMaxPages}. Upload just the pages with your tree.`,
  noTree: (n) => `We couldn't find a tree on slide ${n}. Check you picked the right slide, or export the slide to PDF and upload that.`,
  caseBlocked: CASE_BLOCK_MESSAGE,
};

export function treeKind(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase();
  return ext === 'pdf' || ext === 'pptx' ? ext : null;
}

const errorName = (err) => (/^\w{1,40}$/.test(err?.name ?? '') ? err.name : 'Error');
const fail = (reason, code, message, err) => {
  logRefusal(code, err);
  return refuse(reason, code, message, code === CODES.unreadable ? errorName(err) : undefined);
};

/**
 * Opens a tree file and lists its pages or slides.
 * @param {File} file
 * @param {{ loadPdfjs: () => Promise<object>, assetsBase?: string }} deps
 * @returns {Promise<{ ok: true, handle: object } | { ok: false, reason: string, code: string, message: string, detail?: string }>}
 */
export async function openTreeFile(file, { loadPdfjs, assetsBase = '/pdfjs/' }) {
  const kind = treeKind(file.name);
  if (!kind) {
    return /\.(ppt|pps|pot)$/i.test(file.name)
      ? fail('old_format', CODES.oldFormat, TREE_MESSAGES.oldFormat(file.name))
      : fail('wrong_type', CODES.wrongType, TREE_MESSAGES.wrongType(file.name));
  }
  if (file.size > limits.treeMaxMB * MB) {
    return fail('too_big', CODES.tooBig, TREE_MESSAGES.tooBig(file.name, (file.size / MB).toFixed(1)));
  }

  let handle;
  try {
    const data = await file.arrayBuffer();
    if (kind === 'pdf') {
      const pdf = await openPdf(data, await loadPdfjs(), assetsBase ? pdfjsAssets(assetsBase) : {});
      handle = { kind, pdf, pageCount: pdf.pageCount, pages: Array.from({ length: pdf.pageCount }, (_, i) => ({ n: i + 1, label: null })) };
    } else {
      const zip = await openPptx(data);
      const deck = await listSlides(zip);
      handle = { kind, zip, deck, pageCount: deck.slides.length, pages: [] };
      if (deck.slides.length <= limits.treeMaxPages) {
        for (const s of deck.slides) handle.pages.push({ n: s.n, label: firstText(await readSlide(zip, s.path)) });
      }
    }
  } catch (err) {
    if (err?.name === 'PasswordException') return fail('password', CODES.password, TREE_MESSAGES.password(file.name), err);
    return fail('unreadable', CODES.unreadable, TREE_MESSAGES.unreadable(file.name), err);
  }

  if (handle.pageCount > limits.treeMaxPages || handle.pageCount < 1) {
    await handle.pdf?.close();
    return fail('too_many_pages', CODES.tooManyPages, TREE_MESSAGES.tooManyPages(handle.pageCount));
  }
  return { ok: true, handle: { ...handle, name: file.name, sizeBytes: file.size } };
}

/**
 * Prepares the chosen page for the read call and the record.
 * @param {object} handle from openTreeFile
 * @param {number} n the page or slide, 1-based
 * @param {{ createCanvas: (w: number, h: number) => object, encode: (canvas, type: string, quality?: number) => Promise<Uint8Array>,
 *   toBase64: (bytes: Uint8Array) => string }} deps
 * @returns {Promise<{ ok: true, tree: object, record: object|null } | { ok: false, reason: string, code: string, message: string }>}
 *   `tree` is the request's tree field; `record` the image kept for the record PDF.
 */
export async function prepareTreePage(handle, n, { createCanvas, encode, toBase64 }) {
  if (handle.kind === 'pdf') {
    const { doc } = handle.pdf;
    const lines = await pageTextLines(doc, n);
    const pageText = pageTextBlock(lines, { n, ...(await pageSize(doc, n)) });
    if (detectCase(pageText).blocked) return fail('case_blocked', CODES.caseBlocked, TREE_MESSAGES.caseBlocked);
    const image = await pageImage(doc, n, { createCanvas, encode });
    const rec = await recordImage(doc, n, { createCanvas, encode });
    return {
      ok: true,
      tree: { kind: 'pdf', page: n, image: { mediaType: image.mediaType, base64: toBase64(image.bytes) }, ...(pageText ? { pageText } : {}) },
      record: { mediaType: rec.mediaType, base64: toBase64(rec.bytes), width: rec.width, height: rec.height },
    };
  }

  const { zip, deck } = handle;
  const slide = deck.slides[n - 1];
  const read = await readSlide(zip, slide.path);
  const content = slideContent(read, { n, width: deck.width, height: deck.height });
  if (content.kind === 'none') return fail('no_tree', CODES.noTree, TREE_MESSAGES.noTree(n));
  if (content.kind === 'shapes') {
    if (detectCase(content.text).blocked) return fail('case_blocked', CODES.caseBlocked, TREE_MESSAGES.caseBlocked);
    if (content.text.length > limits.treeShapesMaxChars) return fail('too_long', CODES.tooBig, 'Your slide has too much text to send. Upload just the tree.');
    return { ok: true, tree: { kind: 'pptx', page: n, shapes: content.text }, record: null };
  }
  const base64 = await pictureBase64(zip, content.picture);
  // A picture over the image limit can't be sent; the student can export the slide to PDF.
  if (base64.length * 0.75 > limits.treeImageMaxBytes) return fail('no_tree', CODES.noTree, TREE_MESSAGES.noTree(n));
  const image = { mediaType: content.picture.mediaType, base64 };
  // The record keeps the picture only if it fits comfortably in browser storage (spec §13).
  const record = base64.length <= RECORD_PICTURE_MAX_CHARS ? { ...image, width: content.picture.w, height: content.picture.h } : null;
  return { ok: true, tree: { kind: 'pptx', page: n, image }, record };
}

/** Releases what openTreeFile holds. */
export async function closeTree(handle) {
  await handle?.pdf?.close();
}
