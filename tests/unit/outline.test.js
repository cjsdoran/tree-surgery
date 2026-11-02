// Outlines (spec §10.3): T-READ-3 (level checks), T-READ-7 (rendering), T-PIL-2 (the read-test
// comparator), and the calibration outlines parse cleanly.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { checkNodes, compareOutlines, nodesFromLines, normaliseNode, parseOutline, renderOutline, similarity } from '../../shared/outline.js';

const NODES = [
  { level: 0, text: 'How can Acme double profit by 2027?' },
  { level: 1, text: 'How can Acme grow revenue?' },
  { level: 2, text: 'New customers?' },
  { level: 3, text: 'Which segments?' },
  { level: 4, text: 'Hotels?' },
  { level: 2, text: 'Existing customers?' },
  { level: 1, text: 'How can Acme cut costs?' },
  { level: 2, text: 'Fixed costs?' },
];

describe('nodesFromLines', () => {
  it('reads "<level> <text>" lines and names a bad one', () => {
    expect(nodesFromLines('0 Root?\n1  Child one?\n\n2 Grandchild')).toEqual({
      nodes: [{ level: 0, text: 'Root?' }, { level: 1, text: 'Child one?' }, { level: 2, text: 'Grandchild' }], errors: [],
    });
    expect(nodesFromLines('0 Root?\n- Child').errors).toEqual(['Outline line 2 must be a level number, a space, then the text.']);
  });
});

describe('T-READ-3: checkNodes', () => {
  it('accepts a valid outline', () => {
    expect(checkNodes(NODES)).toEqual([]);
  });

  it('rejects an empty outline, a first node not at level 0, a second root and a jump of two levels', () => {
    expect(checkNodes([])).toHaveLength(1);
    expect(checkNodes([{ level: 1, text: 'x' }])[0]).toMatch(/first node must be the root/);
    expect(checkNodes([{ level: 0, text: 'a' }, { level: 0, text: 'b' }])[0]).toMatch(/only the first node is the root/);
    expect(checkNodes([{ level: 0, text: 'a' }, { level: 2, text: 'b' }])[0]).toMatch(/more than one level below/);
  });
});

describe('T-READ-7: renderOutline', () => {
  it('uses the calibration format, with notes after the root', () => {
    expect(renderOutline(NODES, ['Transcription note: one word is illegible.'])).toBe([
      'KEY QUESTION (level 0): How can Acme double profit by 2027?',
      '[Transcription note: one word is illegible.]',
      '',
      '1. How can Acme grow revenue?',
      '   1.1 New customers?',
      '       - Which segments?',
      '           - Hotels?',
      '   1.2 Existing customers?',
      '2. How can Acme cut costs?',
      '   2.1 Fixed costs?',
    ].join('\n'));
  });

  it('parses back to the same nodes', () => {
    expect(parseOutline(renderOutline(NODES, ['note']))).toEqual(NODES);
  });
});

describe('calibration outlines', () => {
  const files = readdirSync('calibration/outlines').filter((f) => f.endsWith('.md'));
  it.each(files)('%s parses into a valid outline', (file) => {
    const nodes = parseOutline(readFileSync(`calibration/outlines/${file}`, 'utf8'));
    expect(nodes[0].level).toBe(0);
    expect(checkNodes(nodes)).toEqual([]);
    expect(nodes.filter((n) => n.level === 1).length).toBeGreaterThanOrEqual(2);
  });

  it('reads good.md level by level', () => {
    const nodes = parseOutline(readFileSync('calibration/outlines/good.md', 'utf8'));
    expect(nodes.slice(0, 5)).toEqual([
      { level: 0, text: 'How can PEIP achieve sustainable cashflow of $200k within 18 months?' },
      { level: 1, text: 'How can PEP achieve sustainable cashflow by changing businesses?' },
      { level: 2, text: 'Exit?' },
      { level: 2, text: 'Start-up?' },
      { level: 2, text: 'Acquire?' },
    ]);
    expect(nodes.find((n) => n.text === 'Current store?').level).toBe(5);
  });
});

describe('T-PIL-2: compareOutlines', () => {
  it('passes an exact reading, and one with small wording differences', () => {
    expect(compareOutlines(NODES, NODES)).toEqual({ ok: true, checked: 5, misses: [] });
    const near = NODES.map((n) => (n.text === 'How can Acme grow revenue?' ? { ...n, text: 'How can Acme grow revenues' } : n));
    expect(compareOutlines(NODES, near).ok).toBe(true);
  });

  it('reports a node under the wrong parent, a node at the wrong level, and a missing node', () => {
    const reading = [
      { level: 0, text: 'How can Acme double profit by 2027?' },
      { level: 1, text: 'How can Acme grow revenue?' },
      { level: 2, text: 'New customers?' },
      { level: 1, text: 'How can Acme cut costs?' },
      { level: 2, text: 'Existing customers?' },
      { level: 3, text: 'Fixed costs?' },
    ];
    expect(compareOutlines(NODES, reading).misses).toEqual([
      { level: 2, text: 'Existing customers?', problem: 'under the wrong parent', found: 'How can Acme cut costs?' },
      { level: 2, text: 'Fixed costs?', problem: 'read at level 3', found: 'Fixed costs?' },
    ]);
    const missing = compareOutlines(NODES, NODES.filter((n) => n.text !== 'How can Acme cut costs?' && n.text !== 'Fixed costs?'));
    expect(missing.misses).toEqual([
      { level: 1, text: 'How can Acme cut costs?', problem: 'not found' },
      { level: 2, text: 'Fixed costs?', problem: 'not found' },
    ]);
  });

  it('normalises and scores text', () => {
    expect(normaliseNode('Café/Restaurant?')).toBe('café restaurant');
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abcd', 'abce')).toBe(0.75);
  });
});
