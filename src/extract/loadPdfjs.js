// Loads pdf.js in the browser on first use, with its worker served from our own origin.
// The legacy build (D18): the modern build needs recent features (eg Promise.withResolvers)
// that older Safari and some mainland China browsers lack.
let pending = null;

export function loadPdfjs() {
  if (!pending) {
    pending = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    }).catch((err) => {
      // Let a later upload try again rather than keep a failed load.
      pending = null;
      throw err;
    });
  }
  return pending;
}
