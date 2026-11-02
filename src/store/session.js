// Session state and autosave (TS-2, spec §13). The whole session lives in localStorage under one key;
// nothing is stored server-side. Every storage call is wrapped so a blocked or full store
// degrades to a warning rather than breaking the app.

export const STORAGE_KEY = 'ts.v1.session';
// A session saved by another version is not resumed (as QT D17).
export const SESSION_VERSION = 1;
export const AUTOSAVE_DELAY_MS = 1000;

// RFC 4648 base32 alphabet: upper case and digits only, so it survives the record file name rules.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function makeAttemptId(randomBytes = defaultRandomBytes) {
  const bytes = randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i++) id += BASE32[bytes[i] % 32];
  return id;
}

function defaultRandomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function createSession({ now = new Date(), randomBytes } = {}) {
  return {
    version: SESSION_VERSION,
    // Case mode is hidden in v1; keep the fields so it slots in later.
    mode: 'generic',
    caseId: null,
    attemptId: makeAttemptId(randomBytes),
    startedAt: now.toISOString(),
    endedAt: null,
    step: 'briefing',
    updatedAt: now.toISOString(),
    // Locked after a Pass or a sign-off (IT-9); a loose, browser-only lock (spec D18).
    locked: false,
    setup: null,
    context: null,
    // Stage 1: rounds of up to keyQuestionMaxAttempts attempts each, and the agreed question.
    keyQuestion: { rounds: [], agreed: null, draft: { keyQuestion: '', subQuestions: [''] } },
    // Each tree sent: first, then the revision; each with its reading and Daniel's email.
    trees: [],
    // Uploads the read call couldn't read, per round (spec §6.5).
    unreadable: [],
    // Refused uploads: time, stage and error code only, never the file (IT-10, IT-11).
    blockedUploads: [],
  };
}

/**
 * A fresh run, eg for the next case (spec §13): new attempt ID, from the briefing, with the
 * setup details filled in for the student to check. The access code is checked again at setup.
 */
export function newRunFrom(session, opts) {
  const { completedAt: _done, ...setup } = session.setup ?? {};
  return { ...createSession(opts), setup: session.setup ? setup : null };
}

export function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isSession(value) {
  return Boolean(value) && typeof value === 'object' && value.version === SESSION_VERSION
    && typeof value.attemptId === 'string' && typeof value.step === 'string';
}

// A Tree Surgery session from another version: right shape, different version number.
function isOutdated(value) {
  return Boolean(value) && typeof value === 'object' && Number.isInteger(value.version) && value.version !== SESSION_VERSION
    && typeof value.attemptId === 'string';
}

/**
 * @returns {{ session: object|null, ok: boolean, outdated?: true }} ok is false when storage could
 * not be read; outdated when the saved session is from another version and can't be resumed.
 */
export function loadSaved(storage = defaultStorage()) {
  if (!storage) return { session: null, ok: false };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { session: null, ok: true };
    const parsed = JSON.parse(raw);
    if (isOutdated(parsed)) return { session: null, ok: true, outdated: true };
    return { session: isSession(parsed) ? parsed : null, ok: true };
  } catch {
    return { session: null, ok: false };
  }
}

/** @returns {boolean} true if saved. */
export function saveSession(session, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSaved(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Debounced saver for form edits; call flush() after each step so steps save at once.
 * onResult(ok) reports every save so the app can show or clear the storage warning.
 */
export function createAutosaver({ storage = defaultStorage(), delay = AUTOSAVE_DELAY_MS, onResult = () => {} } = {}) {
  let timer = null;
  let pending = null;

  function write() {
    timer = null;
    if (pending === null) return;
    const ok = saveSession(pending, storage);
    pending = null;
    onResult(ok);
  }

  return {
    schedule(session) {
      pending = session;
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    flush(session) {
      if (session !== undefined) pending = session;
      if (timer) clearTimeout(timer);
      write();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
