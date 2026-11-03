// Stage 2 model replies for tests, as the model returns them (findings included).
import { config } from '../../shared/limits.js';

export const FINDING_MARKER = 'STAGE2-FINDING-5d7e';

const findings = () => [
  { n: 1, level: 1, test: 'Unique to this problem', finding: `${FINDING_MARKER} inflow vs outflow`, inEmail: true },
  { n: 2, level: 3, test: 'Single child', finding: `${FINDING_MARKER} held twig`, inEmail: false },
];

const QUESTIONS = [
  { question: 'Could "How to increase cash inflow?" and "How to decrease cash outflow?" be moved onto any other company unchanged?', followUp: 'What does that tell you about the first split?' },
  { question: 'If PEIP pushes more jam through wholesale, which of your level 1 branches change?', followUp: null },
  { question: 'What does the "cash cycle" branch hold that the inflow and outflow branches do not already move?', followUp: 'Where would payment terms with distributors sit?' },
  { question: 'Who would own "cash control" if two analysts split your tree between them, and what would they pass each other?', followUp: null },
];

export function reworkReply(overrides = {}) {
  return {
    keyQuestionCheck: 'Sound: operating cash flow, 12 months.',
    verdict: 'rework',
    verdictReason: `${FINDING_MARKER} reason`,
    findings: findings(),
    email: {
      subject: 'Re: your issue tree',
      opener: config.openers.rework,
      whatWorks: 'Your tree splits on cash flow, the metric in the key question, and every node is a clear "How" question.',
      questions: QUESTIONS.map((q) => ({ ...q })),
      pointers: [],
      ps: 'Check the interest figure on the debt branch: is it per year or per month?',
    },
    ...overrides,
  };
}

export function firstCutReply(overrides = {}) {
  const r = reworkReply({ verdict: 'first_cut', ...overrides });
  r.email = { ...r.email, opener: config.openers.firstCut };
  return r;
}

export function passReply(overrides = {}) {
  return {
    keyQuestionCheck: 'Sound.',
    verdict: 'pass',
    verdictReason: `${FINDING_MARKER} pass`,
    findings: [],
    email: {
      subject: 'Re: your issue tree',
      opener: config.openers.pass,
      whatWorks: 'Separating jam from the non-jam businesses before splitting the jam channels lets the team park the café and garden whole.',
      questions: [],
      pointers: [
        'Start the workplan on the jam channel branches, where most of the cash sits.',
        'Leave the long-shot acquisitions shallow until the channel numbers are in.',
      ],
      ps: null,
    },
    ...overrides,
  };
}

/** The model's Part A (findings call) and Part B (email call) replies for a full review. */
export function partA(reply) {
  const { email: _e, ...a } = reply;
  return a;
}
export const partB = (reply) => ({ email: reply.email });

/** What a mocked /api/review-tree returns to the browser for each part (D24). */
export function reviewCall(reply) {
  return (body) => ({ ok: true, result: body.part === 'findings' ? { part: 'findings', token: 'SEALED' } : { part: 'email', ...asResult(reply) } });
}

/** The browser's view: what /api/review-tree sends after stripping the findings. */
export function asResult(reply) {
  return { verdict: reply.verdict, email: reply.email, promptVersion: 'stage2-tree-review 1.1; persona 1.0', servedBy: 'claude-opus-5-5' };
}
