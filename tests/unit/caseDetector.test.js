// T-DET-1, T-DET-2: the case detector rules (IT-11).
import { describe, expect, it } from 'vitest';
import caseMarkers from '../../config/case-markers.json' with { type: 'json' };
import { collectStudentText, compileRules, detectCase, normaliseForDetection } from '../../shared/caseDetector.js';

// One sample per marker. A marker added to the config without a sample fails the first test.
const SAMPLES = {
  hbs_name: ['Published by Harvard Business School Publishing, Boston', 'HARVARD BUSINESS SCHOOL'],
  hbs_copyright: ['Copyright © 2019 President and Fellows of Harvard College. All rights reserved.'],
  hbs_number: ['9-514-001 REV: JUNE 3, 2019', 'Case 9–514–001', 'case 9‐719‐404'],
  hbsp_url: ['To order copies, go to hbsp.harvard.edu', 'or visit hbr.org/store'],
  ivey_name: ['Ivey Publishing, Ivey Business School', 'Ivey Management Services prohibits'],
  ivey_number: ['Product number 9B18M123'],
  case_centre: ['Distributed by The Case Centre', 'www.thecasecentre.org'],
  iimb: ['Indian Institute of Management Bangalore', 'IIM Bangalore', 'IMB 699', 'IMB699'],
  acrc: ['Asia Case Research Centre, The University of Hong Kong', 'Asia Case Research Center'],
  written_by: ['This case was written by Professor Lee', 'This case was prepared for class use'],
  class_discussion: ['The case was developed solely as a basis for class discussion.', 'intended as a basis for class discussion'],
  not_illustrate: ['It is not intended to serve as an endorsement, source of primary data, or illustration of effective or ineffective management.'],
  reproduction: ['No part of this publication may be reproduced, stored or transmitted without the permission of the publisher.'],
};

const BRIEFS = [
  `Client brief: AS Watson Group. The client wants to grow loyalty revenue by 15% in Hong Kong by 2027.
   Kick-off notes: the CFO stressed the business case must show payback within 18 months. See Exhibit 1 for store counts.`,
  `Our notes from the kick-off. Clarks wants to decide which Asian markets to enter. Data in Exhibit 1, Exhibit 2 and Exhibit 3.
   Next meeting on 12 November.`,
  `Project brief for On-us. Scope: the partner programme. The team will build a business case and test it in two pilots.`,
];

describe('T-DET-1: every marker matches its sample', () => {
  it('has a sample for every marker in the config', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(caseMarkers.markers.map((m) => m.id).sort());
  });

  for (const marker of caseMarkers.markers) {
    it.each(SAMPLES[marker.id] ?? [])(`${marker.id}: %s`, (sample) => {
      const result = detectCase(`Some opening text. ${sample} Some closing text.`);
      expect(result.blocked).toBe(true);
      expect(result.reasons).toContain(marker.id);
    });
  }

  it('matches across line breaks and page markers', () => {
    expect(detectCase('This case was\n[[p.2]]\nwritten   by J. Smith').blocked).toBe(true);
    expect(detectCase('President and\nFellows of Harvard\nCollege').blocked).toBe(true);
  });
});

describe('T-DET-2: structural rule', () => {
  it('fires with 3 distinct exhibits AND a teaching phrase', () => {
    const r = detectCase('Exhibit 1 sales. Exhibit 2 costs. Exhibit 3 staff. Discussion questions follow.');
    expect(r).toEqual({ blocked: true, reasons: ['structural'] });
  });

  it('does not fire with 3 exhibits but no teaching phrase', () => {
    expect(detectCase('Exhibit 1 sales. Exhibit 2 costs. Exhibit 3 staff.').blocked).toBe(false);
  });

  it('does not fire with a teaching phrase but only 2 exhibits, however often they repeat', () => {
    expect(detectCase('This case study uses Exhibit 1, Exhibit 2, Exhibit 1 and Exhibit 2 again.').blocked).toBe(false);
  });
});

describe('client briefs are not blocked (T-DET-4 synthetic)', () => {
  it.each(BRIEFS)('%#', (brief) => {
    expect(detectCase(brief)).toEqual({ blocked: false, reasons: [] });
  });

  it('ignores empty input', () => {
    expect(detectCase('').blocked).toBe(false);
    expect(detectCase(null).blocked).toBe(false);
  });
});

describe('Chris case titles', () => {
  it('blocks a configured title as a literal phrase and ignores empty strings', () => {
    const rules = compileRules({ ...caseMarkers, chrisCaseTitles: { titles: ['', 'Bells (A): Ringing the Changes?', ''] } });
    expect(detectCase('bells (a):  ringing the\nchanges? page 1', rules)).toEqual({ blocked: true, reasons: ['case_title_1'] });
    expect(detectCase('Church bells ring on Sunday', rules).blocked).toBe(false);
  });
});

describe('helpers', () => {
  it('normalise strips our markers and file headings', () => {
    expect(normaliseForDetection('=== File: a.pdf (p.1–2) ===\n[[p.1]]\nHello\n\n[[slide 2]] world')).toBe('Hello world');
  });

  it('collects every piece of student text a request carries', () => {
    const text = collectStudentText({
      context: { text: 'CTX', pageCount: 1 },
      keyQuestion: 'KQ',
      subQuestions: ['SQ1', 'SQ2', 3],
      tree: { kind: 'pptx', shapes: 'SHAPES', pageText: 'PAGE' },
      outline: 'OUT',
      firstOutline: 'FIRST',
      revisedOutline: 'REVISED',
      firstEmail: 'EMAIL',
      attempt: 1,
    });
    expect(text).toBe('CTX\nKQ\nSQ1\nSQ2\nSHAPES\nPAGE\nOUT\nFIRST\nREVISED\nEMAIL');
  });
});
