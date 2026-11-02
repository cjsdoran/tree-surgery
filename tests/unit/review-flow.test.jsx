// @vitest-environment jsdom
// Stage 2 in the app (IT-6, IT-7, IT-9): T-REV-1 (rendering), T-REV-4 (a failed review reruns
// only the review), T-FLOW-1 (Pass ends and locks the run), T-FLOW-2 (otherwise, the revision).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { PASS_NEXT, REVISE_NEXT } from '../../src/screens/FeedbackScreen.jsx';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { config } from '../../shared/limits.js';
import { memoryStorage } from '../helpers/storage.js';
import { asResult, firstCutReply, passReply, reworkReply } from '../helpers/stage2.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const KQ = 'How can PEIP achieve positive operating cash flow within the next 12 months?';
const READING = { status: 'read', reason: null, rootAsWritten: KQ, rootDiffers: false, notes: ['Level 4 left out (12 boxes) to keep the reading short.'], nodes: [{ level: 0, text: KQ }, { level: 1, text: 'How to increase cash inflow?' }, { level: 1, text: 'How to decrease cash outflow?' }], promptVersion: 'read-tree 1.1', servedBy: 'claude-opus-5-5' };
const SESSION = {
  setup: { accessCode: 'code', name: 'Mei Chan', studentId: '1', course: 'MGMT 5760', client: 'PEIP' },
  context: { confirmedAt: 'x', items: [{ name: 'n', kind: 'paste', pageCount: 1, pages: ['PEIP makes jam.'], approx: true, sizeBytes: 0 }], pasteDraft: '' },
  keyQuestion: { rounds: [{ startedAt: 'x', attempts: [] }], agreed: { keyQuestion: KQ, subQuestions: [], at: '2026-11-02T03:00:00Z' }, draft: { keyQuestion: KQ, subQuestions: [''] } },
  step: 'tree',
};
const handle = { kind: 'pdf', name: 'tree.pdf', pageCount: 1, sizeBytes: 1, pages: [{ n: 1, label: null }] };
const prepared = { ok: true, tree: { kind: 'pdf', page: 1, image: { mediaType: 'image/png', base64: 'iVBO' } }, record: null };

function run(review) {
  const call = vi.fn(async (path) => (path === '/api/read-tree' ? { ok: true, result: READING } : review(path)));
  const storage = memoryStorage();
  saveSession({ ...createSession(), ...SESSION }, storage);
  render(<App storage={storage} screens={{ tree: { openFile: async () => ({ ok: true, handle }), prepare: async () => prepared, call } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return { storage, call };
}
async function upload() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Upload your tree (PDF or .pptx)'), { target: { files: [new File(['x'], 'tree.pdf')] } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
  });
}

describe('T-REV-1: the review email', () => {
  it.each([
    ['rework', reworkReply()],
    ['first_cut', firstCutReply()],
  ])('%s: bold opener, what works, numbered questions with follow-ups, P.S., signature', async (_v, r) => {
    run(async () => ({ ok: true, result: asResult(r) }));
    await upload();
    const email = screen.getByRole('heading', { level: 3, name: 'Re: your issue tree' }).closest('article');
    expect(within(email).getByText('Hi Mei,')).toBeTruthy();
    expect(within(email).getByText(r.email.opener).tagName).toBe('STRONG');
    expect(within(email).getByText(r.email.whatWorks)).toBeTruthy();
    const items = within(email).getByRole('list').querySelectorAll('li');
    expect(within(email).getByRole('list').tagName).toBe('OL');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toBe(`${r.email.questions[0].question} ${r.email.questions[0].followUp}`);
    expect(within(email).getByText(`P.S. ${r.email.ps}`)).toBeTruthy();
    expect(within(email).getByText('Daniel Hart | Engagement Manager | Halden & Rowe')).toBeTruthy();
  });

  it('pass: pointers as bullets, no numbered list', async () => {
    run(async () => ({ ok: true, result: asResult(passReply()) }));
    await upload();
    const email = screen.getByRole('heading', { level: 3, name: 'Re: your issue tree' }).closest('article');
    expect(within(email).getByText(config.openers.pass).tagName).toBe('STRONG');
    expect(within(email).getByRole('list').tagName).toBe('UL');
    expect(within(email).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('T-REV-2 (browser side): the review request', () => {
  it('sends the agreed key question, the outline with its notes, and the context', async () => {
    const { call } = run(async () => ({ ok: true, result: asResult(reworkReply()) }));
    await upload();
    const [path, body] = call.mock.calls[1];
    expect(path).toBe('/api/review-tree');
    expect(body.keyQuestion).toBe(KQ);
    expect(body.outline).toBe(`KEY QUESTION (level 0): ${KQ}\n[Level 4 left out (12 boxes) to keep the reading short.]\n\n1. How to increase cash inflow?\n2. How to decrease cash outflow?`);
    expect(body.context.text).toContain('PEIP makes jam.');
  });
});

describe('T-FLOW-1: a Pass ends the run', () => {
  it('locks the run, says so, and leads to the record', async () => {
    const { storage } = run(async () => ({ ok: true, result: asResult(passReply()) }));
    await upload();
    let saved = loadSaved(storage).session;
    expect(saved).toMatchObject({ step: 'feedback', locked: true });
    expect(saved.endedAt).toBeTruthy();
    expect(saved.trees[0].review).toMatchObject({ verdict: 'pass', model: 'claude-opus-5-5' });
    expect(screen.getByText(PASS_NEXT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your record' }));
    saved = loadSaved(storage).session;
    expect(saved.step).toBe('record');
    expect(JSON.stringify(saved)).not.toContain('STAGE2-FINDING');
  });
});

describe('T-FLOW-2: otherwise, one revision', () => {
  it('leaves the run open and leads to the revision', async () => {
    const { storage } = run(async () => ({ ok: true, result: asResult(reworkReply()) }));
    await upload();
    expect(loadSaved(storage).session).toMatchObject({ step: 'feedback', locked: false, endedAt: null });
    expect(screen.getByText(REVISE_NEXT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upload your revised tree' }));
    expect(loadSaved(storage).session.step).toBe('revision');
  });
});

describe('T-REV-4: a review that fails', () => {
  it('keeps the reading, shows the code, and Ask Daniel again reruns only the review', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const { storage, call } = run(async () => (fail
      ? { ok: false, status: 200, error: 'invalid', errors: ['x'] }
      : { ok: true, result: asResult(reworkReply()) }));
    await upload();
    expect(screen.getByRole('alert').textContent).toContain("Daniel's reply didn't come through properly. Try again. (Error code: TS-S04)");
    expect(loadSaved(storage).session.trees).toHaveLength(1);
    expect(call.mock.calls.filter((c) => c[0] === '/api/review-tree')).toHaveLength(3);
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask Daniel again' }));
    });
    expect(call.mock.calls.filter((c) => c[0] === '/api/read-tree')).toHaveLength(1);
    expect(loadSaved(storage).session.step).toBe('feedback');
  });
});
