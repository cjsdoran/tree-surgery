// A fake Anthropic client for function tests: no network, no cost.
// `script` controls the stream: the text chunks, stop reason, usage, a silent thinking pause
// (thinkMs), or a failure.
// Calls through client.messages land in client.calls; calls through client.beta.messages
// (used when a fallback is requested) land in client.beta.calls.
export function fakeClient(script = {}) {
  const calls = [];
  const betaCalls = [];
  // `script` may be a function of the request params, eg to answer each review part differently.
  const streamFor = (list) => (params) => {
    list.push(params);
    return fakeStream(typeof script === 'function' ? script(params) : script, params);
  };
  return {
    calls,
    messages: { stream: streamFor(calls) },
    beta: { calls: betaCalls, messages: { stream: streamFor(betaCalls) } },
  };
}

function fakeStream({ chunks = ['{}'], stopReason = 'end_turn', usage = { input_tokens: 100, output_tokens: 20 }, servedBy, failBeforeFirst, failAfter, hang, thinkMs = 0 } = {}, params = {}) {
  let aborted = false;
  let rejectHang;
  return {
    abort() {
      aborted = true;
      rejectHang?.(new Error('aborted'));
    },
    async finalMessage() {
      return { model: servedBy ?? params.model, stop_reason: stopReason, usage, content: [{ type: 'text', text: chunks.join('') }] };
    },
    async *[Symbol.asyncIterator]() {
      if (failBeforeFirst) throw new Error('upstream 529');
      yield { type: 'message_start', message: { usage } };
      // A silent pause, as while the model thinks before writing.
      if (thinkMs) await new Promise((resolve) => setTimeout(resolve, thinkMs));
      for (let i = 0; i < chunks.length; i++) {
        if (aborted) throw new Error('aborted');
        if (failAfter === i) throw new Error('connection reset');
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[i] } };
      }
      if (hang) await new Promise((_, reject) => { rejectHang = reject; });
      yield { type: 'message_stop' };
    },
  };
}

/** Reads an NDJSON Response body into its events. */
export async function readEvents(res) {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
