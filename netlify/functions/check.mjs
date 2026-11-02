// POST /api/check: confirms the access code at setup. No model call.
import { guard, logCall } from '../lib/guard.mjs';

export default async (req) => {
  const startedAt = Date.now();
  const { response, missing } = await guard(req, { parseBody: false });
  if (response) {
    logCall({ endpoint: 'check', startedAt, outcome: response.status, missing });
    return response;
  }
  logCall({ endpoint: 'check', startedAt, outcome: 204 });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};

export const config = { path: '/api/check' };
