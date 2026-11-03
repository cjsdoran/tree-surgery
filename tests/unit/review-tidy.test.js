// Tidying a Stage 2 email before the checks (fillTreeReview), from the first real timing run on
// 3 Nov 2026: follow-ups written into the question, single-quoted node labels, a doubled "P.S.".
import { describe, expect, it } from 'vitest';
import { checkTreeReview, splitFollowUp, unquoted } from '../../shared/emailCheck.js';
import { fillTreeReview } from '../../netlify/lib/stages.mjs';
import { reworkReply } from '../helpers/stage2.js';

describe('unquoted', () => {
  it('blanks double, curly and single-quoted spans but keeps apostrophes', () => {
    expect(unquoted("under 'improve cash cycle', whose price?")).toBe(`under ${' '.repeat(20)}, whose price?`);
    expect(unquoted("PEIP's café? Bruce's time?")).toBe("PEIP's café? Bruce's time?");
    expect(unquoted('What does "Exit?" mean?').indexOf('?')).toBe(22);
  });
});

describe('splitFollowUp', () => {
  it('splits a question and its follow-up written as one', () => {
    expect(splitFollowUp({
      question: 'Could your level 1 split, cash inflow vs cash outflow, be moved onto any other company unchanged? Where do the café and the jam business each sit in it?',
      followUp: null,
    })).toEqual({
      question: 'Could your level 1 split, cash inflow vs cash outflow, be moved onto any other company unchanged?',
      followUp: 'Where do the café and the jam business each sit in it?',
    });
  });

  it('ignores quoted labels when it counts', () => {
    const q = { question: "Hiring staff and fixing the books sit under 'increase cash control?'; which of your other branches do those actions move? What would that branch need to cover?", followUp: null };
    expect(splitFollowUp(q)).toEqual({
      question: "Hiring staff and fixing the books sit under 'increase cash control?'; which of your other branches do those actions move?",
      followUp: 'What would that branch need to cover?',
    });
  });

  it('leaves one question, three questions, or a question that already has a follow-up alone', () => {
    const one = { question: 'Why?', followUp: null };
    const three = { question: 'A? B? C?', followUp: null };
    const has = { question: 'A? B?', followUp: 'C?' };
    expect(splitFollowUp(one)).toBe(one);
    expect(splitFollowUp(three)).toBe(three);
    expect(splitFollowUp(has)).toBe(has);
  });
});

describe('fillTreeReview', () => {
  it('turns the real replies that failed into ones that pass', () => {
    const r = reworkReply();
    r.email.questions = r.email.questions.map((q) => ({ question: q.followUp ? `${q.question} ${q.followUp}` : q.question, followUp: null }));
    r.email.questions[1].question = "If one analyst renegotiates a distributor's payment terms under 'improve cash cycle', whose price and volume are they also negotiating in branch 1?";
    expect(checkTreeReview(r).ok).toBe(false);
    const tidy = fillTreeReview(r);
    expect(checkTreeReview(tidy)).toEqual({ ok: true, errors: [] });
    expect(tidy.email.questions[0].followUp).toBe('What does that tell you about the first split?');
  });

  it('drops a P.S. the model wrote itself', () => {
    const r = reworkReply();
    r.email.ps = "P.S. Nodes 1 and 2 say 'PEP'; the client is PEIP.";
    expect(fillTreeReview(r).email.ps).toBe("Nodes 1 and 2 say 'PEP'; the client is PEIP.");
    r.email.ps = 'PS: ';
    expect(fillTreeReview(r).email.ps).toBeNull();
  });
});
