// @vitest-environment jsdom
// The app shell, footer, resume prompt and storage warning (TS-2, TS-3).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App.jsx';
import { STORAGE_KEY, createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { memoryStorage, throwingStorage } from '../helpers/storage.js';

afterEach(cleanup);

const BRIEFING = 'Your issue tree: key question first';

describe('app shell', () => {
  it('shows the firm header, the briefing email with signature, and the footer', () => {
    render(<App storage={memoryStorage()} />);
    expect(screen.getByRole('banner').textContent).toContain('Halden & Rowe');
    expect(screen.getByRole('banner').textContent).toContain('Tree Surgery');
    expect(screen.getByRole('heading', { name: BRIEFING })).toBeTruthy();
    expect(screen.getByText('Daniel Hart | Engagement Manager | Halden & Rowe')).toBeTruthy();
    expect(screen.getByRole('contentinfo').textContent).toBe(
      'MGMT 5760 / GBUS 4910 practice tool. Feedback is AI-generated; you remain responsible for your work.',
    );
  });

  it('marks the current step with text, not colour alone', () => {
    render(<App storage={memoryStorage()} />);
    expect(screen.getByText('(current step)').parentElement.textContent).toContain('Briefing');
  });

  it('lists the eight steps', () => {
    render(<App storage={memoryStorage()} />);
    const steps = screen.getByRole('navigation', { name: 'Progress' }).querySelectorAll('li');
    expect([...steps].map((li) => li.textContent.replace(' (current step)', ''))).toEqual(
      ['1. Briefing', '2. Setup', '3. Context', '4. Key question', '5. Tree', '6. Feedback', '7. Revision', '8. Record'],
    );
  });

  it('names the chosen course in the footer and the client and student in the header', () => {
    const storage = memoryStorage();
    saveSession({ ...createSession(), step: 'setup', setup: { course: 'GBUS 4910', client: 'Clarks', name: 'Mei Chan' } }, storage);
    render(<App storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    expect(screen.getByRole('contentinfo').textContent).toMatch(/^GBUS 4910 practice tool\./);
    expect(screen.getByRole('banner').textContent).toContain('Clarks');
    expect(screen.getByRole('banner').textContent).toContain('Mei Chan');
  });

  it('saves a new attempt on first load', () => {
    const storage = memoryStorage();
    render(<App storage={storage} />);
    const shown = screen.getByTestId('attempt-id').textContent;
    expect(loadSaved(storage).session.attemptId).toBe(shown);
  });

  it('shows a placeholder for steps not built yet', () => {
    const storage = memoryStorage();
    saveSession({ ...createSession(), step: 'revision' }, storage);
    render(<App storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    expect(screen.getByRole('heading', { name: 'Revision' })).toBeTruthy();
    expect(screen.getByText('This step is not available yet.')).toBeTruthy();
  });
});

describe('resume (TS-2)', () => {
  it('offers to resume a saved attempt and restores it', () => {
    const storage = memoryStorage();
    const saved = { ...createSession(), step: 'setup' };
    saveSession(saved, storage);
    render(<App storage={storage} />);
    expect(screen.getByRole('heading', { name: 'Resume where you left off?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    expect(screen.getByTestId('attempt-id').textContent).toBe(saved.attemptId);
  });

  it('asks for confirmation before starting again, then replaces the attempt', () => {
    const storage = memoryStorage();
    const saved = createSession();
    saveSession(saved, storage);
    render(<App storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    // Nothing is lost until the student confirms.
    expect(loadSaved(storage).session.attemptId).toBe(saved.attemptId);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start again' }));
    const shown = screen.getByTestId('attempt-id').textContent;
    expect(shown).not.toBe(saved.attemptId);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).attemptId).toBe(shown);
  });

  it('T-SAV-3: does not resume a session of another version; deletes it and says why', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, attemptId: 'OTHERRUN', step: 'feedback' }));
    render(<App storage={storage} />);
    expect(screen.queryByRole('heading', { name: 'Resume where you left off?' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Update notice' }).textContent).toBe(
      "Tree Surgery has been updated since your last visit, so your earlier attempt in this browser can't be resumed. Start again.",
    );
    expect(screen.getByRole('heading', { name: BRIEFING })).toBeTruthy();
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(saved.version).toBe(1);
    expect(saved.attemptId).not.toBe('OTHERRUN');
  });
});

describe('storage failure (T-SAV-2)', () => {
  it('still renders and warns that progress will not survive', () => {
    render(<App storage={throwingStorage} />);
    expect(screen.getByRole('alert').textContent).toContain('won’t survive closing or');
    expect(screen.getByTestId('attempt-id').textContent).toMatch(/^[A-Z2-7]{8}$/);
  });

  it('shows no warning when storage works', () => {
    render(<App storage={memoryStorage()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
