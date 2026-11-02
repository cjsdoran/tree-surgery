// A guarded function whose stage is not built yet (milestone 1 skeleton). It checks the access
// code, size limits and case detector like every function, then answers 501 with no model call.
import { guard, json, logCall } from './guard.mjs';
import { MESSAGES } from '../../shared/limits.js';

export function notYetBuilt(endpoint, guardOpts) {
  return async (req) => {
    const startedAt = Date.now();
    const { response, missing } = await guard(req, guardOpts);
    if (response) {
      logCall({ endpoint, startedAt, outcome: response.status, missing });
      return response;
    }
    logCall({ endpoint, startedAt, outcome: 501 });
    return json(501, { error: 'not_implemented', message: MESSAGES.notImplemented });
  };
}
