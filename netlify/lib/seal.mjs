// Seals Daniel's Part A between the two review calls (spec §7.1, D7, D24). The browser carries
// the token from the findings call to the email call but cannot read it: AES-256-GCM, with a key
// derived on the server from ANTHROPIC_API_KEY, so there is no extra secret to set. The token is
// bound to the key question and outline it was made for, and expires after an hour.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const TTL_MS = 60 * 60 * 1000;
const INFO = 'tree-surgery review findings v1';

function key(secret) {
  if (!secret) throw new Error('No key to seal with');
  return Buffer.from(hkdfSync('sha256', secret, 'tree-surgery', INFO, 32));
}

// What a token is bound to: the same tree and key question.
const binding = (keyQuestion, outline) => createHash('sha256').update(`${keyQuestion}\n${outline}`).digest();

/** @returns {string} base64url token */
export function seal(data, { keyQuestion, outline }, { secret = process.env.ANTHROPIC_API_KEY, now = Date.now() } = {}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(binding(keyQuestion, outline));
  const body = Buffer.concat([cipher.update(JSON.stringify({ exp: now + TTL_MS, data }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** @returns {object|null} the sealed data, or null if the token is forged, altered, for another tree, or expired */
export function open(token, { keyQuestion, outline }, { secret = process.env.ANTHROPIC_API_KEY, now = Date.now() } = {}) {
  try {
    const raw = Buffer.from(String(token), 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
    decipher.setAAD(binding(keyQuestion, outline));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const { exp, data } = JSON.parse(text);
    return Number.isFinite(exp) && exp > now ? data : null;
  } catch {
    return null;
  }
}
