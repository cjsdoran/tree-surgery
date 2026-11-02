// Parses the JSON a model returns. Kept apart from schemaCheck.js so the browser can use it
// without loading the schema validator.

/**
 * Parses the model's JSON text. Tolerates a stray markdown fence or text around the object,
 * which the prompts forbid but a model can still produce.
 * @returns {{ ok: true, data: any } | { ok: false, error: string }}
 */
export function parseModelJson(text) {
  const raw = String(text ?? '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, error: 'No JSON object in the response.' };
  try {
    return { ok: true, data: JSON.parse(raw.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` };
  }
}
