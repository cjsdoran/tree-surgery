// The record PDF (IT-10, spec §11): T-PDF-1 (contents, footer, file name), T-PDF-2 (no prompt
// text, findings, context or slide text), T-PDF-3 (records for a paused, a passed and a signed-off
// run), T-PDF-4 (A4, images inside the margins), T-KQ-8 (every attempt by round).
import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import * as pdfLib from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { buildRecord, outcome, recordFileName } from '../../src/record/buildRecord.js';
import { A4 } from '../../src/record/layout.js';
import { config } from '../../shared/limits.js';
import { loadNodePdfjs, words } from '../helpers/fixtures.js';
import { reworkReply, passReply } from '../helpers/stage2.js';
import { notOkReply } from '../helpers/stage1.js';
import { signedOff } from '../helpers/signoff.js';

const KQ = 'How can PEIP achieve positive operating cash flow within the next 12 months?';
const CONTEXT_SECRET = 'Kickoff secret: Bruce plans to sell the garden in March';
let jpeg;
beforeAll(async () => {
  const c = createCanvas(800, 450);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 800, 450);
  ctx.fillStyle = '#1f3a5f';
  ctx.fillRect(40, 200, 200, 60);
  jpeg = Buffer.from(await c.encode('jpeg', 85)).toString('base64');
});

const { findings: _f, ...NOT_OK } = notOkReply();
const reading = (labels) => ({ nodes: [{ level: 0, text: KQ }, ...labels.map((text) => ({ level: 1, text })), { level: 2, text: 'Retail store?' }], notes: ['Level 4 left out (12 boxes) to keep the reading short.'], rootAsWritten: KQ, rootDiffers: false });

function signedOffRun(extra = {}) {
  return {
    version: 1, mode: 'generic', caseId: null, attemptId: 'AB3CD7EF', step: 'record', locked: true,
    startedAt: '2026-11-03T01:00:00Z', endedAt: '2026-11-03T02:00:00Z', updatedAt: '2026-11-03T02:00:00Z',
    setup: { accessCode: 'class-code', name: 'Mei Ōta Chan', studentId: '20871234', course: 'MGMT 5760', client: 'PEIP' },
    context: { confirmedAt: '2026-11-03T01:02:00Z', items: [{ name: 'notes.pdf', kind: 'pdf', pageCount: 2, pages: [CONTEXT_SECRET, words(40)], approx: false, sizeBytes: 1 }], pasteDraft: '' },
    keyQuestion: {
      rounds: [{ startedAt: '2026-11-03T01:05:00Z', attempts: [
        { keyQuestion: 'How can PEIP avoid going bankrupt and stabilise cashflow?', subQuestions: ['How can PEIP grow jam sales?'], sentAt: '2026-11-03T01:05:00Z', receivedAt: '2026-11-03T01:05:20Z', verdict: 'not_ok', email: NOT_OK.email, promptVersion: 'stage1-key-question 1.1; persona 1.0', model: 'claude-opus-5-5' },
        { keyQuestion: KQ, subQuestions: [], sentAt: '2026-11-03T01:10:00Z', receivedAt: '2026-11-03T01:10:20Z', verdict: 'ok', email: null, promptVersion: 'stage1-key-question 1.1; persona 1.0', model: 'claude-opus-5-5' },
      ] }],
      agreed: { keyQuestion: KQ, subQuestions: [], at: '2026-11-03T01:10:20Z' },
      draft: { keyQuestion: KQ, subQuestions: [''] },
    },
    unreadable: [{ round: 'first', at: '2026-11-03T01:20:00Z', reason: 'blurred', fileName: 'scan.pdf', kind: 'pdf', pageCount: 1, page: 1 }],
    blockedUploads: [{ at: '2026-11-03T01:03:00Z', stage: 'context', code: 'TS-U06' }],
    trees: [
      {
        round: 'first', fileName: 'tree.pdf', kind: 'pdf', pageCount: 2, page: 2, sentAt: '2026-11-03T01:25:00Z', readAt: '2026-11-03T01:25:15Z',
        recordImage: { mediaType: 'image/jpeg', base64: jpeg, width: 800, height: 450 },
        reading: reading(['How to increase cash inflow?', 'How to decrease cash outflow?']), readPromptVersion: 'read-tree 1.1', readModel: 'claude-opus-5-5',
        review: { verdict: 'rework', email: reworkReply().email, receivedAt: '2026-11-03T01:25:45Z', promptVersion: 'stage2-tree-review 1.2; persona 1.0', model: 'claude-opus-5-5' },
      },
      {
        round: 'revision', fileName: 'revised.pptx', kind: 'pptx', pageCount: 1, page: 1, sentAt: '2026-11-03T01:50:00Z', readAt: '2026-11-03T01:50:12Z', recordImage: null,
        reading: reading(['How can PEIP grow cash from jam?', 'How can PEIP improve the non-jam businesses?']), readPromptVersion: 'read-tree 1.1', readModel: 'claude-opus-5-5',
        review: { verdict: 'signed_off', email: signedOff().email, receivedAt: '2026-11-03T01:50:30Z', promptVersion: 'sign-off 1.0; stage2 rules 1.2; persona 1.0', model: 'claude-opus-5-5' },
      },
    ],
    ...extra,
  };
}

async function pdfPages(bytes) {
  const pdfjs = await loadNodePdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    pages.push({
      text: content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' '),
      view: page.view,
      images: ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length,
    });
  }
  await doc.cleanup();
  return pages;
}
const flat = (pages) => pages.map((p) => p.text).join('\n').replace(/\s+/g, ' ');

