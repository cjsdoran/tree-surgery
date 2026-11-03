// @vitest-environment jsdom
// The revision and sign-off in the app (IT-7, IT-8, IT-9): T-FLOW-3, T-SIGN-1 (browser side),
// T-SIGN-2 (rendering), T-SIGN-3 (same agreed key question), T-SIGN-4 (failure), T-LOCK-2.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { SIGNED_NEXT } from '../../src/screens/TreeScreen.jsx';
import { emailAsText, treeReviewEmail } from '../../src/emails.js';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { config } from '../../shared/limits.js';
import { memoryStorage } from '../helpers/storage.js';
import { reworkReply } from '../helpers/stage2.js';
import { notThereYet, signedOff } from '../helpers/signoff.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const KQ = 'How can PEIP achieve positive operating cash flow within the next 12 months?';
const reading = (labels) => ({ nodes: [{ level: 0, text: KQ }, ...labels.map((text) => ({ level: 1, text }))], notes: [], rootAsWritten: KQ, rootDiffers: false });
const FIRST = {
  round: 'first', fileName: 'tree.pdf', kind: 'pdf', pageCount: 1, page: 1, recordImage: null, readAt: '2026-11-03T01:00:00Z',
  reading: reading(['How to increase cash inflow?', 'How to decrease cash outflow?']),
  review: { verdict: 'rework', email: reworkReply().email, receivedAt: '2026-11-03T01:01:00Z', model: 'claude-opus-5-5' },
};
const SESSION = {
  setup: { accessCode: 'code', name: 'Mei Chan', studentId: '1', course: 'MGMT 5760', client: 'PEIP' },
  context: { confirmedAt: 'x', items: [{ name: 'n', kind: 'paste', pageCount: 1, pages: ['PEIP makes jam.'], approx: true, sizeBytes: 0 }], pasteDraft: '' },
  keyQuestion: { rounds: [{ startedAt: 'x', attempts: [] }], agreed: { keyQuestion: KQ, subQuestions: [], at: '2026-11-03T00:00:00Z' }, draft: { keyQuestion: KQ, subQuestions: [''] } },
  trees: [FIRST],
  step: 'revision',
};
const REVISED = { status: 'read', reason: null, rootAsWritten: KQ, rootDiffers: false, notes: [], nodes: reading(['How can PEIP grow cash from jam?', 'How can PEIP improve the non-jam businesses?']).nodes, promptVersion: 'read-tree 1.1', servedBy: 'claude-opus-5-5' };
const handle = { kind: 'pdf', name: 'revised.pdf', pageCount: 1, sizeBytes: 1, pages: [{ n: 1, label: null }] };
const prepared = { ok: true, tree: { kind: 'pdf', page: 1, image: { mediaType: 'image/png', base64: 'iVBO' } }, record: null };

function run(signOffReply) {
  const call = vi.fn(async (path) => (path === '/api/read-tree' ? { ok: true, result: REVISED } : signOffReply()));
  const storage = memoryStorage();
  saveSession({ ...createSession(), ...SESSION }, storage);
  render(<App storage={storage} screens={{ tree: { openFile: async () => ({ ok: true, handle }), prepare: async () => prepared, call } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return { storage, call };
}
async function uploadRevision() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Upload your tree (PDF or .pptx)'), { target: { files: [new File(['x'], 'revised.pdf')] } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
  });
}
const ok = (r) => async () => ({ ok: true, result: { ...r, promptVersion: 'sign-off 1.0; stage2 rules 1.2; persona 1.0', servedBy: 'claude-opus-5-5' } });

describe('T-SIGN-1, T-SIGN-3: the sign-off request', () => {
  it('sends the agreed key question, both outlines, and the first review as the student read it', async () => {
    const { call } = run(ok(signedOff()));
    expect(screen.getByRole('heading', { name: 'Your revised tree' })).toBeTruthy();
    await uploadRevision();
    expect(call.mock.calls[0][1]).toMatchObject({ round: 'revision', keyQuestion: KQ });
    const [path, body] = call.mock.calls[1];
    expect(path).toBe('/api/sign-off');
    expect(body.keyQuestion).toBe(KQ);
    expect(body.firstOutline).toContain('1. How to increase cash inflow?');
    expect(body.revisedOutline).toContain('1. How can PEIP grow cash from jam?');
    expect(body.firstVerdict).toBe('rework');
    expect(body.firstEmail).toBe(emailAsText(treeReviewEmail({ setup: SESSION.setup }, FIRST)));
    expect(body.firstEmail).toContain(`1. ${reworkReply().email.questions[0].question}`);
    expect(body.context.text).toContain('PEIP makes jam.');
  });
});

describe('T-SIGN-2, T-LOCK-2: the sign-off arrives', () => {
  it('Signed off: the email with its sections and lesson, the run locked, then the record', async () => {
    const { storage } = run(ok(signedOff()));
    await uploadRevision();
    const email = screen.getByRole('heading', { level: 3, name: 'Re: your revised issue tree' }).closest('article');
    expect(within(email).getByText(config.openers.signedOff).tagName).toBe('STRONG');
    expect(within(email).getByText('What improved')).toBeTruthy();
    expect(within(email).queryByText('What still needs work')).toBeNull();
    expect(within(email).getByText('Lower-level points')).toBeTruthy();
    expect(within(email).getByText(`Lesson for next time: ${signedOff().email.lesson}`)).toBeTruthy();
    expect(screen.getByText(SIGNED_NEXT)).toBeTruthy();
    const saved = loadSaved(storage).session;
    expect(saved).toMatchObject({ locked: true, step: 'revision' });
    expect(saved.endedAt).toBeTruthy();
    expect(saved.trees.map((t) => t.round)).toEqual(['first', 'revision']);
    expect(saved.trees[1].review.verdict).toBe('signed_off');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your record' }));
    expect(loadSaved(storage).session.step).toBe('record');
  });

  it('Not there yet: what still needs work is shown, and the run still ends', async () => {
    const { storage } = run(ok(notThereYet()));
    await uploadRevision();
    const email = screen.getByRole('heading', { level: 3, name: 'Re: your revised issue tree' }).closest('article');
    expect(within(email).getByText(config.openers.notThereYet).tagName).toBe('STRONG');
    expect(within(email).getByText('What still needs work')).toBeTruthy();
    expect(loadSaved(storage).session.locked).toBe(true);
    const inbox = screen.getByRole('complementary', { name: 'Inbox' });
    expect(within(inbox).getByRole('button', { name: /Re: your revised issue tree/ })).toBeTruthy();
  });

  it('T-FLOW-3: no further upload is offered once the sign-off is in', async () => {
    run(ok(signedOff()));
    await uploadRevision();
    expect(screen.queryByLabelText('Upload your tree (PDF or .pptx)')).toBeNull();
  });
});

describe('T-SIGN-4: a sign-off that fails', () => {
  it('keeps the revised reading, shows the code, and Ask Daniel again reruns only the sign-off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const { storage, call } = run(async () => (fail ? { ok: false, status: 200, error: 'timeout', message: 'Daniel is taking too long to reply. Try again.' } : ok(signedOff())()));
    await uploadRevision();
    expect(screen.getByRole('alert').textContent).toContain('(Error code: TS-S03)');
    let saved = loadSaved(storage).session;
    expect(saved.trees).toHaveLength(2);
    expect(saved.locked).toBe(false);
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask Daniel again' }));
    });
    expect(call.mock.calls.filter((c) => c[0] === '/api/read-tree')).toHaveLength(1);
    saved = loadSaved(storage).session;
    expect(saved.locked).toBe(true);
  });
});
