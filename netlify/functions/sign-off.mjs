// POST /api/sign-off: Daniel's sign-off on the revised tree (IT-8, spec §8). One model call.
// Body: { keyQuestion, firstOutline, firstVerdict, firstEmail, revisedOutline,
// context: { text, pageCount }, attempt, previousErrors?, mode, caseId }. It needs no hidden
// findings: Daniel re-reads both trees (D20). The result carries the verdict and the email.
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { signOffStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig } from '../../shared/limits.js';

const ENDPOINT = 'sign-off';
const VERDICTS = ['first_cut', 'rework'];
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function validBody(body) {
  const { attempt } = body;
  return isText(body.keyQuestion) && isText(body.firstOutline) && isText(body.revisedOutline)
    && isText(body.firstEmail) && VERDICTS.includes(body.firstVerdict) && isText(body.context?.text)
    && Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.emailMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req);
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, round: 'revision', startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, round: 'revision', startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  return respondWithModel({ ...signOffStage(body), endpoint: ENDPOINT, round: 'revision', startedAt, attempt });
};

export const config = { path: '/api/sign-off' };
