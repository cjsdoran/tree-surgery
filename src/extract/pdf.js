// PDF text extraction with pdf.js. The pdf.js module is passed in, so the browser can use the
// worker build and the tests the Node build.

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {object} pdfjs the pdfjs-dist module
 * @param {{ maxPages?: number }} [opts] stop before reading text when the file is over the cap
 * @returns {Promise<{ pageCount: number, pages: string[], approx: false }>}
 */
export async function extractPdf(data, pdfjs, { maxPages = Infinity } = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Text only, so no fonts are rendered; verbosity 0 keeps font warnings out of the console.
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    if (pageCount > maxPages) return { pageCount, pages: [], approx: false };
    const pages = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim());
      page.cleanup();
    }
    return { pageCount, pages, approx: false };
  } finally {
    await task.destroy();
  }
}
