// The stage cores (spec §9): what each model function sends and how it reads the reply. The
// functions use `finish`, which strips the internal findings before anything leaves the server;
// the pilot harness uses `read`, which keeps them for Chris.
import { emSystemPrompt, taskSystemPrompt } from './prompts.mjs';
import { checkSchema, parseModelJson } from '../../shared/schemaCheck.js';
import { checkKeyQuestion, checkTreeReview, splitFollowUp } from '../../shared/emailCheck.js';
import { checkNodes, nodesFromLines } from '../../shared/outline.js';
import { seal } from './seal.mjs';

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

// ---------- Reading the tree (spec §6.5) ----------

// A reading cut off at max_tokens is retried with this, so the model leaves out the bottom
// level (prompts/read-tree.md, large trees; Chris, 2 Nov 2026).
export const READ_CUT_OFF = 'Your last reply was cut off because the tree is too large. Leave out the bottom level of the tree and add the note for it.';

export function fillReadTree(data) {
  if (!data || typeof data !== 'object') return data;
  return { reason: null, rootAsWritten: null, rootDiffers: false, outline: '', notes: [], ...data };
}

/** The read is consistent: a readable tree has a valid outline; an unreadable one has a reason. */
export function checkReadTree(data) {
  if (data.status === 'unreadable') {
    return data.reason ? { ok: true, errors: [], nodes: [] } : { ok: false, errors: ['An unreadable page needs a reason.'] };
  }
  const { nodes, errors } = nodesFromLines(data.outline);
  const all = [...errors, ...checkNodes(nodes)];
  if (data.reason !== null) all.push('reason must be null when status is "read".');
  return { ok: all.length === 0, errors: all.slice(0, 10), nodes };
}

/**
 * The user message: the tree page as an image block (PDF, or a picture-only slide), with its
 * text layer when it has one, or the slide's shapes as text.
 */
export function readTreeContent(body) {
  const text = [`<agreed_key_question>\n${body.keyQuestion.trim()}\n</agreed_key_question>`];
  const { tree } = body;
  if (tree.pageText) text.push(`<page_text>\n${tree.pageText}\n</page_text>`);
  if (tree.shapes) text.push(`<slide_shapes>\n${tree.shapes}\n</slide_shapes>`);
  const message = text.join('\n\n') + previousErrorsBlock(body.previousErrors);
  if (!tree.image) return message;
  return [
    { type: 'image', source: { type: 'base64', media_type: tree.image.mediaType, data: tree.image.base64 } },
    { type: 'text', text: message },
  ];
}

export function readTreeStage(body) {
  const prompt = taskSystemPrompt('read-tree');
  const read = (text) => {
    const r = readReply(text, { schema: 'read-tree', fill: fillReadTree, check: checkReadTree });
    if (!r.ok) return r;
    return { ok: true, data: { ...r.data, nodes: nodesFromLines(r.data.outline).nodes } };
  };
  return {
    call: 'readTree',
    system: prompt.text,
    content: readTreeContent(body),
    promptVersion: prompt.version,
    truncatedError: READ_CUT_OFF,
    read,
    finish(text) {
      const r = read(text);
      if (!r.ok) return { type: 'invalid', errors: r.errors };
      const { status, reason, rootAsWritten, rootDiffers, nodes, notes } = r.data;
      return { type: 'result', status, reason, rootAsWritten, rootDiffers, nodes, notes };
    },
  };
}

// ---------- Stage 2: first review (spec §7) ----------

/**
 * Tidies a Stage 2 email before the checks: fills fields a model leaves out when empty, moves a
 * follow-up written into the question into its own field, and drops a "P.S." the model wrote
 * itself (the app adds it). Found in the first timing run, 3 Nov 2026.
 */
export function fillTreeReview(data) {
  if (!data || typeof data !== 'object' || !data.email || typeof data.email !== 'object') return data;
  const email = { questions: [], pointers: [], ps: null, ...data.email };
  email.questions = Array.isArray(email.questions)
    ? email.questions.map((q) => (q && typeof q === 'object' && typeof q.question === 'string' ? splitFollowUp({ followUp: null, ...q }) : q))
    : email.questions;
  if (typeof email.ps === 'string') email.ps = email.ps.replace(/^\s*P\.?\s?S\.?[:\s]*/i, '').trim() || null;
  return { ...data, email };
}

/**
 * The user message for one part of the review, in the tagged blocks the Stage 2 prompt
 * expects. The email part also carries Part A, opened from its sealed token (spec §7.1).
 */
export function reviewTreeMessage(body, part, findings = null) {
  const blocks = [
    `<part>${part}</part>`,
    `<key_question>\n${body.keyQuestion.trim()}\n</key_question>`,
    `<tree_outline>\n${body.outline}\n</tree_outline>`,
    `<context>\n${body.context.text}\n</context>`,
  ];
  if (findings) blocks.push(`<findings>\n${JSON.stringify(findings, null, 2)}\n</findings>`);
  return blocks.join('\n\n') + previousErrorsBlock(body.previousErrors);
}

/**
 * Part A: verdict and findings. The browser gets them only as a sealed token it can't read
 * (TS-5); the pilot harness reads them with `read`.
 */
export function reviewFindingsStage(body) {
  const prompt = emSystemPrompt('stage2-tree-review');
  const read = (text) => readReply(text, { schema: 'tree-review-findings', check: () => ({ ok: true, errors: [] }) });
  return {
    call: 'reviewTree',
    system: prompt.text,
    content: reviewTreeMessage(body, 'findings'),
    promptVersion: prompt.version,
    read,
    finish(text) {
      const r = read(text);
      if (!r.ok) return { type: 'invalid', errors: r.errors };
      return { type: 'result', part: 'findings', token: seal(r.data, body) };
    },
  };
}

/** Part B: the email, written from Part A. The browser gets the verdict and the email. */
export function reviewEmailStage(body, findings) {
  const prompt = emSystemPrompt('stage2-tree-review');
  const read = (text) => {
    const r = readReply(text, {
      schema: 'tree-review-email',
      fill: fillTreeReview,
      check: (data) => checkTreeReview({ verdict: findings.verdict, email: data.email }),
    });
    return r.ok ? { ok: true, data: { verdict: findings.verdict, email: r.data.email } } : r;
  };
  return {
    call: 'reviewEmail',
    system: prompt.text,
    content: reviewTreeMessage(body, 'email', findings),
    promptVersion: prompt.version,
    read,
    finish(text) {
      const r = read(text);
      if (!r.ok) return { type: 'invalid', errors: r.errors };
      return { type: 'result', part: 'email', verdict: r.data.verdict, email: r.data.email };
    },
  };
}
