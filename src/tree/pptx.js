// Reads a tree slide from a .pptx (spec §6.4, D9): each text box with its position and size,
// each line or connector with its end points and any connections, SmartArt as the hierarchy its
// data part holds, tables as rows. A slide that is only a picture gives the picture instead.
// Positions are in points from the slide's top left (EMU ÷ 12,700), groups flattened.
import { limits } from '../../shared/limits.js';
import { all, kid, kids, local, parseXml, path } from './xml.js';

const EMU_PER_PT = 12700;
const pt = (emu) => Math.round(Number(emu) / EMU_PER_PT);
const loadJSZip = async () => (await import('jszip')).default;

const LINE_PRESETS = /^(line|straightConnector\d*|bentConnector\d+|curvedConnector\d+)$/;
const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export async function openPptx(data) {
  return (await loadJSZip()).loadAsync(data);
}

// Resolves a relationship target against the part that owns it.
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function readRels(zip, partPath) {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const file = zip.file(`${dir}/_rels/${partPath.split('/').pop()}.rels`);
  if (!file) return {};
  const rels = parseXml(await file.async('string'));
  return Object.fromEntries(kids(rels, 'Relationship').map((r) => [r.attrs.Id, resolve(partPath, r.attrs.Target)]));
}

/**
 * The slides in presentation order, with the slide size in points.
 * @returns {Promise<{ width: number, height: number, slides: { n: number, path: string }[] }>}
 */
