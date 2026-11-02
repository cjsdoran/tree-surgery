// T-EML-1..5, T-EML-8 for the Stage 2 first review (TS-6, spec §9.1, D17).
import { describe, expect, it } from 'vitest';
import { checkTreeReview, countWords } from '../../shared/emailCheck.js';
import { checkSchema } from '../../shared/schemaCheck.js';
import { fillTreeReview } from '../../netlify/lib/stages.mjs';
import { config } from '../../shared/limits.js';
import { firstCutReply, passReply, reworkReply } from '../helpers/stage2.js';

const errorsOf = (r) => checkTreeReview(r).errors;

describe('checkTreeReview', () => {
  it('passes the fixtures and their schema', () => {
    for (const r of [reworkReply(), firstCutReply(), passReply()]) {
      expect(checkSchema('tree-review', r).ok).toBe(true);
      expect(checkTreeReview(r)).toEqual({ ok: true, errors: [] });
    }
  });

  it("T-EML-1: the opener must be the verdict's own", () => {
    const r = reworkReply();
    r.email.opener = config.openers.firstCut;
    expect(errorsOf(r)[0]).toBe(`The opener must be exactly: "${config.openers.rework}"`);
  });

  it('T-EML-2: Rework with 2 questions, or 6, fails', () => {
    const two = reworkReply();
    two.email.questions = two.email.questions.slice(0, 2);
    expect(errorsOf(two)[0]).toMatch(/needs 3–5 numbered questions; it has 2/);
    const six = reworkReply();
    six.email.questions = [...six.email.questions, ...six.email.questions.slice(0, 2)];
    expect(errorsOf(six).some((e) => /it has 6/.test(e))).toBe(true);
  });

  it('T-EML-3: one question each; a quoted node label ending in "?" is fine', () => {
    const two = reworkReply();
    two.email.questions[1] = { question: 'Which branch moves? And which one stays?', followUp: null };
    expect(errorsOf(two)).toContain('Question 2 must be one question, ending with its only question mark.');
    const noMark = reworkReply();
    noMark.email.questions[0] = { question: 'Tell me what the first split is.', followUp: null };
    expect(errorsOf(noMark)).toContain('Question 1 must be one question, ending with its only question mark.');
    const follow = reworkReply();
    follow.email.questions[0].followUp = 'Why? And how?';
    expect(errorsOf(follow)).toContain("Question 1's follow-up must ask at most one question.");
    const quoted = reworkReply();
    quoted.email.questions[0] = { question: 'What does “Exit?” cover that "Acquire?" does not?', followUp: 'What does that tell you about the first split?' };
    expect(checkTreeReview(quoted).errors).toEqual([]);
  });

  it('T-EML-4: a Pass has no questions and at most two pointers; questions have no pointers', () => {
    const q = passReply();
    q.email.questions = [{ question: 'Why?', followUp: null }];
    expect(errorsOf(q)).toContain('A Pass has no numbered questions: questions must be [].');
    const three = passReply();
    three.email.pointers.push('A third pointer for the workplan.');
    expect(errorsOf(three)).toContain('A Pass has at most 2 pointers; it has 3.');
    const pointers = reworkReply();
    pointers.email.pointers = ['x'];
    expect(errorsOf(pointers)).toContain('First cut or Rework has no pointers: pointers must be [].');
  });

  it('T-EML-5: 120–250 words for questions, 40–200 for a Pass (D17)', () => {
    const sized = (n) => {
      const r = reworkReply();
      r.email.whatWorks = 'Good.';
      r.email.ps = null;
      const fixed = countWords([r.email.opener, r.email.whatWorks].join(' '));
      const each = Math.floor((n - fixed) / 3);
      const q = (k) => ({ question: `${Array(k - 1).fill('word').join(' ')} why?`, followUp: null });
      r.email.questions = [q(each), q(each), q(n - fixed - 2 * each)];
      return r;
    };
    expect(checkTreeReview(sized(119)).ok).toBe(false);
    expect(checkTreeReview(sized(120)).ok).toBe(true);
    expect(checkTreeReview(sized(250)).ok).toBe(true);
    expect(errorsOf(sized(251))[0]).toMatch(/120–250 words; it has 251/);
    const shortPass = passReply();
    shortPass.email.pointers = [];
    shortPass.email.whatWorks = 'Good.';
    expect(errorsOf(shortPass)[0]).toMatch(/40–200 words/);
  });

  it('T-EML-8: omitted pointers, ps and followUp are filled before the schema check', () => {
    const r = reworkReply();
    delete r.email.pointers;
    delete r.email.ps;
    delete r.email.questions[1].followUp;
    expect(checkSchema('tree-review', r).ok).toBe(false);
    expect(checkSchema('tree-review', fillTreeReview(r)).ok).toBe(true);
  });

  it('a whatWorks of two sentences, or a long P.S., fails', () => {
    const r = reworkReply();
    r.email.whatWorks = 'Good split. Clear labels.';
    r.email.ps = 'One. Two. Three.';
    expect(errorsOf(r)).toEqual(expect.arrayContaining(['whatWorks must be one sentence.', 'The P.S. must be one or two sentences.']));
  });
});
