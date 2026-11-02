// Text helpers for extraction: word counts, approximate pages and XML text.

export function countWords(text) {
  return (String(text ?? '').match(/\S+/g) ?? []).length;
}

// Splits text into chunks of `perPage` words, keeping the original line breaks.
// Used for .docx and pasted notes, whose page markers are approximate.
export function splitByWords(text, perPage) {
  const source = String(text ?? '');
  const pages = [];
  const re = /\S+/g;
  let start = 0;
  let count = 0;
  let m;
  while ((m = re.exec(source))) {
    if (count > 0 && count % perPage === 0) {
      pages.push(source.slice(start, m.index).trim());
      start = m.index;
    }
    count++;
  }
  pages.push(source.slice(start).trim());
  return pages;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function formatNumber(n) {
  return new Intl.NumberFormat('en-GB').format(n);
}