export async function listSlides(zip) {
  const pres = parseXml(await zip.file('ppt/presentation.xml').async('string'));
  const size = kid(pres, 'p:sldSz');
  const rels = await readRels(zip, 'ppt/presentation.xml');
  let paths = kids(kid(pres, 'p:sldIdLst'), 'p:sldId').map((s) => rels[s.attrs['r:id']]).filter((p) => p && zip.file(p));
  if (!paths.length) {
    paths = Object.keys(zip.files)
      .map((name) => ({ name, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
      .filter((s) => Number.isFinite(s.n))
      .sort((a, b) => a.n - b.n)
      .map((s) => s.name);
  }
  return {
    width: size ? pt(size.attrs.cx) : 960,
    height: size ? pt(size.attrs.cy) : 540,
    slides: paths.map((p, i) => ({ n: i + 1, path: p })),
  };
}

// Text of a text body: paragraphs joined with " / ", runs and fields joined within a paragraph.
function bodyText(txBody) {
  if (!txBody) return '';
  return kids(txBody, 'a:p')
    .map((p) => p.children.map((r) => {
      if (r.name === 'a:br') return ' ';
      if (r.name === 'a:r' || r.name === 'a:fld') return kid(r, 'a:t')?.text ?? '';
      return '';
    }).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ');
}

const IDENTITY = { ox: 0, oy: 0, sx: 1, sy: 1 };
// Maps a point in a group's child space to slide space.
const apply = (t, x, y) => ({ x: t.ox + x * t.sx, y: t.oy + y * t.sy });

function groupTransform(parent, grpSpPr) {
  const xfrm = kid(grpSpPr, 'a:xfrm');
  if (!xfrm) return parent;
  const off = kid(xfrm, 'a:off')?.attrs; const ext = kid(xfrm, 'a:ext')?.attrs;
  const chOff = kid(xfrm, 'a:chOff')?.attrs; const chExt = kid(xfrm, 'a:chExt')?.attrs;
  if (!off || !ext || !chOff || !chExt) return parent;
  const sx = Number(chExt.cx) ? Number(ext.cx) / Number(chExt.cx) : 1;
  const sy = Number(chExt.cy) ? Number(ext.cy) / Number(chExt.cy) : 1;
  // child → group frame: off + (c - chOff) * s; then the parent transform.
  const inner = { ox: Number(off.x) - Number(chOff.x) * sx, oy: Number(off.y) - Number(chOff.y) * sy, sx, sy };
  return { ox: parent.ox + inner.ox * parent.sx, oy: parent.oy + inner.oy * parent.sy, sx: parent.sx * inner.sx, sy: parent.sy * inner.sy };
}

// A shape's frame in slide EMU, or null when it inherits its position (eg a placeholder).
function frame(xfrm, t) {
  const off = kid(xfrm, 'a:off')?.attrs; const ext = kid(xfrm, 'a:ext')?.attrs;
  if (!off || !ext) return null;
  const a = apply(t, Number(off.x), Number(off.y));
  const b = apply(t, Number(off.x) + Number(ext.cx), Number(off.y) + Number(ext.cy));
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, flipH: xfrm.attrs.flipH === '1', flipV: xfrm.attrs.flipV === '1', rot: Number(xfrm.attrs.rot ?? 0) / 60000 };
}

/**
 * Walks a slide's shape tree.
 * @returns {Promise<{ shapes: object[], lines: object[], smartArt: string[], tables: string[][], pictures: object[] }>}
 */
export async function readSlide(zip, slidePath) {
  const slide = parseXml(await zip.file(slidePath).async('string'));
  const rels = await readRels(zip, slidePath);
  const out = { shapes: [], lines: [], smartArt: [], tables: [], pictures: [] };
  const tree = path(slide, 'p:cSld', 'p:spTree');

  async function walk(node, t) {
    for (const el of node.children) {
      const type = local(el.name);
      if (type === 'grpSp') await walk(el, groupTransform(t, kid(el, 'p:grpSpPr')));
      else if (type === 'sp' || type === 'cxnSp') readShape(el, t, type);
      else if (type === 'graphicFrame') await readFrame(el, t);
      else if (type === 'pic') readPicture(el, t);
    }
  }

  function readShape(el, t, type) {
    const nv = kid(el, type === 'sp' ? 'p:nvSpPr' : 'p:nvCxnSpPr');
    const id = kid(nv, 'p:cNvPr')?.attrs.id ?? '?';
    const spPr = kid(el, 'p:spPr');
    const f = frame(kid(spPr, 'a:xfrm'), t);
    const prst = kid(spPr, 'a:prstGeom')?.attrs.prst ?? '';
    const text = bodyText(kid(el, 'p:txBody'));
    if (type === 'cxnSp' || LINE_PRESETS.test(prst)) {
      if (!f) return;
      const [x1, x2] = f.flipH ? [f.x + f.w, f.x] : [f.x, f.x + f.w];
      const [y1, y2] = f.flipV ? [f.y + f.h, f.y] : [f.y, f.y + f.h];
      const cx = kid(nv, 'p:cNvCxnSpPr');
      out.lines.push({ id, x1: pt(x1), y1: pt(y1), x2: pt(x2), y2: pt(y2), shape: prst || 'connector', start: kid(cx, 'a:stCxn')?.attrs.id ?? null, end: kid(cx, 'a:endCxn')?.attrs.id ?? null });
      return;
    }
    if (!text) return;
    out.shapes.push(f
      ? { id, text, x: pt(f.x), y: pt(f.y), w: pt(f.w), h: pt(f.h), rot: Math.round(f.rot) || 0 }
      : { id, text, x: null, y: null, w: null, h: null, rot: 0 });
  }

  async function readFrame(el, t) {
    const data = path(el, 'a:graphic', 'a:graphicData');
    const table = kid(data, 'a:tbl');
    if (table) {
      out.tables.push(kids(table, 'a:tr').map((tr) => kids(tr, 'a:tc').map((tc) => bodyText(kid(tc, 'a:txBody'))).join(' | ')));
      return;
    }
    const ids = all(data, 'dgm:relIds')[0];
    const target = ids && rels[ids.attrs['r:dm']];
    if (target && zip.file(target)) out.smartArt.push(...readDiagram(parseXml(await zip.file(target).async('string'))));
  }

  function readPicture(el, t) {
    const embed = all(el, 'a:blip')[0]?.attrs['r:embed'];
    const target = embed && rels[embed];
    const f = frame(path(el, 'p:spPr', 'a:xfrm'), t);
    if (!target || !f) return;
    const ext = target.split('.').pop().toLowerCase();
    out.pictures.push({ target, mediaType: PICTURE_TYPES[ext] ?? null, ext, x: pt(f.x), y: pt(f.y), w: pt(f.w), h: pt(f.h) });
  }

  if (tree) await walk(tree, IDENTITY);
  return out;
}

/**
 * SmartArt: the data part's points and their parent-of connections give the hierarchy. Returns
 * indented lines ("- text", two spaces a level), in the diagram's own order.
 */
export function readDiagram(data) {
  const points = new Map();
  for (const p of all(data, 'dgm:pt')) {
    const type = p.attrs.type ?? 'node';
    if (type === 'node' || type === 'doc') points.set(p.attrs.modelId, { type, text: bodyText(kid(p, 'dgm:t')) });
  }
  const children = new Map();
  for (const c of all(data, 'dgm:cxn')) {
    if ((c.attrs.type ?? 'parOf') !== 'parOf' || !points.has(c.attrs.destId)) continue;
    const list = children.get(c.attrs.srcId) ?? [];
    list.push({ id: c.attrs.destId, ord: Number(c.attrs.srcOrd ?? 0) });
    children.set(c.attrs.srcId, list);
  }
  const lines = [];
  const visit = (id, depth, seen) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const child of (children.get(id) ?? []).sort((a, b) => a.ord - b.ord)) {
      const text = points.get(child.id)?.text;
      if (text) lines.push(`${'  '.repeat(depth)}- ${text}`);
      visit(child.id, text ? depth + 1 : depth, seen);
    }
  };
  for (const [id, p] of points) if (p.type === 'doc') visit(id, 0, new Set());
  return lines;
}

/** The first text on a slide, for the slide picker. */
export function firstText(read, max = 80) {
  const text = [...read.shapes].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))[0]?.text
    ?? read.smartArt[0]?.replace(/^\s*- /, '')
    ?? read.tables[0]?.[0]
    ?? '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * What a slide gives the read call (spec §6.2 step 6, §6.4): shapes text, a picture, or nothing.
 * @returns {{ kind: 'shapes', text: string } | { kind: 'picture', picture: object } | { kind: 'none', reason: string }}
 */
