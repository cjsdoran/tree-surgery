// T-EML-1, T-EML-5, T-EML-6 for Stage 1 (TS-6, spec §9.1). Later stages add theirs.
import { describe, expect, it } from 'vitest';
import { checkKeyQuestion, countWords, normalise, sentenceCount } from '../../shared/emailCheck.js';
import { checkSchema } from '../../shared/schemaCheck.js';
import { fillKeyQuestion } from '../../netlify/lib/stages.mjs';
import { config } from '../../shared/limits.js';
import { notOkReply, okReply } from '../helpers/stage1.js';

const words = (n) => Array(n).fill('word').join(' ');
const OPENER_WORDS = countWords(config.openers.keyQuestion);

// A Not OK reply whose email has exactly n words.
function withWords(n) {
  const r = notOkReply();
  r.email.whatWorks = '';
  r.email.points = [words(n - OPENER_WORDS)];
  return r;
}

describe('helpers', () => {
  it('normalises curly quotes, dashes and spaces', () => {
    expect(normalise('Don’t “go” –  now ')).toBe('Don\'t "go" - now');
  });

  it('counts sentences, ignoring abbreviations', () => {
    expect(sentenceCount('')).toBe(0);
    expect(sentenceCount('One line, e.g. this one.')).toBe(1);
    expect(sentenceCount('One. Two.')).toBe(2);
  });
});

describe('Stage 1 schema', () => {
  it('accepts the fixtures', () => {
    expect(checkSchema('key-question', notOkReply()).ok).toBe(true);
    expect(checkSchema('key-question', okReply()).ok).toBe(true);
  });

  it('rejects four findings, an unknown test and a missing email', () => {
    expect(checkSchema('key-question', { ...okReply(), findings: okReply().findings.slice(1) }).ok).toBe(false);
    const bad = okReply();
    bad.findings[0].test = 'measurable';
    expect(checkSchema('key-question', bad).ok).toBe(false);
    const { email: _e, ...noEmail } = okReply();
    expect(checkSchema('key-question', noEmail).ok).toBe(false);
  });

  it('T-EML-8: an email that leaves out an empty whatWorks or points is filled in first', () => {
    const r = notOkReply();
    delete r.email.whatWorks;
    expect(checkSchema('key-question', r).ok).toBe(false);
    expect(checkSchema('key-question', fillKeyQuestion(r)).ok).toBe(true);
  });
});

describe('checkKeyQuestion', () => {
  it('passes the fixtures', () => {
    expect(checkKeyQuestion(notOkReply())).toEqual({ ok: true, errors: [] });
    expect(checkKeyQuestion(okReply())).toEqual({ ok: true, errors: [] });
  });

  it('T-EML-1: the opener must match its words exactly; curly quotes and dashes are fine', () => {
    const off = notOkReply();
    off.email.opener = config.openers.keyQuestion.replace('rethinking', 'rework');
    expect(checkKeyQuestion(off).errors[0]).toMatch(/^The opener must be exactly/);
    const curly = notOkReply();
    curly.email.opener = config.openers.keyQuestion.replace("'", '’');
    expect(checkKeyQuestion(curly).ok).toBe(true);
  });

  it('T-EML-5: 60–170 words', () => {
    expect(checkKeyQuestion(withWords(59)).ok).toBe(false);
    expect(checkKeyQuestion(withWords(60)).ok).toBe(true);
    expect(checkKeyQuestion(withWords(170)).ok).toBe(true);
    const over = checkKeyQuestion(withWords(171));
    expect(over.ok).toBe(false);
    expect(over.errors[0]).toMatch(/has 171/);
  });

  it('T-EML-6: OK with an email, Not OK without one, and a verdict that contradicts the tests', () => {
    expect(checkKeyQuestion(okReply({ email: notOkReply().email })).ok).toBe(false);
    expect(checkKeyQuestion(notOkReply({ email: null })).ok).toBe(false);
    expect(checkKeyQuestion(okReply({ findings: notOkReply().findings })).ok).toBe(false);
    expect(checkKeyQuestion(notOkReply({ findings: okReply().findings })).ok).toBe(false);
  });

  it('wants the five tests in order, 1–5 points and a one-sentence whatWorks', () => {
    const order = okReply();
    order.findings.reverse();
    expect(checkKeyQuestion(order).ok).toBe(false);
    const none = notOkReply();
    none.email.points = [];
    expect(checkKeyQuestion(none).ok).toBe(false);
    const two = notOkReply();
    two.email.whatWorks = 'Good client. Good focus.';
    expect(checkKeyQuestion(two).errors).toContain('whatWorks must be one sentence, or empty.');
  });

  it('errors describe the form only, never the findings', () => {
    const r = notOkReply({ verdict: 'ok' });
    for (const e of checkKeyQuestion(r).errors) expect(e).not.toMatch(/FINDING-MARKER/);
  });
});
