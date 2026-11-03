// Daniel's first review of the tree (IT-6, IT-7, spec §7): two calls to /api/review-tree (D24).
// The findings call returns Part A sealed in a token the browser can't read; the email call
// sends it back and gets the verdict and the email. Each call is retried on its own.
import { askDaniel } from '../daniel/askDaniel.js';
import { buildContext } from '../extract/context.js';
import { outlineFor } from './readTree.js';

/**
 * @returns {Promise<{ ok: true, review: object } | { ok: false, message: string, code: string, final: boolean }>}
 */
export async function reviewTree(session, entry, { call } = {}) {
  const context = buildContext(session.context?.items ?? []);
  const base = {
    keyQuestion: session.keyQuestion.agreed.keyQuestion,
    outline: outlineFor(entry),
    context: { text: context.text, pageCount: context.pageCount },
    mode: session.mode ?? 'generic',
    caseId: session.caseId ?? null,
  };
  const opts = call ? { call } : {};
  const code = session.setup?.accessCode;

  const findings = await askDaniel('/api/review-tree', { ...base, part: 'findings' }, code, opts);
  if (!findings.ok) return findings;
  const r = await askDaniel('/api/review-tree', { ...base, part: 'email', token: findings.result.token }, code, opts);
  if (!r.ok) return r;
  return {
    ok: true,
    review: {
      verdict: r.result.verdict,
      email: r.result.email,
      receivedAt: new Date().toISOString(),
      promptVersion: r.result.promptVersion ?? null,
      model: r.result.servedBy ?? null,
      durationMs: (findings.result.durationMs ?? 0) + (r.result.durationMs ?? 0) || null,
    },
  };
}

/** Session changes once the first review arrives: a Pass ends and locks the run (IT-7, IT-9). */
export function afterReview(session, review) {
  const trees = (session.trees ?? []).map((t) => (t.round === 'first' ? { ...t, review } : t));
  const pass = review.verdict === 'pass';
  return { trees, step: 'feedback', ...(pass ? { locked: true, endedAt: review.receivedAt } : {}) };
}
