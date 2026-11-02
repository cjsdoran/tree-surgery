// POST /api/read-tree: reads the uploaded tree page into an outline (IT-5, spec §6.5). One model
// call, no persona (D10). Body: { round: 'first'|'revision', keyQuestion, tree: { kind: 'pdf'|'pptx',
// page, image?: { mediaType, base64 }, pageText?, shapes? }, attempt, previousErrors?, mode, caseId }.
// The request may carry the page image, so its size limit is readTreeMaxBytes.
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { readTreeStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig, limits } from '../../shared/limits.js';

const ENDPOINT = 'read-tree';
const IMAGE_TYPES = ['image/png', 'image/jpeg'];
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const optionalText = (v) => v === undefined || typeof v === 'string';

function validImage(image) {
  return image && IMAGE_TYPES.includes(image.mediaType) && isText(image.base64) && /^[A-Za-z0-9+/]+=*$/.test(image.base64.slice(0, 200));
}

export function validBody(body) {
  const { tree, attempt } = body;
  if (!['first', 'revision'].includes(body.round) || !isText(body.keyQuestion)) return false;
  if (!tree || !['pdf', 'pptx'].includes(tree.kind) || !Number.isInteger(tree.page) || tree.page < 1) return false;
  if (!optionalText(tree.pageText) || !optionalText(tree.shapes)) return false;
  if (tree.image !== undefined && !validImage(tree.image)) return false;
  // A PDF page is always an image; a slide is shapes text, or an image for a picture-only slide.
  const hasInput = tree.kind === 'pdf' ? Boolean(tree.image) : Boolean(tree.image) !== isText(tree.shapes);
  return hasInput && Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.emailMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req, { maxBytes: limits.readTreeMaxBytes });
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  const round = ['first', 'revision'].includes(body?.round) ? body.round : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, round, startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, round, startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  const stage = readTreeStage(body);
  return respondWithModel({ ...stage, endpoint: ENDPOINT, round, startedAt, attempt });
};

export const config = { path: '/api/read-tree' };
