// Daniel's sign-off on the revised tree (IT-8, spec §8): /api/sign-off reads both outlines, the
// first review as the student received it, and the context. The sign-off ends and locks the run
// (IT-9).
import { askDaniel } from '../daniel/askDaniel.js';
import { buildContext } from '../extract/context.js';
import { emailAsText, treeReviewEmail } from '../emails.js';
import { outlineFor } from './readTree.js';

/**
 * @param {object} session
 * @param {object} revision the revision's tree entry, just read
 * @returns {Promise<{ ok: true, review: object } | { ok: false, message: string, code: string, final: boolean }>}
 */
export async function signOff(session, revision, { call } = {}) {
  const first = (session.trees ?? []).find((t) => t.round === 'first' && t.review);
  const context = buildContext(session.context?.items ?? []);
  const body = {
    keyQuestion: session.keyQuestion.agreed.keyQuestion,
    firstOutline: outlineFor(first),
    firstVerdict: first.review.verdict,
    firstEmail: emailAsText(treeReviewEmail(session, first)),
    revisedOutline: outlineFor(revision),
    context: { text: context.text, pageCount: context.pageCount },
    mode: session.mode ?? 'generic',
    caseId: session.caseId ?? null,
  };
  const r = await askDaniel('/api/sign-off', body, session.setup?.accessCode, call ? { call } : {});
  if (!r.ok) return r;
  return {
    ok: true,
    review: {
      verdict: r.result.verdict,
      email: r.result.email,
      receivedAt: new Date().toISOString(),
      promptVersion: r.result.promptVersion ?? null,
      model: r.result.servedBy ?? null,
      durationMs: r.result.durationMs ?? null,
    },
  };
}

/** Session changes once the sign-off arrives: the run ends and locks (IT-9). */
export function afterSignOff(session, review) {
  const trees = (session.trees ?? []).map((t) => (t.round === 'revision' ? { ...t, review } : t));
  return { trees, locked: true, endedAt: review.receivedAt };
}
