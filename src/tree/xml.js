// A small XML reader for slide and diagram parts. It runs the same in the browser, the tests and
// the pilot harness (Node has no DOMParser). Slide XML is machine-written and well formed, so
// this handles elements, attributes, text, self-closing tags, comments, processing instructions
// and CDATA, and nothing more.
import { decodeXml } from '../extract/text.js';

/** @typedef {{ name: string, attrs: Record<string, string>, children: XmlNode[], text: string }} XmlNode */

const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** @returns {XmlNode} the root element */
export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(ATTR)) attrs[a[1]] = decodeXml(a[3] ?? a[4] ?? '');
      const node = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeXml(m[6]);
  }
  return root.children[0] ?? root;
}

/** The local name, without a namespace prefix: "a:off" → "off". */
export const local = (name) => name.slice(name.indexOf(':') + 1);

/** Direct children with this name (prefix included, eg "p:sp"). */
export function kids(node, name) {
  return node?.children.filter((c) => c.name === name) ?? [];
}

/** First direct child with this name. */
export function kid(node, name) {
  return node?.children.find((c) => c.name === name) ?? null;
}

/** Follows a path of child names: path(sp, 'p:spPr', 'a:xfrm'). */
export function path(node, ...names) {
  let n = node;
  for (const name of names) {
    n = kid(n, name);
    if (!n) return null;
  }
  return n;
}

/** Every descendant with this name, in document order. */
export function all(node, name, out = []) {
  for (const c of node?.children ?? []) {
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
}
