// Email check (TS-6, spec §9.1): the rules a model's email must meet before it goes to the
// browser. Replaces Question Time's formatCheck. Limits live in config/app.json emailCheck.
// Error messages describe the email's form only, never the findings: they go back to the model
// as previousErrors and are safe to send to the browser.
import { config } from './limits.js';

const STAGE1_TESTS = ['smart', 'one_question', 'no_overlap', 'open', 'clear_words'];

export function countWords(text) {
  return (String(text ?? '').match(/\S+/g) ?? []).length;
}

/** Straightens curly quotes and dashes and collapses spaces, so an opener matches on its words. */
export function normalise(text) {
  return String(text ?? '')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sentence ends: . ! or ? followed by a space and a capital letter or an opening quote.
// Abbreviations such as "e.g. the" don't count, since a lower-case word follows.
export function sentenceCount(text) {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  return (t.match(/[.!?]["')”’]?\s+(?=["'“‘(]?[A-Z])/g) ?? []).length + 1;
}

function openerError(email, key) {
  return normalise(email.opener) === normalise(config.openers[key])
    ? null
    : `The opener must be exactly: "${config.openers[key]}"`;
}

const result = (errors) => ({ ok: errors.length === 0, errors });

/**
 * Stage 1 (spec §9.1). The data has passed schemas/key-question.schema.json.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkKeyQuestion(data) {
  const errors = [];
  const limits = config.emailCheck.keyQuestion;

  const tests = data.findings.map((f) => f.test);
  if (tests.join() !== STAGE1_TESTS.join()) {
    errors.push(`findings must have one entry per test, in this order: ${STAGE1_TESTS.join(', ')}.`);
  }
  const failed = data.findings.filter((f) => f.result === 'fail').length;
  if (data.verdict === 'ok' && failed > 0) errors.push('The verdict is OK but a test failed: a key question is OK only if it passes all five.');
  if (data.verdict === 'not_ok' && failed === 0) errors.push('The verdict is Not OK but every test passed.');

  if (data.verdict === 'ok') {
    if (data.email !== null) errors.push('If the verdict is OK, email must be null.');
    return result(errors);
  }
  const email = data.email;
  if (!email) return result([...errors, 'If the verdict is Not OK, email must be an object.']);

  const opener = openerError(email, 'keyQuestion');
  if (opener) errors.push(opener);
  if (email.points.length < limits.pointsMin || email.points.length > limits.pointsMax) {
    errors.push(`points must have ${limits.pointsMin}–${limits.pointsMax} bullets, one per failed test; it has ${email.points.length}.`);
  }
  if (sentenceCount(email.whatWorks) > 1) errors.push('whatWorks must be one sentence, or empty.');
  const words = countWords([email.opener, email.whatWorks, ...email.points].join(' '));
  if (words < limits.wordsMin || words > limits.wordsMax) {
    errors.push(`The email must be ${limits.wordsMin}–${limits.wordsMax} words (opener, whatWorks and points); it has ${words}. Aim for about 120.`);
  }
  return result(errors);
}

const REVIEW_OPENERS = { first_cut: 'firstCut', rework: 'rework', pass: 'pass' };
// Question marks outside quotes: Daniel quotes node labels, which are often questions themselves
// ('What does "Exit?" cover?' is one question). Quoted spans are blanked to the same length, so
// positions still line up. A straight single quote opens a span only after a space or bracket,
// and closes before a space or punctuation, so apostrophes (PEIP's) are left alone.
const QUOTED = /"[^"]*"|“[^”]*”|‘[^’]*’|(?<=^|[\s(])'[^']*'(?=$|[\s,.;:!?)])/g;
export const unquoted = (text) => String(text ?? '').replace(QUOTED, (m) => ' '.repeat(m.length));
const marks = (text) => (unquoted(text).match(/\?/g) ?? []).length;

/**
 * "Could X? What does that tell you?" written as one question is a question and its follow-up:
 * split at the first question mark outside quotes. Anything else is returned as it is.
 * @returns {{ question: string, followUp: string|null }}
 */
export function splitFollowUp(q) {
  if (q.followUp || marks(q.question) !== 2) return q;
  const text = q.question.trim();
  const first = unquoted(text).indexOf('?');
  const rest = text.slice(first + 1).trim();
  return rest ? { question: text.slice(0, first + 1).trim(), followUp: rest } : q;
}

/**
 * Stage 2 first review (spec §9.1, D17). The data has passed schemas/tree-review.schema.json.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkTreeReview(data) {
  const errors = [];
  const email = data.email;
  const opener = openerError(email, REVIEW_OPENERS[data.verdict]);
  if (opener) errors.push(opener);
  if (sentenceCount(email.whatWorks) > 1) errors.push('whatWorks must be one sentence.');
  if (email.ps && sentenceCount(email.ps) > 2) errors.push('The P.S. must be one or two sentences.');

  const parts = [email.opener, email.whatWorks, ...email.questions.flatMap((q) => [q.question, q.followUp ?? '']), ...email.pointers, email.ps ?? ''];
  const words = countWords(parts.join(' '));

  if (data.verdict === 'pass') {
    const limits = config.emailCheck.reviewPass;
    if (email.questions.length) errors.push('A Pass has no numbered questions: questions must be [].');
    if (email.pointers.length > limits.pointersMax) errors.push(`A Pass has at most ${limits.pointersMax} pointers; it has ${email.pointers.length}.`);
    if (words < limits.wordsMin || words > limits.wordsMax) errors.push(`A Pass email must be ${limits.wordsMin}–${limits.wordsMax} words; it has ${words}.`);
    return result(errors);
  }

  const limits = config.emailCheck.reviewQuestions;
  const n = email.questions.length;
  if (n < limits.questionsMin || n > limits.questionsMax) {
    errors.push(`First cut or Rework needs ${limits.questionsMin}–${limits.questionsMax} numbered questions; it has ${n}.`);
  }
  email.questions.forEach((q, i) => {
    const text = q.question.trim();
    if (marks(text) !== 1 || !/\?["'”’)]*$/.test(text)) errors.push(`Question ${i + 1} must be one question, ending with its only question mark.`);
    if (q.followUp && marks(q.followUp) > 1) errors.push(`Question ${i + 1}'s follow-up must ask at most one question.`);
  });
  if (email.pointers.length) errors.push('First cut or Rework has no pointers: pointers must be [].');
  if (words < limits.wordsMin || words > limits.wordsMax) {
    errors.push(`The email must be ${limits.wordsMin}–${limits.wordsMax} words; it has ${words}. Aim for about 200.`);
  }
  return result(errors);
}

const SIGN_OFF_OPENERS = { signed_off: 'signedOff', not_there_yet: 'notThereYet' };

/**
 * The sign-off after the revision (spec §9.1, D17). The data has passed schemas/sign-off.schema.json.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkSignOff(data) {
  const errors = [];
  const email = data.email;
  const limits = config.emailCheck.signOff;
  const opener = openerError(email, SIGN_OFF_OPENERS[data.verdict]);
  if (opener) errors.push(opener);
  if (email.improved.length > 3) errors.push(`improved has at most 3 points; it has ${email.improved.length}.`);
  if (data.verdict === 'signed_off') {
    if (!email.improved.length) errors.push('Signed off needs at least one point in improved.');
    if (email.stillFails.length) errors.push('Signed off has nothing in stillFails: stillFails must be [].');
  } else if (email.stillFails.length < 1 || email.stillFails.length > 4) {
    errors.push(`Not there yet needs 1–4 points in stillFails; it has ${email.stillFails.length}.`);
  }
  if (email.heldPoints.length > limits.heldPointsMax) errors.push(`heldPoints has at most ${limits.heldPointsMax} points; it has ${email.heldPoints.length}.`);
  if (sentenceCount(email.lesson) > 1) errors.push('lesson must be one sentence.');
  if (email.ps && sentenceCount(email.ps) > 2) errors.push('The P.S. must be one or two sentences.');
  const words = countWords([email.opener, ...email.improved, ...email.stillFails, ...email.heldPoints, email.lesson, email.ps ?? ''].join(' '));
  if (words < limits.wordsMin || words > limits.wordsMax) {
    errors.push(`The email must be ${limits.wordsMin}–${limits.wordsMax} words; it has ${words}. Aim for about 200.`);
  }
  return result(errors);
}
