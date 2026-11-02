// The stage cores (spec §9): what each model function sends and how it reads the reply. The
// functions use `finish`, which strips the internal findings before anything leaves the server;
// the pilot harness uses `read`, which keeps them for Chris.
import { emSystemPrompt } from './prompts.mjs';
import { checkSchema, parseModelJson } from '../../shared/schemaCheck.js';
import { checkKeyQuestion } from '../../shared/emailCheck.js';

const INVALID_JSON = 'Your reply was not a single valid JSON object. Return only the JSON object.';

function previousErrorsBlock(errors) {
  const list = Array.isArray(errors) ? errors.filter((e) => typeof e === 'string' && e.trim()).slice(0, 20) : [];
  return list.length ? `\n\n<previous_errors>\n${list.map((e) => `- ${e}`).join('\n')}\n</previous_errors>` : '';
}

/**
 * Parses and checks a reply: JSON, then omitted empty fields filled in (as QT D23), then the
 * schema, then the email check.
 * @returns {{ ok: true, data: object } | { ok: false, errors: string[] }}
 */
export function readReply(text, { schema, fill = (d) => d, check }) {
  const parsed = parseModelJson(text);
  if (!parsed.ok) return { ok: false, errors: [INVALID_JSON] };
  const data = fill(parsed.data);
  const valid = checkSchema(schema, data);
  if (!valid.ok) return { ok: false, errors: valid.errors.map((e) => `Schema: ${e}.`) };
  const checked = check(data);
  return checked.ok ? { ok: true, data } : { ok: false, errors: checked.errors };
}

// ---------- Stage 1: key question (spec §5) ----------

/** Fills Stage 1 fields a model may leave out when they are empty. */
export function fillKeyQuestion(data) {
  if (!data || typeof data !== 'object' || !data.email || typeof data.email !== 'object') return data;
  return { ...data, email: { whatWorks: '', points: [], ...data.email } };
}

/** The user message in the tagged blocks the Stage 1 prompt expects. */
export function keyQuestionMessage(body) {
  const subs = (body.subQuestions ?? []).map((s) => s.trim()).filter(Boolean);
  return [
    `<key_question>\n${body.keyQuestion.trim()}\n</key_question>`,
    `<sub_questions>\n${subs.length ? subs.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'None'}\n</sub_questions>`,
    `<context>\n${body.context.text}\n</context>`,
  ].join('\n\n') + previousErrorsBlock(body.previousErrors);
}

export function keyQuestionStage(body) {
  const prompt = emSystemPrompt('stage1-key-question');
  const read = (text) => readReply(text, { schema: 'key-question', fill: fillKeyQuestion, check: checkKeyQuestion });
  return {
    call: 'keyQuestion',
    system: prompt.text,
    content: keyQuestionMessage(body),
    promptVersion: prompt.version,
    read,
    // What the browser may see: the verdict and the email. The findings stay here (TS-5).
    finish(text) {
      const r = read(text);
      if (!r.ok) return { type: 'invalid', errors: r.errors };
      return { type: 'result', verdict: r.data.verdict, email: r.data.email };
    },
  };
}
