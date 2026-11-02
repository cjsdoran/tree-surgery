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
