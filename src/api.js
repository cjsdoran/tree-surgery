// Calls to the Netlify functions. The access code travels in a header on every call.
import { MESSAGES } from '../shared/limits.js';
import { codeForServerError } from '../shared/errorCodes.js';

export const NETWORK_MESSAGE = "We couldn't reach Tree Surgery. Check your connection and try again.";

export async function checkAccessCode(code, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/api/check', { method: 'POST', headers: { 'X-TS-Access-Code': code } });
    if (res.status === 204) return { ok: true };
    if (res.status === 401) return { ok: false, status: 401, code: codeForServerError({ status: 401 }), message: MESSAGES.badAccessCode };
    const payload = await errorPayload(res);
    return { ok: false, status: res.status, code: codeForServerError({ status: res.status, error: payload.error }), message: payload.message || NETWORK_MESSAGE };
  } catch {
    return { ok: false, status: 0, code: codeForServerError({ status: 0, error: 'network' }), message: NETWORK_MESSAGE };
  }
}

async function errorPayload(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Calls a model function and reads its NDJSON events (netlify/lib/anthropic.mjs, spec §9). The
 * function sends pings while Daniel works, then one final event: result, invalid or error.
 * @param {string} path eg '/api/key-question'
 * @param {object} body request body
 * @param {string} accessCode
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: true, result: object }
 *   | { ok: false, status: number, error: string, message: string, errors?: string[] }>}
 *   error 'invalid' means the reply failed its checks; `errors` go back as previousErrors.
 */
export async function modelCall(path, body, accessCode, { fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TS-Access-Code': accessCode },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: 'network', message: NETWORK_MESSAGE };
  }
  if (res.status !== 200) {
    const payload = await errorPayload(res);
    const message = res.status === 401 ? MESSAGES.badAccessCode : payload.message || NETWORK_MESSAGE;
    return { ok: false, status: res.status, error: payload.error || 'http_error', message };
  }

  let final = null;
  const handle = (raw) => {
    if (!raw.trim()) return;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (['result', 'invalid', 'error'].includes(event.type)) final = event;
  };

  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handle);
    }
    handle(buffer + decoder.decode());
  } catch {
    return { ok: false, status: 200, error: 'network', message: NETWORK_MESSAGE };
  }

  if (!final) return { ok: false, status: 200, error: 'incomplete', message: NETWORK_MESSAGE };
  if (final.type === 'error') return { ok: false, status: 200, error: final.error, message: final.message };
  if (final.type === 'invalid') return { ok: false, status: 200, error: 'invalid', message: NETWORK_MESSAGE, errors: final.errors ?? [] };
  const { type: _type, ...result } = final;
  return { ok: true, result };
}
