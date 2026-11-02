// Turns uploaded context files and pasted notes into checked, page-marked text (spec §4, QT D1).
// Order per file: type, size, open, page cap, readable text, case detector. Nothing is kept
// from a file that fails a check. Every refusal carries an error code (spec §12.1).
import { limits } from '../../shared/limits.js';
import { CODES } from '../../shared/errorCodes.js';
import { CASE_BLOCK_MESSAGE, detectCase } from '../../shared/caseDetector.js';
import { extractPdf } from './pdf.js';
import { extractDocx, extractPptx } from './office.js';
import { countWords, formatNumber, splitByWords } from './text.js';

const MB = 1024 * 1024;

export const MESSAGES = {
  wrongType: (name) => `${name} isn't a .pptx, .docx or PDF file. Save it in one of those formats, or paste your notes.`,
  oldFormat: (name) => `${name} is an older PowerPoint or Word file. Save it as .pptx or .docx, or export it to PDF, and upload again.`,
  tooBig: (name, mb, cap) => `${name} is ${mb} MB. A file is limited to ${cap} MB. Compress the pictures, or export it to PDF, and upload again.`,
  unreadable: (name) => `We couldn't open ${name}. It may be damaged. Save it again, or export it to PDF, and upload again.`,
  password: (name) => `${name} is password-protected. Remove the password, or export it again without one, and upload again.`,
  tooManyPages: (n, cap) => `This file has ${formatNumber(n)} pages. Context is limited to ${cap} pages. Upload a shorter extract or paste your notes.`,
  noText: "We couldn't read the text in this file. It may be scanned or saved as pictures. Upload the original .pptx, .docx or a text-based PDF.",
  caseBlocked: CASE_BLOCK_MESSAGE,
  totalPages: (n, cap) =>
    `That would bring your context to ${formatNumber(n)} pages. Context is limited to ${cap} pages in total. Remove a file, upload a shorter extract or paste your notes.`,
  totalSize: (mb, cap) => `That would bring your files to ${mb} MB. Context is limited to ${cap} MB in total.`,
  pasteTooLong: (n, cap) => `Your notes have ${formatNumber(n)} words. Pasted notes are limited to ${formatNumber(cap)} words.`,
  pasteEmpty: 'Paste some notes first.',
  tooManyChars: 'Your context is too long to send. Remove a file or shorten your notes.',
};

/** A refusal: what the student sees, and the code they can quote to Chris. */
export function refuse(reason, code, message, detail) {
  return { ok: false, reason, code, message, ...(detail ? { detail } : {}) };
}

/** Logs a refusal to the browser console: code, error name and message, never file content. */
export function logRefusal(code, err) {
  console.warn(`Tree Surgery ${code}${err?.name ? ` ${err.name}` : ''}`, err?.message ?? '');
}

export function fileKind(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase();
  return ext === 'pdf' || ext === 'docx' || ext === 'pptx' ? ext : null;
}

const isOldOffice = (name) => /\.(ppt|doc|pps|pot|dot)$/i.test(name ?? '');

const nonSpace = (s) => s.replace(/\s+/g, '').length;

/** Character counts behind the readable-text rule. */
export function textStats(pages, pageCount = pages.length) {
  return {
    pageCount,
    totalChars: pages.reduce((n, p) => n + nonSpace(p), 0),
    // A page with no extracted text at all (eg an image) counts as nearly empty.
    nearlyEmptyPages: pageCount - pages.filter((p) => nonSpace(p) >= limits.nearlyEmptyChars).length,
  };
}

// D15: refuse only a scanned or nearly empty file. A deck of short bullets passes.
export function hasReadableText(pages, pageCount = pages.length) {
  const s = textStats(pages, pageCount);
  if (s.pageCount < 1 || s.totalChars < limits.minTotalChars) return false;
  return s.nearlyEmptyPages / s.pageCount <= limits.maxNearlyEmptyShare;
}

// pdf.js names its errors, eg InvalidPDFException; keep only a plain identifier for display.
const errorName = (err) => (/^\w{1,40}$/.test(err?.name ?? '') ? err.name : 'Error');

/**
 * @param {File} file
 * @param {{ maxPages?: number, maxBytes?: number, loadPdfjs: () => Promise<object>,
 *   skipTextCheck?: boolean }} opts skipTextCheck is for tests that measure a refused file
 * @returns {Promise<{ ok: true, item: object } | { ok: false, reason: string, code: string, message: string, detail?: string }>}
 */
