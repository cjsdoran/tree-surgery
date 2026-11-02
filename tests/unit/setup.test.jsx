// @vitest-environment jsdom
// T-SET-1: setup rejects missing fields, over-long ones, or a bad access code (TS-1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App.jsx';
import { briefingEmail } from '../../src/emails.js';
import { validateSetup, emptySetup } from '../../src/setup/validate.js';
import { checkAccessCode } from '../../src/api.js';
import { loadSaved } from '../../src/store/session.js';
import { memoryStorage } from '../helpers/storage.js';

afterEach(cleanup);

// A new run opens on the briefing (IT-1); its button leads to setup.
function renderAtSetup(props) {
  render(<App {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set up →' }));
}

const valid = () => ({ accessCode: 'code', name: 'Mei Chan', studentId: '20871234', course: 'MGMT 5760', client: 'PEIP' });

describe('validateSetup', () => {
  it('accepts a complete setup', () => {
    expect(validateSetup(valid())).toEqual({ ok: true, errors: [] });
  });

  it('names every missing field, in screen order', () => {
    expect(validateSetup(emptySetup()).errors.map((e) => e.message)).toEqual([
      'Enter the access code from Canvas.',
      'Enter your name.',
      'Enter your student ID.',
      'Choose your course.',
      'Enter the client or project name.',
    ]);
  });

  it('applies the 60-, 20- and 60-character limits', () => {
    expect(validateSetup({ ...valid(), name: 'n'.repeat(60), studentId: 's'.repeat(20), client: 'c'.repeat(60) }).ok).toBe(true);
    const errs = validateSetup({ ...valid(), name: 'n'.repeat(61), studentId: 's'.repeat(21), client: 'c'.repeat(61) }).errors;
    expect(errs.map((e) => e.field)).toEqual(['setup-name', 'setup-studentId', 'setup-client']);
    expect(errs[0].message).toBe('Your name must be 60 characters or fewer.');
  });

  it('rejects a course outside the config and whitespace-only fields', () => {
    const errs = validateSetup({ ...valid(), course: 'MGMT 9999', name: '   ' }).errors.map((e) => e.field);
    expect(errs).toEqual(['setup-name', 'setup-course']);
  });
});

describe('checkAccessCode', () => {
  it('maps 204 to ok, 401 to the Canvas message, and a network failure to a retry message', async () => {
    expect(await checkAccessCode('x', async () => new Response(null, { status: 204 }))).toEqual({ ok: true });
    expect(await checkAccessCode('x', async () => new Response('{}', { status: 401 }))).toEqual({
      ok: false, status: 401, code: 'TS-S02', message: "That access code isn't recognised. Check Canvas.",
    });
    const misconfigured = await checkAccessCode('x', async () => Response.json({ error: 'server_misconfigured', message: 'Not set up.' }, { status: 500 }));
    expect(misconfigured).toEqual({ ok: false, status: 500, code: 'TS-S01', message: 'Not set up.' });
    const offline = await checkAccessCode('x', async () => { throw new TypeError('fetch failed'); });
    expect(offline).toMatchObject({ ok: false, status: 0 });
  });

  it('sends the code in a header, not the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await checkAccessCode('secret', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/check');
    expect(init.headers['X-TS-Access-Code']).toBe('secret');
  });
});

function fill(values) {
  const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  set('Access code', values.accessCode);
  set('Your name', values.name);
  set('Student ID', values.studentId);
  set('Course', values.course);
  set('Client or project name', values.client);
}

describe('setup screen', () => {
  it('shows the error summary on submit and does not call the server', () => {
    const check = vi.fn();
    renderAtSetup({ storage: memoryStorage(), screens: { check } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to context' }));
    expect(screen.getByRole('heading', { name: 'Fix these 5 things to continue' })).toBeTruthy();
    expect(screen.getByLabelText('Student ID').getAttribute('aria-invalid')).toBe('true');
    expect(check).not.toHaveBeenCalled();
  });

  it('has no team fields', () => {
    renderAtSetup({ storage: memoryStorage(), screens: { check: vi.fn() } });
    expect(screen.queryByLabelText(/Team name/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a member/ })).toBeNull();
  });

  it('shows the bad-code message from the server against the access code field', async () => {
    const check = vi.fn(async () => ({ ok: false, status: 401, code: 'TS-S02', message: "That access code isn't recognised. Check Canvas." }));
    renderAtSetup({ storage: memoryStorage(), screens: { check } });
    fill(valid());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to context' }));
    await screen.findByText("That access code isn't recognised. Check Canvas. (Error code: TS-S02)");
    expect(screen.getByLabelText('Access code').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Set up' })).toBeTruthy();
  });

  it('T-ERR-1 TS-S01: shows a server set-up failure with its code', async () => {
    const check = vi.fn(async () => ({ ok: false, status: 500, code: 'TS-S01', message: 'Tree Surgery is not set up correctly. Tell your instructor.' }));
    renderAtSetup({ storage: memoryStorage(), screens: { check } });
    fill(valid());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to context' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Tree Surgery is not set up correctly. Tell your instructor. (Error code: TS-S01)');
  });

  it('shows a live character count', () => {
    renderAtSetup({ storage: memoryStorage(), screens: { check: vi.fn() } });
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: '1'.repeat(21) } });
    expect(screen.getByText('21 / 20 characters (too long)')).toBeTruthy();
  });

  it('moves to context on a good code, trimmed, saves at once, and the briefing greets by first name', async () => {
    const storage = memoryStorage();
    const check = vi.fn(async () => ({ ok: true }));
    renderAtSetup({ storage, screens: { check } });
    fill({ ...valid(), name: '  Mei   Chan ', client: '  PEIP  ' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to context' }));
    await screen.findByRole('heading', { name: 'Client context' });
    expect(check).toHaveBeenCalledWith('code');
    const saved = loadSaved(storage).session;
    expect(saved.step).toBe('context');
    expect(saved.setup).toMatchObject({ name: 'Mei Chan', studentId: '20871234', client: 'PEIP', course: 'MGMT 5760' });
    expect(saved.setup.completedAt).toBeTruthy();
    expect(briefingEmail(saved).greeting).toBe('Hi Mei,');
    expect(screen.getByRole('banner').textContent).toContain('Mei Chan');
    await waitFor(() => expect(screen.getByRole('contentinfo').textContent).toMatch(/^MGMT 5760 practice tool/));
  });
});
