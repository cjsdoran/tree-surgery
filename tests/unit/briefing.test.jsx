// @vitest-environment jsdom
// T-BRF-1: the opening screen is Daniel's briefing email (IT-1, spec §2).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { briefingEmail } from '../../src/emails.js';
import { createSession, loadSaved } from '../../src/store/session.js';
import { memoryStorage } from '../helpers/storage.js';

afterEach(cleanup);

const SUBJECT = 'Your issue tree: key question first';
const PARAGRAPHS = [
  'Hi,',
  'Before the team problem-solving session, I want each of you to draft your own issue tree on the key question the team agreed.',
  "Send me your key question first, with your first-level sub-questions if they carry the target. Once we've agreed it, send me your draft issue tree before the team session: one page, in our template, to four levels below the key question, with the agreed key question at the root.",
  "Attach the client brief or your notes too, so I can see the client's situation.",
  'Daniel',
  'Daniel Hart | Engagement Manager | Halden & Rowe',
];

describe('T-BRF-1: briefing email', () => {
  it('opens a new run on the briefing: key question first, then the tree', () => {
    render(<App storage={memoryStorage()} />);
    const email = screen.getByRole('heading', { level: 2, name: SUBJECT }).closest('article');
    for (const p of PARAGRAPHS) expect(within(email).getByText(p)).toBeTruthy();
    expect(screen.getByText('(current step)').parentElement.textContent).toContain('Briefing');
  });

  it('greets the student by first name once setup is done', () => {
    const session = { ...createSession(), setup: { name: '  Mei Ling Chan ' } };
    expect(briefingEmail(session).greeting).toBe('Hi Mei,');
  });

  it('has one button, which opens setup, and the email stays in the inbox', () => {
    const storage = memoryStorage();
    render(<App storage={storage} />);
    const pane = screen.getByRole('main');
    expect(within(pane).getAllByRole('button').map((b) => b.textContent)).toEqual(['Set up →']);
    fireEvent.click(screen.getByRole('button', { name: 'Set up →' }));
    expect(loadSaved(storage).session.step).toBe('setup');
    expect(screen.getByText('(current step)').parentElement.textContent).toContain('Setup');
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Inbox' })).getByRole('button', { name: new RegExp(SUBJECT) }));
    expect(screen.getByRole('heading', { level: 2, name: SUBJECT })).toBeTruthy();
  });
});
