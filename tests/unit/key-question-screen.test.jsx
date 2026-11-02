// @vitest-environment jsdom
// Stage 1 screen (IT-3, spec §5.3): T-KQ-1..5, T-KQ-7, and the retries behind it (as T-REV-3, T-REV-4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { askDaniel } from '../../src/daniel/askDaniel.js';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { PAUSED_MESSAGE } from '../../src/screens/KeyQuestionScreen.jsx';
import { config } from '../../shared/limits.js';
import { memoryStorage } from '../helpers/storage.js';
import { notOkReply } from '../helpers/stage1.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SETUP = { accessCode: 'code', name: 'Mei Chan', studentId: '1', course: 'MGMT 5760', client: 'PEIP', completedAt: '2026-11-02T01:00:00Z' };
const CONTEXT = { confirmedAt: '2026-11-02T01:01:00Z', items: [{ name: 'notes.md', kind: 'paste', pageCount: 1, pages: ['PEIP makes jam.'], approx: true, sizeBytes: 0 }], pasteDraft: '' };

// The browser's view of a reply: what /api/key-question sends after stripping the findings.
const { findings: _f, ...NOT_OK } = notOkReply();
const notOk = () => ({ ok: true, result: { ...NOT_OK, promptVersion: 'stage1-key-question 1.1; persona 1.0', servedBy: 'claude-opus-5-5' } });
const ok = () => ({ ok: true, result: { verdict: 'ok', email: null, promptVersion: 'stage1-key-question 1.1; persona 1.0', servedBy: 'claude-opus-5-5' } });

