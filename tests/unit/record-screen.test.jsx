// @vitest-environment jsdom
// Record step (IT-9, IT-10): download, T-LOCK-1 (a locked run offers nothing to send), T-LOCK-3
// (a new run asks first, then starts afresh with the setup filled in).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App.jsx';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { memoryStorage } from '../helpers/storage.js';
import { passReply } from '../helpers/stage2.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const KQ = 'How can PEIP achieve sustainable cashflow of $200k within 18 months?';
const passed = (step) => ({
  ...createSession(),
  step,
  locked: true,
  endedAt: '2026-11-03T02:00:00Z',
  setup: { accessCode: 'code', name: 'Mei Chan', studentId: '1', course: 'MGMT 5760', client: 'PEIP', completedAt: 'x' },
  context: { confirmedAt: 'x', items: [{ name: 'n', kind: 'paste', pageCount: 1, pages: ['PEIP makes jam.'], approx: true, sizeBytes: 0 }], pasteDraft: '' },
  keyQuestion: { rounds: [{ startedAt: 'x', attempts: [{ keyQuestion: KQ, subQuestions: [], sentAt: 'x', receivedAt: 'x', verdict: 'ok', email: null }] }], agreed: { keyQuestion: KQ, subQuestions: [], at: '2026-11-03T01:00:00Z' }, draft: { keyQuestion: KQ, subQuestions: [''] } },
  trees: [{ round: 'first', fileName: 'tree.pptx', kind: 'pptx', pageCount: 1, page: 1, readAt: 'x', recordImage: null, reading: { nodes: [{ level: 0, text: KQ }], notes: [] }, review: { verdict: 'pass', email: passReply().email, receivedAt: '2026-11-03T02:00:00Z' } }],
});

function open(session, screens = {}) {
  const storage = memoryStorage();
  saveSession(session, storage);
  render(<App storage={storage} screens={screens} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return storage;
}

describe('record screen', () => {
  it('shows the outcome and the lock, and downloads the record', async () => {
    const build = vi.fn(async () => ({ bytes: new Uint8Array([1]), fileName: 'MGMT5760_TreeSurgery_MeiChan_X.pdf', pageCount: 4, replacedCharacters: 0 }));
    const save = vi.fn();
    const storage = open(passed('record'), { buildRecord: build, saveFile: save });
    expect(screen.getByText('Key question agreed (round 1, attempt 1) · First review: Pass')).toBeTruthy();
    expect(screen.getByText('This run is complete and locked: nothing more can be sent to Daniel.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download record PDF' }));
    });
    expect(build.mock.calls[0][0].attemptId).toBe(loadSaved(storage).session.attemptId);
    expect(save).toHaveBeenCalledWith(new Uint8Array([1]), 'MGMT5760_TreeSurgery_MeiChan_X.pdf');
    expect(screen.getByRole('status').textContent).toBe('Downloaded MGMT5760_TreeSurgery_MeiChan_X.pdf (4 pages).');
    expect(loadSaved(storage).session.recordDownloadedAt).toBeTruthy();
  });

  it('says so when the PDF cannot be made', async () => {
    open(passed('record'), { buildRecord: async () => { throw new Error('x'); }, saveFile: vi.fn() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download record PDF' }));
    });
    expect(screen.getByRole('alert').textContent).toContain("We couldn't make the PDF.");
  });
});

describe('T-LOCK-1: a locked run', () => {
  it('resumes onto Daniel\'s review with no way to send anything', () => {
    open(passed('feedback'));
    expect(screen.getByRole('heading', { name: 'Daniel’s review' })).toBeTruthy();
    expect(screen.queryByLabelText(/Upload/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Send to Daniel|Ask Daniel again/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue to your record' })).toBeTruthy();
  });
});

describe('T-LOCK-3: a new run', () => {
  it('asks to confirm, then starts at the briefing with a new attempt ID and the setup filled in', () => {
    const before = passed('record');
    const storage = open(before);
    fireEvent.click(screen.getByRole('button', { name: 'Start a new run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(loadSaved(storage).session.attemptId).toBe(before.attemptId);
    fireEvent.click(screen.getByRole('button', { name: 'Start a new run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start a new run' }));
    const fresh = loadSaved(storage).session;
    expect(fresh.attemptId).not.toBe(before.attemptId);
    expect(fresh).toMatchObject({ step: 'briefing', locked: false, trees: [], setup: { name: 'Mei Chan', client: 'PEIP' } });
    expect(fresh.setup.completedAt).toBeUndefined();
  });
});
