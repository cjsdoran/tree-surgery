// Milestone 1: the autosave store (TS-2).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY,
  clearSaved,
  createAutosaver,
  createSession,
  loadSaved,
  makeAttemptId,
  saveSession,
} from '../../src/store/session.js';
import { memoryStorage, throwingStorage } from '../helpers/storage.js';

afterEach(() => vi.useRealTimers());

describe('attempt ID', () => {
  it('is 8 characters of RFC 4648 base32', () => {
    for (let i = 0; i < 50; i++) expect(makeAttemptId()).toMatch(/^[A-Z2-7]{8}$/);
  });

  it('maps bytes onto the alphabet', () => {
    expect(makeAttemptId(() => Uint8Array.from([0, 1, 25, 26, 31, 32, 255, 64]))).toBe('ABZ27A7A');
  });
});

describe('createSession', () => {
  it('starts at the briefing in generic mode with a start time', () => {
    const now = new Date('2026-10-25T02:00:00Z');
    const s = createSession({ now });
    expect(s).toMatchObject({ version: 1, mode: 'generic', locked: false, caseId: null, step: 'briefing', startedAt: now.toISOString(), endedAt: null });
    expect(s.attemptId).toMatch(/^[A-Z2-7]{8}$/);
    expect(s.blockedUploads).toEqual([]);
    expect(s.keyQuestion).toEqual({ rounds: [], agreed: null });
    expect(s.trees).toEqual([]);
  });
});

describe('save and load', () => {
  it('round-trips the whole session under ts.v1.session', () => {
    const storage = memoryStorage();
    const s = { ...createSession(), setup: { name: 'Zoë Ä', studentId: '2071', course: 'MGMT 5760', client: 'PEIP' } };
    expect(saveSession(s, storage)).toBe(true);
    expect([...storage.map.keys()]).toEqual([STORAGE_KEY]);
    expect(loadSaved(storage)).toEqual({ session: s, ok: true });
  });

  it('returns no session when nothing is saved', () => {
    expect(loadSaved(memoryStorage())).toEqual({ session: null, ok: true });
  });

  it('ignores corrupt or foreign data', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    expect(loadSaved(storage).session).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, attemptId: 'X', step: 'setup' }));
    expect(loadSaved(storage).session).toBeNull();
  });

  it('T-SAV-3: flags a session saved by another version, and does not return it', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, attemptId: 'OTHERRUN', step: 'feedback' }));
    expect(loadSaved(storage)).toEqual({ session: null, ok: true, outdated: true });
    saveSession(createSession(), storage);
    expect(loadSaved(storage).outdated).toBeUndefined();
  });

  it('clears the saved session', () => {
    const storage = memoryStorage();
    saveSession(createSession(), storage);
    clearSaved(storage);
    expect(loadSaved(storage).session).toBeNull();
  });

  it('T-SAV-2: never throws when storage throws or is missing', () => {
    expect(loadSaved(throwingStorage)).toEqual({ session: null, ok: false });
    expect(saveSession(createSession(), throwingStorage)).toBe(false);
    expect(clearSaved(throwingStorage)).toBe(false);
    expect(loadSaved(null)).toEqual({ session: null, ok: false });
    expect(saveSession(createSession(), null)).toBe(false);
  });
});

describe('autosaver', () => {
  it('debounces form edits by 1 second and saves the latest', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const onResult = vi.fn();
    const saver = createAutosaver({ storage, onResult });
    const s = createSession();
    saver.schedule({ ...s, setup: { team: 'A' } });
    vi.advanceTimersByTime(600);
    saver.schedule({ ...s, setup: { team: 'AB' } });
    vi.advanceTimersByTime(999);
    expect(loadSaved(storage).session).toBeNull();
    vi.advanceTimersByTime(1);
    expect(loadSaved(storage).session.setup.team).toBe('AB');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('flush saves at once, for step changes', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const saver = createAutosaver({ storage });
    const s = { ...createSession(), step: 'context' };
    saver.schedule(createSession());
    saver.flush(s);
    expect(loadSaved(storage).session.step).toBe('context');
    vi.advanceTimersByTime(2000);
    expect(loadSaved(storage).session.step).toBe('context');
  });

  it('reports failure when storage throws', () => {
    const onResult = vi.fn();
    createAutosaver({ storage: throwingStorage, onResult }).flush(createSession());
    expect(onResult).toHaveBeenCalledWith(false);
  });
});
