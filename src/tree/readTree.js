// Sends the prepared tree page to /api/read-tree (IT-5, spec §6.5) and records the outcome: a
// reading kept in session.trees, or an unreadable upload, which doesn't use up the revision.
import { askDaniel } from '../daniel/askDaniel.js';
import { renderOutline } from '../../shared/outline.js';

/**
 * @param {object} session
 * @param {'first'|'revision'} round
 * @param {{ tree: object, record: object|null, fileName: string, kind: string, pageCount: number }} upload
 * @returns {Promise<{ ok: true, readable: true, entry: object } | { ok: true, readable: false, unreadable: object }
 *   | { ok: false, message: string, code: string, final: boolean }>}
 */
export async function readTree(session, round, upload, { call } = {}) {
  const body = {
    round,
    keyQuestion: session.keyQuestion.agreed.keyQuestion,
    tree: upload.tree,
    mode: session.mode ?? 'generic',
    caseId: session.caseId ?? null,
  };
  const sentAt = new Date().toISOString();
  const r = await askDaniel('/api/read-tree', body, session.setup?.accessCode, call ? { call } : {});
  if (!r.ok) return r;
  const res = r.result;
  const file = { fileName: upload.fileName, kind: upload.kind, pageCount: upload.pageCount, page: upload.tree.page };
  if (res.status === 'unreadable') {
    return { ok: true, readable: false, unreadable: { round, at: new Date().toISOString(), reason: res.reason, ...file } };
  }
  return {
    ok: true,
    readable: true,
    entry: {
      round,
      ...file,
      sentAt,
      readAt: new Date().toISOString(),
      recordImage: upload.record,
      reading: { nodes: res.nodes, notes: res.notes ?? [], rootAsWritten: res.rootAsWritten, rootDiffers: Boolean(res.rootDiffers) },
      readPromptVersion: res.promptVersion ?? null,
      readModel: res.servedBy ?? null,
    },
  };
}

/**
 * The outline the review and sign-off receive and the record prints (spec §6.5, §10.3). A root
 * that differs from the agreed key question gets a transcription note (assumption 4).
 */
export function outlineFor(entry) {
  const { nodes, notes, rootAsWritten, rootDiffers } = entry.reading;
  const all = [...notes];
  if (rootDiffers && rootAsWritten) {
    all.unshift(`Transcription note: the root on the page reads "${rootAsWritten}", which differs from the agreed key question.`);
  }
  return renderOutline(nodes, all);
}
