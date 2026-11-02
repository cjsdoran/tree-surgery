// Stage 1 model replies for tests, as the model returns them (findings included).
import { config } from '../../shared/limits.js';

export const FINDING_MARKER = 'FINDING-MARKER-91c2';

const findings = (fails = []) => ['smart', 'one_question', 'no_overlap', 'open', 'clear_words'].map((test) => ({
  test,
  result: fails.includes(test) ? 'fail' : 'pass',
  evidence: `${FINDING_MARKER} ${test}`,
}));

export function notOkReply(overrides = {}) {
  return {
    verdict: 'not_ok',
    findings: findings(['one_question', 'smart']),
    email: {
      subject: 'Re: your key question',
      opener: config.openers.keyQuestion,
      whatWorks: 'You have named the right client and kept the focus on cash.',
      points: [
        '"Avoid going bankrupt again and stabilize cashflow" is two questions joined by "and". Stable cash flow is how PEIP avoids bankruptcy, so the parts overlap and the tree would split on both at once.',
        '"Stabilize" has no figure and no date. Use the shape "How can [Client] achieve [quantified outcome] through [mechanism] by [date]?", or keep a broad question and let a sub-question carry the number and date.',
      ],
    },
    ...overrides,
  };
}

export function okReply(overrides = {}) {
  return { verdict: 'ok', findings: findings(), email: null, ...overrides };
}

export const json = (o) => JSON.stringify(o);
