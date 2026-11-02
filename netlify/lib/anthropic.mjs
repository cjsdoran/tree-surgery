// One model call per function invocation (spec §9). Unlike Question Time, the model's text is
// never passed through: the internal findings must not reach the browser (TS-5). The reply is
// gathered here, handed to `finish`, and only what `finish` returns goes out.
//
// Response: NDJSON, one JSON object per line:
//   { type: 'meta', promptVersion }
//   { type: 'ping' }                             keep-alive while the model works (QT D20)
//   then exactly one of:
//   { type: 'result', ...fields, promptVersion, servedBy, durationMs }
//   { type: 'invalid', errors }                  JSON, schema or email check failed; retry
//   { type: 'error', error, message }            timeout | truncated | refusal | model_error
// The response starts (status 200) before the model is called, so every model failure arrives
// as an error event (QT D8).
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../shared/limits.js';
import { json, logCall } from './guard.mjs';

export const MODEL_MESSAGES = {
  timeout: 'Daniel is taking too long to reply. Try again.',
  truncated: "Daniel's reply was cut short. Try again.",
  refusal: "Daniel couldn't reply to this. Check your text and try again.",
  modelError: "Daniel couldn't reply just now. Try again in a minute.",
};

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let makeClient = () => new Anthropic({ maxRetries: 1 });

/** Tests swap in a fake client; pass nothing to restore the real one. */
export function setClientFactoryForTests(factory) {
  makeClient = factory ?? (() => new Anthropic({ maxRetries: 1 }));
}

const encoder = new TextEncoder();
const line = (event) => encoder.encode(`${JSON.stringify(event)}\n`);

/**
 * Builds the request parameters for a call.
 * @param {string} call key in config.models
 * @param {string} system system prompt text
 * @param {string|object[]} content the user message: text, or content blocks (eg an image)
 */
export function modelParams(call, system, content) {
  const settings = config.models[call];
  const params = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    // The system prompt is the same on every call, so cache it; a regeneration reuses it.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    ...(settings.effort ? { output_config: { effort: settings.effort } } : {}),
  };
  // Server-side refusal fallback; the model that answered is reported for the record.
  if (settings.fallbacks) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = settings.fallbacks;
  }
  return params;
}

/**
 * Runs the model and returns the whole reply. Used by the functions (through respondWithModel)
 * and in-process by the pilot harness, which keeps the findings for Chris.
 * @returns {Promise<{ ok: true, text: string, servedBy: string, inputTokens: number|null, outputTokens: number|null }
 *   | { ok: false, error: 'timeout'|'truncated'|'refusal'|'model_error' }>}
 */
export async function callModel({ call, system, content, startedAt = Date.now() }) {
  const params = modelParams(call, system, content);
  const budgetMs = config.functionBudgetSeconds * 1000 - (Date.now() - startedAt);
  let timedOut = false;
  let stream;
  const timer = setTimeout(() => {
    timedOut = true;
    stream?.abort();
  }, Math.max(budgetMs, 1000));

  let text = '';
  try {
    const client = makeClient();
    stream = params.betas ? client.beta.messages.stream(params) : client.messages.stream(params);
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') text += event.delta.text;
    }
    const message = await stream.finalMessage();
    const usage = message.usage ?? {};
    if (message.stop_reason === 'max_tokens') return { ok: false, error: 'truncated' };
    if (message.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
    return {
      ok: true,
      text,
      servedBy: message.model ?? params.model,
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
    };
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'model_error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The function side: calls the model while sending keep-alive pings, then sends the one final
 * event built by `finish(text)`, which must strip anything the browser may not see.
 * @param {object} p
 * @param {string} p.call key in config.models
 * @param {string} p.endpoint name for the log
 * @param {string|null} [p.round] 'first' | 'revision', for the log
 * @param {string} p.system
 * @param {string|object[]} p.content
 * @param {string} p.promptVersion returned to the browser for the record
 * @param {number} p.startedAt when the invocation began, for the time budget
 * @param {number|null} [p.attempt]
 * @param {(text: string) => ({ type: 'result', [k: string]: any } | { type: 'invalid', errors: string[] })} p.finish
 * @param {string} [p.truncatedError] if set, a reply cut off at max_tokens comes back as invalid with
 *   this error, so the browser's retry can tell the model what to do (the read call, Chris's rule).
 * @returns {Promise<Response>}
 */
export async function respondWithModel({ call, endpoint, round = null, system, content, promptVersion, startedAt, attempt = null, finish, truncatedError }) {
  const log = (fields) => logCall({ endpoint, round, startedAt, attempt, ...fields });
  if (!process.env.ANTHROPIC_API_KEY) {
    log({ outcome: 'no_api_key', missing: 'ANTHROPIC_API_KEY' });
    return json(500, { error: 'server_misconfigured', message: 'Tree Surgery is not set up correctly. Tell your instructor.' });
  }

  const body = new ReadableStream({
    async start(controller) {
      // Keep-alive (QT D20): while the model works nothing else goes out, and a connection that
      // stays silent for long can be closed on the way to the browser.
      let lastSent = Date.now();
      const send = (event) => {
        controller.enqueue(line(event));
        lastSent = Date.now();
      };
      const keepAliveMs = (config.keepAliveSeconds ?? 5) * 1000;
      const pinger = setInterval(() => {
        if (Date.now() - lastSent >= keepAliveMs) send({ type: 'ping' });
      }, Math.max(10, keepAliveMs / 2));

      send({ type: 'meta', promptVersion });
      let outcome = 'ok';
      let tokens = {};
      try {
        const reply = await callModel({ call, system, content, startedAt });
        if (!reply.ok && reply.error === 'truncated' && truncatedError) {
          outcome = 'truncated';
          send({ type: 'invalid', errors: [truncatedError] });
        } else if (!reply.ok) {
          outcome = reply.error;
          const key = reply.error === 'model_error' ? 'modelError' : reply.error;
          send({ type: 'error', error: reply.error, message: MODEL_MESSAGES[key] });
        } else {
          tokens = { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
          let event;
          try {
            event = finish(reply.text);
          } catch {
            event = { type: 'invalid', errors: ['Your output could not be read. Return only the JSON object.'] };
          }
          if (event.type === 'invalid') {
            outcome = 'invalid';
            send({ type: 'invalid', errors: event.errors });
          } else {
            send({ ...event, type: 'result', promptVersion, servedBy: reply.servedBy, durationMs: Date.now() - startedAt });
          }
        }
      } finally {
        clearInterval(pinger);
        log({ outcome, inputTokens: tokens.inputTokens ?? null, outputTokens: tokens.outputTokens ?? null });
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
