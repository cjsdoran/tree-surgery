// Stage 1 state (IT-3, spec §5): rounds of up to keyQuestionMaxAttempts attempts. After the last
// Not OK in a round the student reworks and comes back with a new key question (D16): a new
// round. The session keeps every attempt, and the record prints them all.
import { config } from '../../shared/limits.js';
import { buildContext } from '../extract/context.js';
import { askDaniel } from '../daniel/askDaniel.js';

export function emptyKeyQuestion() {
  return { rounds: [], agreed: null, draft: { keyQuestion: '', subQuestions: [''] } };
}

export function stage1(session) {
  return { ...emptyKeyQuestion(), ...session.keyQuestion };
}

/** Where Stage 1 stands: 'agreed', 'paused' (round used up), or 'open'. */
export function stage1Status(kq) {
  if (kq.agreed) return 'agreed';
  const round = kq.rounds.at(-1);
  if (round && round.attempts.length >= config.keyQuestionMaxAttempts) return 'paused';
  return 'open';
}

/** The attempt number the next send will be, in the current round. */
export function nextAttemptNumber(kq) {
  const round = kq.rounds.at(-1);
  return !round || round.attempts.length >= config.keyQuestionMaxAttempts ? 1 : round.attempts.length + 1;
}

export const cleanSubQuestions = (subs) => (subs ?? []).map((s) => s.trim()).filter(Boolean);

/** Adds an answered attempt to the current round, opening round 1 if there is none. */
export function addAttempt(kq, attempt) {
  const rounds = kq.rounds.length ? kq.rounds : [{ startedAt: attempt.sentAt, attempts: [] }];
  const last = rounds.at(-1);
  const next = [...rounds.slice(0, -1), { ...last, attempts: [...last.attempts, attempt] }];
  const agreed = attempt.verdict === 'ok'
    ? { keyQuestion: attempt.keyQuestion, subQuestions: attempt.subQuestions, at: attempt.receivedAt }
    : null;
  return { ...kq, rounds: next, agreed };
}

/** "I have a new key question": a fresh round after a paused one. */
export function startNewRound(kq, now = new Date()) {
  return { ...kq, rounds: [...kq.rounds, { startedAt: now.toISOString(), attempts: [] }] };
}

/**
 * Sends the key question to Daniel.
 * @returns {Promise<{ ok: true, attempt: object } | { ok: false, message: string, code: string, final: boolean }>}
 */
export async function sendKeyQuestion(session, { keyQuestion, subQuestions }, { call } = {}) {
  const context = buildContext(session.context?.items ?? []);
  const sentAt = new Date().toISOString();
  const body = {
    keyQuestion: keyQuestion.trim(),
    subQuestions: cleanSubQuestions(subQuestions),
    context: { text: context.text, pageCount: context.pageCount },
    mode: session.mode ?? 'generic',
    caseId: session.caseId ?? null,
  };
  const r = await askDaniel('/api/key-question', body, session.setup?.accessCode, call ? { call } : {});
  if (!r.ok) return r;
  return {
    ok: true,
    attempt: {
      keyQuestion: body.keyQuestion,
      subQuestions: body.subQuestions,
      sentAt,
      receivedAt: new Date().toISOString(),
      verdict: r.result.verdict,
      email: r.result.email,
      promptVersion: r.result.promptVersion ?? null,
      model: r.result.servedBy ?? null,
      durationMs: r.result.durationMs ?? null,
    },
  };
}
