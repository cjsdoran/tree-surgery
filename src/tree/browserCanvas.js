// Canvas helpers for the browser: the tree page is rendered and encoded here (spec §6.3).
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('Canvas could not be encoded'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, type, quality);
  });
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const dataUrl = (image) => `data:${image.mediaType};base64,${image.base64}`;

/** Small JPEG thumbnails of every page of a PDF, for the page picker. */
export async function pdfThumbnails(handle, width = 200) {
  const { renderPage } = await import('./pdfPage.js');
  const out = [];
  for (const p of handle.pages) {
    const canvas = await renderPage(handle.pdf.doc, p.n, { longSide: width * 1.42, createCanvas });
    out.push(canvas.toDataURL('image/jpeg', 0.7));
  }
  return out;
}

export const browserDeps = { createCanvas, encode, toBase64 };