describe('T-PDF-1: contents, footer and file name', () => {
  it('names the file <COURSE>_TreeSurgery_<Name>_<AttemptID>.pdf, stripped', () => {
    expect(recordFileName(signedOffRun())).toBe('MGMT5760_TreeSurgery_MeitaChan_AB3CD7EF.pdf');
  });

  it('holds the details, every attempt, both trees, both reviews and the appendix, on A4 with the footer', async () => {
    const r = await buildRecord(signedOffRun(), pdfLib);
    const pages = await pdfPages(r.bytes);
    const text = flat(pages);
    for (const p of pages) {
      expect(p.view[2]).toBeCloseTo(A4.width, 0);
      expect(p.view[3]).toBeCloseTo(A4.height, 0);
      expect(p.text).toContain('MGMT 5760 practice tool. Feedback is AI-generated; you remain responsible for your work.');
    }
    for (const s of [
      'Tree Surgery record', 'Student: Mei ?ta Chan (20871234)', 'Attempt ID: AB3CD7EF', 'Client or project: PEIP',
      'Outcome: Key question agreed (round 1, attempt 2) · First review: Rework · Sign-off: Signed off',
      'Context files: notes.pdf (2 pages)', 'Blocked uploads: 1:', 'TS-U06', 'Pages Daniel could not read: 1:', 'blurred',
      `App version: ${config.appVersion}`, 'read-tree 1.1', 'sign-off 1.0', 'Models: claude-opus-5-5',
      'Round 1, attempt 1', 'How can PEIP avoid going bankrupt and stabilise cashflow?', 'Sub-question 1: How can PEIP grow jam sales?',
      config.openers.keyQuestion, 'Round 1, attempt 2', 'That Key Question will work to structure the tree.',
      'Your issue tree', 'File: tree.pdf, page 2 of 2', config.openers.rework, reworkReply().email.questions[0].question.slice(0, 40),
      'Your revised tree', "PowerPoint slide: see Daniel's reading of this tree in the appendix.", config.openers.signedOff,
      'What improved', 'Lesson for next time:', "Appendix: Daniel's reading of each tree",
      `KEY QUESTION (level 0): ${KQ}`, '[Level 4 left out (12 boxes) to keep the reading short.]', '1. How can PEIP grow cash from jam?', '2.1 Retail store?',
      'Daniel Hart | Engagement Manager | Halden & Rowe',
    ]) expect(text, s).toContain(s);
    expect(r.replacedCharacters).toBe(1);
  });

  it('T-PDF-4: draws the PDF tree page as an image inside the margins', async () => {
    const r = await buildRecord(signedOffRun(), pdfLib);
    const pages = await pdfPages(r.bytes);
    expect(pages.reduce((n, p) => n + p.images, 0)).toBe(1);
    const doc = await pdfLib.PDFDocument.load(r.bytes);
    expect(doc.getPages().every((p) => p.getWidth() === A4.width)).toBe(true);
  });
});

describe('T-PDF-2: what the record never holds', () => {
  it('no prompt text, no findings, no context text', async () => {
    const promptLines = readdirSync('prompts')
      .flatMap((f) => readFileSync(`prompts/${f}`, 'utf8').split('\n'))
      .map((l) => l.replace(/^[-#*\d.\s>|]+/, '').replace(/\*\*/g, '').trim())
      .filter((l) => l.length >= 40 && !l.startsWith('<!--') && !/^[{"[]/.test(l) && !Object.values(config.openers).some((o) => l.includes(o)))
      .map((l) => l.slice(0, 45));
    const text = flat(await pdfPages((await buildRecord(signedOffRun(), pdfLib)).bytes));
    for (const line of promptLines) expect(text.includes(line), line).toBe(false);
    for (const secret of [CONTEXT_SECRET, 'FINDING-MARKER', 'STAGE2-FINDING', 'class-code']) expect(text).not.toContain(secret);
  });
});

describe('T-PDF-3, T-KQ-8: other kinds of run', () => {
  it('a run paused at Stage 1: the attempts and emails, and no tree', async () => {
    const run = signedOffRun();
    run.keyQuestion = {
      rounds: [{ startedAt: 'x', attempts: [run.keyQuestion.rounds[0].attempts[0], run.keyQuestion.rounds[0].attempts[0], run.keyQuestion.rounds[0].attempts[0]] },
        { startedAt: 'y', attempts: [run.keyQuestion.rounds[0].attempts[0]] }],
      agreed: null, draft: run.keyQuestion.draft,
    };
    run.trees = [];
    run.locked = false;
    run.endedAt = null;
    const text = flat(await pdfPages((await buildRecord(run, pdfLib)).bytes));
    expect(outcome(run)).toBe('Key question not yet agreed (4 attempts)');
    expect(text).toContain('Round 2, attempt 1');
    expect(text).toContain('The key question was not agreed in this run.');
    expect(text).toContain('Finished: Not finished');
    expect(text).not.toContain('Your issue tree');
    expect(text).not.toContain('Appendix');
  });

  it('a Pass: one tree, its review, no revision', async () => {
    const run = signedOffRun();
    run.trees = [{ ...run.trees[0], review: { ...run.trees[0].review, verdict: 'pass', email: passReply().email } }];
    const text = flat(await pdfPages((await buildRecord(run, pdfLib)).bytes));
    expect(outcome(run)).toBe('Key question agreed (round 1, attempt 2) · First review: Pass');
    expect(text).toContain(config.openers.pass);
    expect(text).not.toContain('Your revised tree');
  });
});
