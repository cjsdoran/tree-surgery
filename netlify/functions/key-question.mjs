// POST /api/key-question: Stage 1, Daniel's review of the key question (IT-3, spec §5). One
// model call. Body: { keyQuestion, subQuestions[], context: { text, pageCount }, attempt,
// previousErrors?, mode, caseId }. Returns NDJSON (netlify/lib/anthropic.mjs) whose result
// carries only the verdict and the email; the findings never leave the server (TS-5).
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { keyQuestionStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig } from '../../shared/limits.js';

const ENDPOINT = 'key-question';
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function validBody(body) {
  const attempt = body.attempt;
  return isText(body.keyQuestion)
    && (body.subQuestions === undefined || (Array.isArray(body.subQuestions) && body.subQuestions.every((s) => typeof s === 'string')))
    && isText(body.context?.text)
    && Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.emailMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req);
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  const stage = keyQuestionStage(body);
  return respondWithModel({ ...stage, endpoint: ENDPOINT, startedAt, attempt });
};

export const config = { path: '/api/key-question' };
