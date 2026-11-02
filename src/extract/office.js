// .docx and .pptx text extraction: mammoth for Word, slide XML through jszip for PowerPoint.
import { decodeXml, splitByWords } from './text.js';
import { limits } from '../../shared/limits.js';

// jszip loads on first use, so it stays out of the first-page bundle.
const loadJSZip = async () => (await import('jszip')).default;

/**
 * Word: pages come from docProps/app.xml <Pages> if present, else words ÷ 500 rounded up.
 * Page markers are always every 500 words, so they are approximate.
 */
export async function extractDocx(data, { mammoth } = {}) {
  const lib = mammoth ?? (await import('mammoth')).default;
  const zip = await (await loadJSZip()).loadAsync(data);
  const appXml = await zip.file('docProps/app.xml')?.async('string');
  const declared = appXml ? Number(/<Pages>\s*(\d+)\s*<\/Pages>/i.exec(appXml)?.[1]) : NaN;

  // mammoth's browser build reads `arrayBuffer`; its Node build (used by the tests) reads `buffer`.
  const arrayBuffer = toArrayBuffer(data);
  const input = typeof Buffer === 'undefined' ? { arrayBuffer } : { arrayBuffer, buffer: Buffer.from(arrayBuffer) };
  const { value } = await lib.extractRawText(input);
  const text = value.replace(/\n{3,}/g, '\n\n').trim();
  const pages = splitByWords(text, limits.wordsPerEstimatedPage);
  const pageCount = Number.isFinite(declared) && declared > 0 ? declared : Math.max(1, pages.length);
  return { pageCount, pages, approx: true };
}

/** PowerPoint: one page per slide, in slide order. Speaker notes are not read. */
export async function extractPptx(data) {
  const zip = await (await loadJSZip()).loadAsync(data);
  const slides = Object.keys(zip.files)
    .map((name) => ({ name, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);

  const pages = [];
  for (const slide of slides) {
    const xml = await zip.file(slide.name).async('string');
    const paragraphs = [];
    for (const p of xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? []) {
      const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
      const line = runs.join('').trim();
      if (line) paragraphs.push(line);
    }
    pages.push(paragraphs.join('\n'));
  }
  return { pageCount: slides.length, pages, approx: false };
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
