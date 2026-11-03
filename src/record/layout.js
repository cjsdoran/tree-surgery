// A small flowing-text layout on pdf-lib for the record (IT-10), from Question Time: A4 pages,
// wrapped rich text, headings, bullets, images, a running header and the footer on every page.
//
// The record uses the standard PDF fonts (Helvetica), which need no font file and print
// anywhere. They cover Western European characters only, so anything else is replaced with "?"
// and the record says so (see toPdfText).

export const A4 = { width: 595.28, height: 841.89 };
const MARGIN = { left: 56, right: 56, top: 72, bottom: 72 };

// Characters Helvetica can draw (WinAnsi): printable ASCII, Latin-1, and the typographic extras.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS = { '→': '->', '←': '<-', '‐': '-', '‑': '-', '‒': '-', '−': '-', '′': "'", '″': '"', '\t': '    ', ' ': ' ' };

/** @returns {{ text: string, replaced: string[] }} the characters that could not be drawn */
export function toPdfText(input) {
  const replaced = [];
  let text = '';
  for (const ch of String(input ?? '').replace(/\r\n?/g, '\n')) {
    if (REPLACEMENTS[ch] !== undefined) text += REPLACEMENTS[ch];
    else {
      const code = ch.codePointAt(0);
      if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) text += ch;
      else {
        text += '?';
        replaced.push(ch);
      }
    }
  }
  return { text, replaced };
}

export class Layout {
  /**
   * @param {object} lib the pdf-lib module
   * @param {object} doc PDFDocument
   * @param {object} fonts { regular, bold, italic }
   * @param {{ runningHeader: string, footer: string }} labels
   */
  constructor(lib, doc, fonts, labels) {
    this.lib = lib;
    this.doc = doc;
    this.fonts = fonts;
    this.labels = labels;
    // Distinct characters that had to print as "?".
    this.replaced = new Set();
    this.colors = {
      navy: lib.rgb(0x1f / 255, 0x3a / 255, 0x5f / 255),
      text: lib.rgb(0x1f / 255, 0x29 / 255, 0x33 / 255),
      grey: lib.rgb(0x47 / 255, 0x51 / 255, 0x5c / 255),
      accent: lib.rgb(0x9a / 255, 0x4a / 255, 0),
      rule: lib.rgb(0xc4 / 255, 0xcb / 255, 0xd3 / 255),
    };
    this.newPage();
  }

