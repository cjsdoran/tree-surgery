// Calls one of Daniel's functions and retries until the reply passes its checks (spec §9 step 5):
// a reply that fails is sent back with its failed checks as previousErrors, up to
// emailMaxAttempts calls in all. A failure a retry can't fix (access code, size, case block,
// bad request, server set-up) stops at once.
import { config } from '../../shared/limits.js';
import { CODES, codeForServerError } from '../../shared/errorCodes.js';
import { modelCall } from '../api.js';

export const FORMAT_FAILED_MESSAGE = "Daniel's reply didn't come through properly. Try again.";

const FINAL_STATUSES = [400, 401, 413, 422, 500];

/**
 * @param {string} path eg '/api/key-question'
 * @param {object} body request body, without attempt or previousErrors
 * @param {string} accessCode
 * @param {{ call?: typeof modelCall }} [opts]
 * @returns {Promise<{ ok: true, result: object, attempts: number }
 *   | { ok: false, message: string, code: string, final: boolean }>}
 */
export async function askDaniel(path, body, accessCode, { call = modelCall } = {}) {
  let previousErrors = [];
  let lastFailure = null;
  for (let attempt = 1; attempt <= config.emailMaxAttempts; attempt++) {
    const r = await call(path, { ...body, attempt, ...(previousErrors.length ? { previousErrors } : {}) }, accessCode);
    if (r.ok) return { ok: true, result: r.result, attempts: attempt };

    if (r.error === 'invalid') {
      previousErrors = r.errors ?? [];
      lastFailure = { message: FORMAT_FAILED_MESSAGE, code: CODES.formatFailed };
      continue;
    }
    const code = codeForServerError(r);
    console.warn(`Tree Surgery ${code}`, path, r.error);
    if (FINAL_STATUSES.includes(r.status)) return { ok: false, message: r.message, code, final: true };
    lastFailure = { message: r.message, code };
    previousErrors = [];
  }
  if (lastFailure.code === CODES.formatFailed) console.warn(`Tree Surgery ${CODES.formatFailed}`, path, 'failed the checks');
  return { ok: false, ...lastFailure, final: false };
}
