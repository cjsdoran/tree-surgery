// POST /api/review-tree: Stage 2, Daniel's first review of the tree (IT-6, spec §7), in two calls
// so each finishes inside the time limit (D24). Body: { part: 'findings'|'email', keyQuestion,
// outline, context: { text, pageCount }, token? (email part), attempt, previousErrors?, mode, caseId }.
//   findings → { part, token }: Part A sealed; the browser can carry it but not read it (TS-5).
//   email    → { part, verdict, email }: written from the opened Part A.
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { open } from '../lib/seal.mjs';
import { reviewEmailStage, reviewFindingsStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig } from '../../shared/limits.js';

const ENDPOINT = 'review-tree';
const TOKEN_MAX_CHARS = 60000;
export const EXPIRED_MESSAGE = "Daniel lost his notes on your tree. Ask Daniel again and he'll review it afresh.";
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function validBody(body) {
  const { attempt, part } = body;
  return ['findings', 'email'].includes(part)
    && isText(body.keyQuestion) && isText(body.outline) && isText(body.context?.text)
    && (part === 'findings' || (isText(body.token) && body.token.length <= TOKEN_MAX_CHARS))
    && Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.emailMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req);
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  const log = (outcome) => logCall({ endpoint: ENDPOINT, round: 'first', startedAt, attempt, outcome, missing });
  if (response) {
    log(response.status);
    return response;
  }
  if (!validBody(body)) {
    log(400);
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  if (body.part === 'findings') {
    return respondWithModel({ ...reviewFindingsStage(body), endpoint: `${ENDPOINT}:findings`, round: 'first', startedAt, attempt });
  }
  const findings = process.env.ANTHROPIC_API_KEY ? open(body.token, body) : null;
  if (!findings && process.env.ANTHROPIC_API_KEY) {
    log(400);
    return json(400, { error: 'bad_token', message: EXPIRED_MESSAGE });
  }
  // With no API key, respondWithModel answers TS-S01 before any model call.
  return respondWithModel({ ...reviewEmailStage(body, findings ?? { verdict: 'pass' }), endpoint: `${ENDPOINT}:email`, round: 'first', startedAt, attempt });
};

export const config = { path: '/api/review-tree' };
