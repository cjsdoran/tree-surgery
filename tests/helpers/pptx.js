// Builds small .pptx files for the tree tests (test plan §1): a slide is given as the XML inside
// its shape tree. Sizes are in points here and written as EMU.
import JSZip from 'jszip';

const EMU = 12700;
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xfrm = (x, y, w, h, extra = '') => `<a:xfrm${extra}><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm>`;

/** A text box. `text` may hold several paragraphs separated by "\n". */
export function box(id, text, x, y, w = 100, h = 30) {
  const paras = String(text).split('\n').map((p) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${esc(p)}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Box ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
}

/** A connector from (x1,y1) to (x2,y2), optionally attached to shapes by id. */
export function connector(id, x1, y1, x2, y2, { start, end, prst = 'bentConnector3' } = {}) {
  const flip = `${x2 < x1 ? ' flipH="1"' : ''}${y2 < y1 ? ' flipV="1"' : ''}`;
  const cx = `<p:cNvCxnSpPr>${start ? `<a:stCxn id="${start}" idx="3"/>` : ''}${end ? `<a:endCxn id="${end}" idx="1"/>` : ''}</p:cNvCxnSpPr>`;
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/>${cx}<p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), flip)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`;
}

/** A plain line shape (as in good.pptx), not a connector. */
export function line(id, x1, y1, x2, y2) {
  const flip = `${x2 < x1 ? ' flipH="1"' : ''}${y2 < y1 ? ' flipV="1"' : ''}`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), flip)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
}

/** A group: its children are drawn in child space chOff/chExt, placed at off/ext on the slide. */
export function group(id, { off, ext, chOff, chExt }, children) {
  const g = `<a:xfrm><a:off x="${off[0] * EMU}" y="${off[1] * EMU}"/><a:ext cx="${ext[0] * EMU}" cy="${ext[1] * EMU}"/><a:chOff x="${chOff[0] * EMU}" y="${chOff[1] * EMU}"/><a:chExt cx="${chExt[0] * EMU}" cy="${chExt[1] * EMU}"/></a:xfrm>`;
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${g}</p:grpSpPr>${children.join('')}</p:grpSp>`;
}

export function picture(id, rId, x, y, w, h) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/></p:blipFill><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

export function smartArtFrame(id, rId) {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Diagram"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${rId}" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

/**
 * SmartArt data part from a nested list: [['Root', [['Child', [...]], ...]]].
 */
export function smartArtData(tree) {
  const pts = ['<dgm:pt modelId="doc" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p/></dgm:t></dgm:pt>'];
  const cxns = [];
  let n = 0;
  const add = (parent, [text, children = []], ord) => {
    const id = `n${(n += 1)}`;
    pts.push(`<dgm:pt modelId="${id}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>${esc(text)}</a:t></a:r></a:p></dgm:t></dgm:pt>`);
    pts.push(`<dgm:pt modelId="${id}-pres" type="pres"><dgm:prSet/><dgm:spPr/></dgm:pt>`);
    cxns.push(`<dgm:cxn modelId="c${id}" srcId="${parent}" destId="${id}" srcOrd="${ord}" destOrd="0"/>`);
    cxns.push(`<dgm:cxn modelId="p${id}" type="presOf" srcId="${id}" destId="${id}-pres" srcOrd="0" destOrd="0"/>`);
    children.forEach((c, i) => add(id, c, i));
  };
  tree.forEach((t, i) => add('doc', t, i));
  return `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>${pts.join('')}</dgm:ptLst><dgm:cxnLst>${cxns.join('')}</dgm:cxnLst></dgm:dataModel>`;
}

/**
 * @param {{ shapes: string, rels?: Record<string, string>, files?: Record<string, Uint8Array|string> }[]} slides
 * @param {{ width?: number, height?: number }} [size] in points
 */
export async function makePptx(slides, { width = 960, height = 540 } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('');
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="${width * EMU}" cy="${height * EMU}"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  slides.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${s.shapes}</p:spTree></p:cSld></p:sld>`);
    const rels = Object.entries(s.rels ?? {}).map(([id, target]) => `<Relationship Id="${id}" Type="x" Target="${target}"/>`).join('');
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    for (const [path, data] of Object.entries(s.files ?? {})) zip.file(path, data);
  });
  return zip.generateAsync({ type: 'uint8array' });
}

/** A left-to-right tree: root, two level 1 nodes, two level 2 nodes under the first. */
export function simpleTree({ connected = true } = {}) {
  const c = (id, x1, y1, x2, y2, start, end) => connector(id, x1, y1, x2, y2, connected ? { start, end } : {});
  return [
    box(2, 'How can Acme double profit by 2027?', 20, 240, 120, 60),
    box(3, 'How can Acme grow revenue?', 200, 120, 120, 40),
    box(4, 'How can Acme cut costs?', 200, 380, 120, 40),
    box(5, 'New customers?', 380, 80, 100, 30),
    box(6, 'Existing customers?', 380, 160, 100, 30),
    c(10, 140, 270, 200, 140, 2, 3),
    c(11, 140, 270, 200, 400, 2, 4),
    c(12, 320, 140, 380, 95, 3, 5),
    c(13, 320, 140, 380, 175, 3, 6),
  ].join('');
}
