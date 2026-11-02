// Builds small PDF, .docx and .pptx files in memory, so the synthetic fixtures need no binaries.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One PDF page per string. An empty string draws a grey box only, like a scanned page. */
export async function makePdf(pageTexts) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([595, 842]);
    if (!text) {
      page.drawRectangle({ x: 50, y: 50, width: 495, height: 742, opacity: 0.3 });
      continue;
    }
    let y = 790;
    for (const line of text.split('\n')) {
      page.drawText(line, { x: 50, y, size: 10, font });
      y -= 14;
    }
  }
  return doc.save();
}

/** Word document with one paragraph per line; `pages` writes docProps/app.xml <Pages>. */
export async function makeDocx(text, { pages } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const paras = text.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
  if (pages !== undefined) {
    zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>${pages}</Pages></Properties>`);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** PowerPoint with one slide per entry; each entry is an array of paragraphs. */
export async function makePptx(slides) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  slides.forEach((paras, i) => {
    const body = paras.map((p) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${escapeXml(p)}</a:t></a:r></a:p>`).join('');
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    // Notes are never read.
    zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, '<a:p><a:t>SPEAKER NOTES</a:t></a:p>');
  });
  return zip.generateAsync({ type: 'uint8array' });
}

export function asFile(bytes, name) {
  return new File([bytes], name);
}

/** n words of plausible client-brief text. */
export function words(n, word = 'retail') {
  return Array.from({ length: n }, (_, i) => (i % 12 === 11 ? `${word}.` : word)).join(' ');
}

export async function loadNodePdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

/** A two-page context item, as the context step keeps it. */
export function sampleContextItem() {
  return { name: 'brief.pdf', kind: 'pdf', sizeBytes: 2000, pageCount: 2, approx: false, pages: [`PEIP brief ${words(40)}`, `Board notes ${words(40)}`] };
}
