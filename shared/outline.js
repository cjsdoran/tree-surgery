// Daniel's reading of a tree (spec §10.3): nodes with levels, rendered in the calibration
// outlines' format, which the review and sign-off prompts receive and the record prints. Also
// the read test's comparator (RT-1): parse a reference outline and check that every level 1 and
// level 2 node sits under the right parent.

/**
 * The read call's `outline`: one node per line, "<level> <text>" (prompts/read-tree.md).
 * @returns {{ nodes: { level: number, text: string }[], errors: string[] }}
 */
export function nodesFromLines(text) {
  const nodes = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const m = /^\s*(\d{1,2})\s+(\S.*)$/.exec(line);
    if (!m) errors.push(`Outline line ${i + 1} must be a level number, a space, then the text.`);
    else nodes.push({ level: Number(m[1]), text: m[2].trim() });
  });
  return { nodes, errors };
}

/**
 * Levels must start at 0 and never jump more than one deeper than the node before.
 * @returns {string[]} errors, empty if the nodes are a valid outline
 */
export function checkNodes(nodes) {
  const errors = [];
  if (!nodes.length) return ['nodes must not be empty when status is "read".'];
  if (nodes[0].level !== 0) errors.push('The first node must be the root, at level 0.');
  nodes.forEach((n, i) => {
    if (i > 0 && n.level === 0) errors.push(`Node ${i + 1} is at level 0: only the first node is the root.`);
    if (i > 0 && n.level > nodes[i - 1].level + 1) {
      errors.push(`Node ${i + 1} ("${n.text.slice(0, 40)}") is at level ${n.level}, more than one level below the node before it.`);
    }
  });
  return errors;
}

/**
 * The calibration format: "KEY QUESTION (level 0): …", then "1." and "1.1" for levels 1 and 2,
 * then "- " bullets, indented four spaces a level.
 * @param {{ level: number, text: string }[]} nodes
 * @param {string[]} [notes] transcription notes, printed in square brackets after the root
 */
export function renderOutline(nodes, notes = []) {
  const lines = [];
  const count = [0, 0];
  nodes.forEach((n, i) => {
    if (i === 0) {
      lines.push(`KEY QUESTION (level 0): ${n.text}`);
      for (const note of notes) lines.push(`[${note.replace(/^\[|\]$/g, '')}]`);
      lines.push('');
    } else if (n.level === 1) {
      count[0] += 1;
      count[1] = 0;
      lines.push(`${count[0]}. ${n.text}`);
    } else if (n.level === 2) {
      count[1] += 1;
      lines.push(`   ${count[0]}.${count[1]} ${n.text}`);
    } else {
      lines.push(`${' '.repeat(7 + 4 * (n.level - 3))}- ${n.text}`);
    }
  });
  return lines.join('\n').trimEnd();
}

/**
 * Parses a calibration outline (calibration/outlines/*.md) back into nodes. The level comes from
 * the indent: 0 spaces is level 1, 3 is level 2, 7 is level 3, then four more a level. Lines in
 * square brackets are notes.
 */
export function parseOutline(text) {
  const nodes = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || /^\s*\[.*\]\s*$/.test(raw)) continue;
    const root = /^KEY QUESTION \(level 0\):\s*(.*)$/.exec(raw.trim());
    if (root) {
      nodes.push({ level: 0, text: root[1].trim() });
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const level = indent < 3 ? 1 : indent < 7 ? 2 : 3 + Math.floor((indent - 7) / 4);
    const body = raw.trim().replace(/^(\d+(\.\d+)*\.?|-)\s+/, '');
    nodes.push({ level, text: body });
  }
  return nodes;
}

/** Lower case, letters and digits only, single spaces: "Café/Restaurant?" → "café restaurant". */
export function normaliseNode(text) {
  return String(text).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Similarity of two normalised strings: 1 − edit distance / longer length.
export function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Each node with its parent's index.
function withParents(nodes) {
  const stack = [];
  return nodes.map((n, i) => {
    while (stack.length && nodes[stack.at(-1)].level >= n.level) stack.pop();
    const parent = stack.length ? stack.at(-1) : null;
    stack.push(i);
    return { ...n, index: i, parent, key: normaliseNode(n.text) };
  });
}

/**
 * RT-1: every level 1 and level 2 node of the reference must appear in the reading at the same
 * level and under a parent that matches the reference parent. Texts match at `threshold` (Q9).
 * @returns {{ ok: boolean, checked: number, misses: { level: number, text: string, problem: string, found?: string }[] }}
 */
export function compareOutlines(reference, reading, { threshold = 0.85 } = {}) {
  const ref = withParents(reference);
  const got = withParents(reading);
  const best = (key, pool) => pool
    .map((g) => ({ g, s: similarity(key, g.key) }))
    .sort((a, b) => b.s - a.s)[0];

  const misses = [];
  let checked = 0;
  for (const r of ref.filter((n) => n.level === 1 || n.level === 2)) {
    checked += 1;
    const sameLevel = best(r.key, got.filter((g) => g.level === r.level));
    if (!sameLevel || sameLevel.s < threshold) {
      const anywhere = best(r.key, got);
      misses.push(anywhere && anywhere.s >= threshold
        ? { level: r.level, text: r.text, problem: `read at level ${anywhere.g.level}`, found: anywhere.g.text }
        : { level: r.level, text: r.text, problem: 'not found' });
      continue;
    }
    if (r.level === 2) {
      const refParent = ref[r.parent];
      const gotParent = got[sameLevel.g.parent];
      if (!gotParent || similarity(refParent.key, gotParent.key) < threshold) {
        misses.push({ level: r.level, text: r.text, problem: 'under the wrong parent', found: gotParent?.text ?? '(none)' });
      }
    }
  }
  return { ok: misses.length === 0, checked, misses };
}
