// Loads the runtime prompts from prompts/ (bundled with `included_files`). Server-side only:
// the browser receives the prompt version, never the text.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map();

// Netlify runs functions from LAMBDA_TASK_ROOT with included files beside them; netlify dev
// and the tests run from the repository root.
function locate(file) {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd()].filter(Boolean);
  for (const root of roots) {
    const path = join(root, 'prompts', file);
    if (existsSync(path)) return path;
  }
  throw new Error(`Prompt not found: prompts/${file}`);
}

export function promptVersion(text) {
  return /version:\s*([\d.]+)/.exec(text)?.[1] ?? 'unknown';
}

/** @returns {{ text: string, version: string }} the HTML comment header is kept out of the text. */
export function loadPrompt(name) {
  if (!cache.has(name)) {
    const raw = readFileSync(locate(`${name}.md`), 'utf8');
    const text = raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
    cache.set(name, { text, version: promptVersion(raw) });
  }
  return cache.get(name);
}

/** System prompt for an EM call: the shared persona, then the task prompt. */
export function emSystemPrompt(name) {
  const persona = loadPrompt('persona');
  const task = loadPrompt(name);
  return { text: `${persona.text}\n\n${task.text}`, version: `${name} ${task.version}; persona ${persona.version}` };
}

/** System prompt for a task that is not in Daniel's voice, eg reading the tree (spec D10). */
export function taskSystemPrompt(name) {
  const task = loadPrompt(name);
  return { text: task.text, version: `${name} ${task.version}` };
}