  get width() {
    return A4.width - MARGIN.left - MARGIN.right;
  }

  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN.top;
  }

  ensure(height) {
    if (this.y - height < MARGIN.bottom) this.newPage();
  }

  space(h) {
    this.y -= h;
  }

  clean(s) {
    const { text, replaced } = toPdfText(s);
    replaced.forEach((ch) => this.replaced.add(ch));
    return text;
  }

  /**
   * Draws wrapped rich text. A run is { text, font?, color?, underline?, strike? }.
   * @param {object[]} runs
   * @param {{ size?: number, indent?: number, gap?: number, bullet?: string }} [opts]
   */
  rich(runs, { size = 10, indent = 0, gap = 4, bullet = null } = {}) {
    const lineHeight = size * 1.35;
    const left = MARGIN.left + indent + (bullet ? 12 : 0);
    const maxWidth = A4.width - MARGIN.right - left;
    // Words of the same run on one line are drawn as one string, so spacing comes from the font.
    const lines = this.wrap(runs, size, maxWidth).map((line) => line.reduce((merged, seg) => {
      const last = merged[merged.length - 1];
      if (last && last.run === seg.run) last.text += seg.text;
      else merged.push({ ...seg });
      return merged;
    }, []));
    lines.forEach((line, i) => {
      this.ensure(lineHeight);
      const baseline = this.y - size;
      if (bullet && i === 0) {
        this.page.drawText(bullet, { x: MARGIN.left + indent, y: baseline, size, font: this.fonts.regular, color: this.colors.text });
      }
      let x = left;
      line.forEach((seg, j) => {
        const font = seg.run.font ?? this.fonts.regular;
        const color = seg.run.color ?? this.colors.text;
        // Trailing spaces at the end of a line are not drawn or marked.
        const text = j === line.length - 1 ? seg.text.replace(/ +$/, '') : seg.text;
        const w = font.widthOfTextAtSize(text, size);
        if (text) this.page.drawText(text, { x, y: baseline, size, font, color });
        const marked = text.replace(/^ +| +$/g, '');
        if ((seg.run.underline || seg.run.strike) && marked) {
          // Mark the words, not the spaces around them.
          const lead = font.widthOfTextAtSize(text.match(/^ */)[0], size);
          const markW = font.widthOfTextAtSize(marked, size);
          const y = seg.run.underline ? baseline - 1.5 : baseline + size * 0.32;
          this.page.drawLine({ start: { x: x + lead, y }, end: { x: x + lead + markW, y }, thickness: 0.8, color });
        }
        x += w;
      });
      this.y -= lineHeight;
    });
    this.y -= gap;
  }

  // Greedy word wrap across runs; "\n" forces a break.
  wrap(runs, size, maxWidth) {
    const lines = [[]];
    let lineWidth = 0;
    for (const raw of runs) {
      const run = { ...raw, text: this.clean(raw.text) };
      const font = run.font ?? this.fonts.regular;
      const pieces = run.text.split(/(\n| +)/).filter((p) => p !== '');
      for (const piece of pieces) {
        if (piece === '\n') {
          lines.push([]);
          lineWidth = 0;
          continue;
        }
        let w = font.widthOfTextAtSize(piece, size);
        const isSpace = /^ +$/.test(piece);
        if (lineWidth + w > maxWidth && !isSpace && lineWidth > 0) {
          lines.push([]);
          lineWidth = 0;
        }
        if (isSpace && lineWidth === 0) continue;
        let text = piece;
        // A single word wider than the line is cut into pieces that fit.
        while (font.widthOfTextAtSize(text, size) > maxWidth) {
          let n = text.length - 1;
          while (n > 1 && font.widthOfTextAtSize(text.slice(0, n), size) > maxWidth) n--;
          lines[lines.length - 1].push({ text: text.slice(0, n), run });
          lines.push([]);
          text = text.slice(n);
        }
        w = font.widthOfTextAtSize(text, size);
        lines[lines.length - 1].push({ text, run });
        lineWidth += w;
      }
    }
    return lines.filter((l, i) => l.length || i < lines.length - 1);
  }

  text(s, opts = {}) {
    this.rich([{ text: s, font: opts.font, color: opts.color }], opts);
  }

  heading(s, level = 1) {
    const size = { 1: 18, 2: 14, 3: 11 }[level];
    const before = { 1: 6, 2: 12, 3: 8 }[level];
    this.ensure(size * 3);
    this.space(before);
    this.rich([{ text: s, font: this.fonts.bold, color: level === 3 ? this.colors.text : this.colors.navy }], { size, gap: level === 2 ? 2 : 3 });
    if (level === 2) this.rule();
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: MARGIN.left, y: this.y }, end: { x: A4.width - MARGIN.right, y: this.y }, thickness: 1, color: this.colors.navy });
    this.y -= 8;
  }

  /** Label: value rows, label in bold. */
  field(label, value, opts = {}) {
    this.rich([{ text: `${label}: `, font: this.fonts.bold }, { text: value }], { gap: 2, ...opts });
  }

  /**
   * Draws an embedded image (pdf-lib PDFImage) at the full text width, or smaller to fit
   * `maxHeight`; starts a new page if it doesn't fit on this one.
   */
  image(img, { maxHeight = 520, gap = 8 } = {}) {
    const scale = Math.min(this.width / img.width, maxHeight / img.height, 1.5);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + gap);
    this.page.drawImage(img, { x: MARGIN.left, y: this.y - h, width: w, height: h });
    this.page.drawRectangle({ x: MARGIN.left, y: this.y - h, width: w, height: h, borderColor: this.colors.rule, borderWidth: 0.5 });
    this.y -= h + gap;
  }

  /** Adds the running header and the footer disclaimer, with page numbers, to every page. */
  finish() {
    const pages = this.doc.getPages();
    pages.forEach((page, i) => {
      const header = this.clean(this.labels.runningHeader);
      page.drawText(header, { x: MARGIN.left, y: A4.height - 40, size: 8, font: this.fonts.bold, color: this.colors.navy });
      page.drawLine({ start: { x: MARGIN.left, y: A4.height - 46 }, end: { x: A4.width - MARGIN.right, y: A4.height - 46 }, thickness: 0.5, color: this.colors.rule });
      page.drawLine({ start: { x: MARGIN.left, y: 52 }, end: { x: A4.width - MARGIN.right, y: 52 }, thickness: 0.5, color: this.colors.rule });
      page.drawText(this.clean(this.labels.footer), { x: MARGIN.left, y: 38, size: 8, font: this.fonts.regular, color: this.colors.grey });
      const num = `Page ${i + 1} of ${pages.length}`;
      const w = this.fonts.regular.widthOfTextAtSize(num, 8);
      page.drawText(num, { x: A4.width - MARGIN.right - w, y: 26, size: 8, font: this.fonts.regular, color: this.colors.grey });
    });
  }
}
