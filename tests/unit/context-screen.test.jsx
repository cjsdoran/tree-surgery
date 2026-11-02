// @vitest-environment jsdom
// Context screen (IT-11): panel copy (T-CTX-4), the upload confirmation, blocks recorded.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App.jsx';
import { CONFIRM_LABEL } from '../../src/screens/ContextScreen.jsx';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { CASE_BLOCK_MESSAGE } from '../../shared/caseDetector.js';
import { memoryStorage } from '../helpers/storage.js';
import { words } from '../helpers/fixtures.js';

afterEach(cleanup);

const SETUP = {
  accessCode: 'code', name: 'Mei Chan', studentId: '1', course: 'GBUS 4910', client: 'PEIP', completedAt: '2026-11-02T01:00:00Z',
};

function atContext(processFile = vi.fn()) {
  const storage = memoryStorage();
  saveSession({ ...createSession(), setup: SETUP, step: 'context' }, storage);
  render(<App storage={storage} screens={{ processFile }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return storage;
}

const item = (name, pageCount, extra = {}) => ({
  ok: true, item: { name, kind: 'pdf', sizeBytes: 1000, pageCount, pages: Array(pageCount).fill(words(30)), approx: false, ...extra },
});

async function upload(names) {
  const input = screen.getByLabelText('Upload files (PDF, .docx or .pptx)');
  const files = names.map((n) => new File(['x'], n));
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

describe('T-CTX-4: panel copy', () => {
  it('states the 10-page cap and the case warning in text', () => {
    atContext();
    expect(screen.getByText('Context: up to 10 pages.').tagName).toBe('STRONG');
    expect(screen.getByText(/Do not upload a case PDF\. Publisher terms bar case text from AI tools/)).toBeTruthy();
  });
});

describe('upload confirmation', () => {
  it('is worded for one student', () => {
    atContext();
    expect(CONFIRM_LABEL).toBe('I confirm this material may be shared with an AI tool. If it comes from a client, I have checked our NDA allows it.');
    expect(screen.getByLabelText(CONFIRM_LABEL)).toBeTruthy();
  });

  it('disables upload and paste until the box is ticked, and records when it was ticked', () => {
    const storage = atContext();
    const input = screen.getByLabelText('Upload files (PDF, .docx or .pptx)');
    expect(input.disabled).toBe(true);
    expect(screen.getByLabelText('Or paste your notes').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    expect(input.disabled).toBe(false);
    expect(loadSaved(storage).session.context.confirmedAt).toBeTruthy();
  });

});

describe('T-CTX-5: context is required', () => {
  it('offers no way to continue without context, and enables Continue once context is added', async () => {
    const storage = atContext(vi.fn(async (f) => item(f.name, 2)));
    expect(screen.queryByRole('button', { name: /without context/i })).toBeNull();
    const next = screen.getByRole('button', { name: 'Continue to your key question' });
    expect(next.disabled).toBe(true);
    expect(screen.getByText("Add your context to continue: Daniel reads it for the client's situation.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    await upload(['a.pdf']);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(loadSaved(storage).session.step).toBe('key-question');
  });
});

describe('uploads', () => {
  it('lists added files with pages and cited ranges, then continues with context', async () => {
    const processFile = vi.fn(async (f) => item(f.name, f.name === 'a.pdf' ? 3 : 2));
    const storage = atContext(processFile);
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    await upload(['a.pdf', 'b.pdf']);
    expect(screen.getByRole('heading', { name: 'Your context: 5 of 10 pages' })).toBeTruthy();
    expect(screen.getByText('(cited as p.4–5)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
    expect(screen.getByRole('heading', { name: 'Your context: 2 of 10 pages' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your key question' }));
    const saved = loadSaved(storage).session;
    expect(saved.step).toBe('key-question');
    expect(saved.context.items.map((i) => i.name)).toEqual(['b.pdf']);
  });

  it('refuses a file that takes the total over 10 pages and keeps the rest', async () => {
    const processFile = vi.fn(async (f) => item(f.name, 6));
    atContext(processFile);
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    await upload(['a.pdf', 'b.pdf']);
    expect(screen.getByRole('alert').textContent).toContain('b.pdf: That would bring your context to 12 pages.');
    expect(screen.getByRole('heading', { name: 'Your context: 6 of 10 pages' })).toBeTruthy();
  });

  it('blocks a case file with no override, keeps nothing, and records time, stage and code only', async () => {
    const processFile = vi.fn(async () => ({ ok: false, reason: 'case_blocked', code: 'TS-U06', message: CASE_BLOCK_MESSAGE }));
    const storage = atContext(processFile);
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    await upload(['case.pdf']);
    expect(screen.getByRole('alert').textContent).toContain(`${CASE_BLOCK_MESSAGE} (Error code: TS-U06)`);
    const saved = loadSaved(storage).session;
    expect(saved.context.items).toEqual([]);
    expect(saved.blockedUploads).toHaveLength(1);
    expect(saved.blockedUploads[0]).toMatchObject({ stage: 'context', code: 'TS-U06' });
    expect(Object.keys(saved.blockedUploads[0]).sort()).toEqual(['at', 'code', 'stage']);
    expect(JSON.stringify(saved)).not.toContain('case.pdf');
  });

  it('T-ERR-1: shows the code of any refused file, and records it', async () => {
    const processFile = vi.fn(async () => ({ ok: false, reason: 'unreadable', code: 'TS-U07', detail: 'InvalidPDFException', message: "We couldn't open a.pdf." }));
    const storage = atContext(processFile);
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    await upload(['a.pdf']);
    expect(screen.getByRole('alert').textContent).toContain("a.pdf: We couldn't open a.pdf. (Error code: TS-U07 InvalidPDFException)");
    expect(loadSaved(storage).session.blockedUploads[0]).toMatchObject({ stage: 'context', code: 'TS-U07' });
  });

  it('adds pasted notes with a live word count', () => {
    const storage = atContext();
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    fireEvent.change(screen.getByLabelText('Or paste your notes'), { target: { value: words(600) } });
    expect(screen.getByText('600 / 5,000 words')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add these notes' }));
    expect(screen.getByText('Pasted notes')).toBeTruthy();
    expect(loadSaved(storage).session.context.items[0]).toMatchObject({ kind: 'paste', pageCount: 2 });
  });

  it('records a blocked paste', () => {
    const storage = atContext();
    fireEvent.click(screen.getByLabelText(CONFIRM_LABEL));
    fireEvent.change(screen.getByLabelText('Or paste your notes'), { target: { value: 'Ivey Publishing case notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add these notes' }));
    expect(screen.getByRole('alert').textContent).toContain(CASE_BLOCK_MESSAGE);
    expect(loadSaved(storage).session.blockedUploads).toHaveLength(1);
  });
});
