// POST /api/review-tree: Stage 2, Daniel's first review of the tree (IT-6, spec §7). One model
// call. Body: { keyQuestion, outline, context: { text, pageCount }, attempt, previousErrors?,
// mode, caseId }. The outline is the reading as the app renders it, with any transcription
// notes. The result carries only the verdict and the email (TS-5).
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { reviewTreeStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig } from '../../shared/limits.js';

const ENDPOINT = 'review-tree';
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function validBody(body) {
  const { attempt } = body;
  return isText(body.keyQuestion) && isText(body.outline) && isText(body.context?.text)
    && Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.emailMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req);
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, round: 'first', startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, round: 'first', startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  return respondWithModel({ ...reviewTreeStage(body), endpoint: ENDPOINT, round: 'first', startedAt, attempt });
};

export const config = { path: '/api/review-tree' };