function atKeyQuestion(call, sessionExtra = {}) {
  const storage = memoryStorage();
  saveSession({ ...createSession(), setup: SETUP, context: CONTEXT, step: 'key-question', ...sessionExtra }, storage);
  render(<App storage={storage} screens={{ call }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return storage;
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function send(name = 'Send to Daniel') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('T-KQ-1: the form', () => {
  it('requires a key question of 400 characters or fewer, and sends nothing until it is fixed', async () => {
    const call = vi.fn();
    atKeyQuestion(call);
    await send();
    expect(screen.getByRole('link', { name: 'Enter your key question.' })).toBeTruthy();
    type('Your key question', 'k'.repeat(401));
    expect(screen.getByText('401 / 400 characters (too long)')).toBeTruthy();
    await send();
    expect(screen.getByRole('link', { name: 'Your key question must be 400 characters or fewer.' })).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
  });

  it('allows up to 5 sub-questions and sends only the filled ones, trimmed', async () => {
    const call = vi.fn(async () => notOk());
    atKeyQuestion(call);
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Add a sub-question' }));
    expect(screen.queryByRole('button', { name: 'Add a sub-question' })).toBeNull();
    type('Your key question', ' How can PEIP survive? ');
    type('Sub-question 2', '  How can PEIP grow jam sales?  ');
    await send();
    const [path, body, code] = call.mock.calls[0];
    expect(path).toBe('/api/key-question');
    expect(code).toBe('code');
    expect(body).toMatchObject({
      keyQuestion: 'How can PEIP survive?', subQuestions: ['How can PEIP grow jam sales?'], attempt: 1, mode: 'generic', caseId: null,
    });
    expect(body.context.text).toContain('PEIP makes jam.');
  });

  it('shows the attempt number and a waiting line while Daniel reads', async () => {
    let resolve;
    const call = vi.fn(() => new Promise((r) => { resolve = r; }));
    atKeyQuestion(call);
    expect(screen.getByText('Attempt 1 of 3')).toBeTruthy();
    type('Your key question', 'How can PEIP survive?');
    await send();
    expect(screen.getByRole('status').textContent).toMatch(/^Daniel is reading your key question… \d+ s$/);
    expect(screen.getByRole('button', { name: 'Send to Daniel' }).disabled).toBe(true);
    await act(async () => resolve(notOk()));
  });
});

describe('T-KQ-2: Not OK', () => {
  it("puts Daniel's email in the inbox and on screen, with the exact opener; keeps the text; counts the attempt", async () => {
    const storage = atKeyQuestion(vi.fn(async () => notOk()));
    type('Your key question', 'How can PEIP avoid going bankrupt again and stabilize cashflow?');
    await send();
    const reply = screen.getByRole('heading', { level: 3, name: 'Re: your key question' }).closest('article');
    expect(within(reply).getByText(config.openers.keyQuestion).tagName).toBe('STRONG');
    expect(within(reply).getByText('Hi Mei,')).toBeTruthy();
    expect(within(reply).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Attempt 2 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Your key question').value).toBe('How can PEIP avoid going bankrupt again and stabilize cashflow?');
    const inbox = screen.getByRole('complementary', { name: 'Inbox' });
    expect(within(inbox).getAllByRole('button', { name: /Re: your key question/ })).toHaveLength(1);
    const saved = loadSaved(storage).session.keyQuestion;
    expect(saved.rounds[0].attempts[0]).toMatchObject({ verdict: 'not_ok', keyQuestion: 'How can PEIP avoid going bankrupt again and stabilize cashflow?', model: 'claude-opus-5-5' });
    expect(JSON.stringify(saved)).not.toContain('FINDING-MARKER');
  });
});

describe('T-KQ-3: OK', () => {
  it('adds the agreed email, freezes the key question and opens the Tree step', async () => {
    const call = vi.fn().mockResolvedValueOnce(notOk()).mockResolvedValueOnce(ok());
    const storage = atKeyQuestion(call);
    type('Your key question', 'How can PEIP achieve sustainable cashflow of $200k within 18 months?');
    await send();
    await send();
    const saved = loadSaved(storage).session;
    expect(saved.step).toBe('tree');
    expect(saved.keyQuestion.agreed).toMatchObject({ keyQuestion: 'How can PEIP achieve sustainable cashflow of $200k within 18 months?', subQuestions: [] });
    const inbox = screen.getByRole('complementary', { name: 'Inbox' });
    fireEvent.click(within(inbox).getAllByRole('button', { name: /Re: your key question/ }).at(-1));
    expect(screen.getByText('That Key Question will work to structure the tree.')).toBeTruthy();
  });
});

describe('T-KQ-4, T-KQ-7: three Not OK, then a new round', () => {
  it('closes the form with the rework message, does not lock the run, and opens round 2 on request', async () => {
    const call = vi.fn(async () => notOk());
    const storage = atKeyQuestion(call);
    type('Your key question', 'How can PEIP survive?');
    await send();
    await send();
    await send();
    expect(screen.getByText(PAUSED_MESSAGE)).toBeTruthy();
    expect(screen.queryByLabelText('Your key question')).toBeNull();
    let saved = loadSaved(storage).session;
    expect(saved).toMatchObject({ step: 'key-question', locked: false, endedAt: null });
    expect(saved.keyQuestion.agreed).toBeNull();

    // A reload resumes on the paused screen.
    cleanup();
    render(<App storage={storage} screens={{ call }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    expect(screen.getByText(PAUSED_MESSAGE)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'I have a new key question' }));
    expect(screen.getByText('Attempt 1 of 3')).toBeTruthy();
    call.mockResolvedValueOnce(ok());
    await send();
    saved = loadSaved(storage).session;
    expect(saved.step).toBe('tree');
    expect(saved.keyQuestion.rounds.map((r) => r.attempts.length)).toEqual([3, 1]);
  });
});

describe('T-KQ-5: the tree stays locked until OK', () => {
  it('a Not OK never moves the run on', async () => {
    const storage = atKeyQuestion(vi.fn(async () => notOk()));
    type('Your key question', 'How can PEIP survive?');
    await send();
    expect(loadSaved(storage).session.step).toBe('key-question');
  });
});

describe('failures', () => {
  it('shows the error with its code and offers to ask again; a failed call is not an attempt', async () => {
    const call = vi.fn(async () => ({ ok: false, status: 200, error: 'timeout', message: 'Daniel is taking too long to reply. Try again.' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = atKeyQuestion(call);
    type('Your key question', 'How can PEIP survive?');
    await send();
    expect(call).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('alert').textContent).toContain('Daniel is taking too long to reply. Try again. (Error code: TS-S03)');
    expect(loadSaved(storage).session.keyQuestion.rounds).toEqual([]);
    call.mockResolvedValueOnce(notOk());
    await send('Ask Daniel again');
    expect(screen.getByText('Attempt 2 of 3')).toBeTruthy();
  });
});

describe('askDaniel', () => {
  it('T-REV-3: retries a reply that fails its checks, sending the failed checks back', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 200, error: 'invalid', errors: ['The opener must be exactly: "x"'] })
      .mockResolvedValueOnce(ok());
    const r = await askDaniel('/api/key-question', { keyQuestion: 'K' }, 'code', { call });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(call.mock.calls[0][1]).toEqual({ keyQuestion: 'K', attempt: 1 });
    expect(call.mock.calls[1][1]).toEqual({ keyQuestion: 'K', attempt: 2, previousErrors: ['The opener must be exactly: "x"'] });
  });

  it('T-REV-4: three failed checks give TS-S04', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const call = vi.fn(async () => ({ ok: false, status: 200, error: 'invalid', errors: ['x'] }));
    expect(await askDaniel('/api/key-question', {}, 'code', { call })).toEqual({
      ok: false, message: "Daniel's reply didn't come through properly. Try again.", code: 'TS-S04', final: false,
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('stops at once on a failure a retry cannot fix', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const call = vi.fn(async () => ({ ok: false, status: 422, error: 'case_blocked', message: 'blocked' }));
    expect(await askDaniel('/api/key-question', {}, 'code', { call })).toEqual({ ok: false, message: 'blocked', code: 'TS-U06', final: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