export function slideContent(read, { n, width, height }) {
  if (read.shapes.length >= limits.treeMinShapes || read.smartArt.length) {
    return { kind: 'shapes', text: shapesText(read, { n, width, height }) };
  }
  const big = read.pictures.filter((p) => p.w * p.h >= 0.4 * width * height);
  if (read.shapes.length <= 2 && big.length === 1) {
    return big[0].mediaType ? { kind: 'picture', picture: big[0] } : { kind: 'none', reason: 'unsupported_picture' };
  }
  return { kind: 'none', reason: 'no_tree' };
}

const q = (s) => `"${s.replace(/"/g, "'")}"`;

/** The <slide_shapes> block (spec §6.4). */
export function shapesText(read, { n, width, height }) {
  const out = [`Slide ${n}, ${width} × ${height} pt`];
  for (const s of read.shapes) {
    out.push(s.x === null
      ? `S${s.id} ${q(s.text)} position from the layout`
      : `S${s.id} ${q(s.text)} x=${s.x} y=${s.y} w=${s.w} h=${s.h}${s.rot ? ` rot=${s.rot}` : ''}`);
  }
  for (const l of read.lines) {
    const ends = l.start || l.end ? ` start=${l.start ? `S${l.start}` : 'none'} end=${l.end ? `S${l.end}` : 'none'}` : ' (no connection)';
    out.push(`L${l.id} ${l.shape} from (${l.x1},${l.y1}) to (${l.x2},${l.y2})${ends}`);
  }
  if (read.smartArt.length) out.push('[from a SmartArt diagram]', ...read.smartArt);
  for (const rows of read.tables) out.push('[table]', ...rows.map((r) => `row: ${r}`));
  return out.join('\n');
}

/** Reads a picture-only slide's image as base64. */
export async function pictureBase64(zip, picture) {
  return zip.file(picture.target).async('base64');
}