export async function processFile(file, { maxPages, maxBytes, loadPdfjs, skipTextCheck = false }) {
  const cap = maxPages ?? limits.contextMaxPages;
  const byteCap = maxBytes ?? Infinity;
  const fail = (reason, code, message, err) => {
    logRefusal(code, err);
    return refuse(reason, code, message, code === CODES.unreadable ? errorName(err) : undefined);
  };

  const kind = fileKind(file.name);
  if (!kind) {
    return isOldOffice(file.name)
      ? fail('old_format', CODES.oldFormat, MESSAGES.oldFormat(file.name))
      : fail('wrong_type', CODES.wrongType, MESSAGES.wrongType(file.name));
  }
  if (file.size > byteCap) {
    return fail('too_big', CODES.tooBig, MESSAGES.tooBig(file.name, (file.size / MB).toFixed(1), byteCap / MB));
  }

  let extracted;
  try {
    const data = await file.arrayBuffer();
    if (kind === 'pdf') extracted = await extractPdf(data, await loadPdfjs(), { maxPages: cap });
    else if (kind === 'docx') extracted = await extractDocx(data);
    else extracted = await extractPptx(data);
  } catch (err) {
    if (err?.name === 'PasswordException') return fail('password', CODES.password, MESSAGES.password(file.name), err);
    return fail('unreadable', CODES.unreadable, MESSAGES.unreadable(file.name), err);
  }

  if (extracted.pageCount > cap) {
    return fail('too_many_pages', CODES.tooManyPages, MESSAGES.tooManyPages(extracted.pageCount, cap));
  }
  if (!skipTextCheck && !hasReadableText(extracted.pages, extracted.pageCount)) {
    return fail('no_text', CODES.noText, MESSAGES.noText);
  }
  if (detectCase(extracted.pages.join('\n')).blocked) {
    return fail('case_blocked', CODES.caseBlocked, MESSAGES.caseBlocked);
  }
  return {
    ok: true,
    item: {
      name: file.name,
      kind,
      sizeBytes: file.size,
      pageCount: extracted.pageCount,
      pages: extracted.pages,
      approx: extracted.approx,
    },
  };
}

export function processPaste(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty', message: MESSAGES.pasteEmpty };
  const words = countWords(trimmed);
  if (words > limits.pasteMaxWords) {
    return refuse('too_many_words', CODES.tooManyPages, MESSAGES.pasteTooLong(words, limits.pasteMaxWords));
  }
  if (detectCase(trimmed).blocked) {
    logRefusal(CODES.caseBlocked);
    return refuse('case_blocked', CODES.caseBlocked, MESSAGES.caseBlocked);
  }
  const pages = splitByWords(trimmed, limits.wordsPerEstimatedPage);
  return {
    ok: true,
    item: { name: 'Pasted notes', kind: 'paste', sizeBytes: 0, pageCount: pages.length, pages, approx: true, words },
  };
}

// Checks the context as a whole once a new item is added. Returns a refusal or null.
export function checkTotals(items) {
  const pages = items.reduce((n, i) => n + i.pageCount, 0);
  if (pages > limits.contextMaxPages) return refuse('too_many_pages', CODES.tooManyPages, MESSAGES.totalPages(pages, limits.contextMaxPages));
  const bytes = items.reduce((n, i) => n + (i.sizeBytes || 0), 0);
  if (bytes > limits.contextMaxMB * MB) {
    return refuse('too_big', CODES.tooBig, MESSAGES.totalSize((bytes / MB).toFixed(1), limits.contextMaxMB));
  }
  if (buildContext(items).text.length > limits.contextMaxChars) return refuse('too_long', CODES.tooBig, MESSAGES.tooManyChars);
  return null;
}

/**
 * Joins all items into one text, numbering pages straight through (D1). Every page gets a
 * [[p.N]] marker, and each file starts with a line naming it.
 * @returns {{ text: string, pageCount: number, approxPages: number[], files: object[] }}
 */
export function buildContext(items) {
  const blocks = [];
  const approxPages = [];
  const files = [];
  let n = 0;
  for (const item of items) {
    const first = n + 1;
    const body = item.pages.map((page) => {
      n++;
      if (item.approx) approxPages.push(n);
      return `[[p.${n}]]\n${page}`;
    });
    const range = first === n ? `p.${first}` : `p.${first}–${n}`;
    blocks.push(`=== File: ${item.name} (${range}) ===\n${body.join('\n\n')}`);
    files.push({ name: item.name, kind: item.kind, pageCount: item.pageCount, firstPage: first, lastPage: n });
  }
  return { text: blocks.join('\n\n'), pageCount: n, approxPages, files };
}
