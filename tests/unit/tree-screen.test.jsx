// @vitest-environment jsdom
// Tree step (IT-2, IT-4, IT-5, spec §6): T-TPL-1, T-UP-2..4, T-UP-7, T-READ-1, T-READ-4, T-READ-6.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { TEMPLATE_URL } from '../../src/screens/TreeScreen.jsx';
import { outlineFor } from '../../src/tree/readTree.js';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { memoryStorage } from '../helpers/storage.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const KQ = 'How can PEIP achieve sustainable cashflow of $200k within 18 months?';
const SESSION = {
  setup: { accessCode: 'code', name: 'Mei Chan', studentId: '1', course: 'MGMT 5760', client: 'PEIP' },
  context: { confirmedAt: 'x', items: [{ name: 'n', kind: 'paste', pageCount: 1, pages: ['PEIP makes jam.'], approx: true, sizeBytes: 0 }], pasteDraft: '' },
  keyQuestion: { rounds: [{ startedAt: 'x', attempts: [] }], agreed: { keyQuestion: KQ, subQuestions: [], at: '2026-11-02T03:00:00Z' }, draft: { keyQuestion: KQ, subQuestions: [''] } },
  step: 'tree',
};

const handle = (kind, pageCount) => ({
  kind, name: kind === 'pdf' ? 'tree.pdf' : 'tree.pptx', pageCount, sizeBytes: 1000,
  pages: Array.from({ length: pageCount }, (_, i) => ({ n: i + 1, label: kind === 'pptx' ? `Slide text ${i + 1}` : null })),
});
const prepared = (n) => ({ ok: true, tree: { kind: 'pdf', page: n, image: { mediaType: 'image/png', base64: 'iVBO' }, pageText: 'Page' }, record: { mediaType: 'image/jpeg', base64: '/9j/', width: 1600, height: 900 } });
const REWORK = { verdict: 'rework', email: { subject: 'Re: your tree', opener: 'x', whatWorks: 'y', questions: [], pointers: [], ps: null }, promptVersion: 'stage2-tree-review 1.1', servedBy: 'claude-opus-5-5' };
// Answers each endpoint: the reading for /api/read-tree, a review for /api/review-tree.
const route = (reading, review = REWORK) => vi.fn(async (path) => ({ ok: true, result: path === '/api/read-tree' ? reading : review }));
const READING = { status: 'read', reason: null, rootAsWritten: KQ, rootDiffers: false, notes: [], nodes: [{ level: 0, text: KQ }, { level: 1, text: 'Grow?' }, { level: 1, text: 'Cut?' }], promptVersion: 'read-tree 1.0', servedBy: 'claude-opus-5-5' };

function atTree(deps) {
  const storage = memoryStorage();
  saveSession({ ...createSession(), ...SESSION }, storage);
  render(<App storage={storage} screens={{ tree: deps }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return storage;
}

async function choose(name = 'tree.pdf') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Upload your tree (PDF or .pptx)'), { target: { files: [new File(['x'], name)] } });
  });
}
async function sendTree() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
  });
}

describe('panel', () => {
  it('T-UP-7, T-TPL-1: shows the agreed key question and the caps in text; no template link until the file exists', () => {
    atTree({});
    expect(screen.getByText(KQ).tagName).toBe('STRONG');
    expect(screen.getByText('Up to 25 pages or slides, 20 MB.').tagName).toBe('STRONG');
    expect(TEMPLATE_URL).toBeNull();
    expect(screen.queryByRole('link', { name: /template/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send to Daniel' }).disabled).toBe(true);
  });
});

describe('page picker', () => {
  it('T-UP-2: a one-page file is chosen automatically', async () => {
    const call = route(READING);
    const prepare = vi.fn(async (_h, n) => prepared(n));
    atTree({ openFile: async () => ({ ok: true, handle: handle('pdf', 1) }), prepare, thumbnails: async () => [], call });
    await choose();
    expect(screen.queryByRole('group', { name: /Which page/ })).toBeNull();
    await sendTree();
    expect(prepare.mock.calls[0][1]).toBe(1);
  });

  it('T-UP-3: several PDF pages show thumbnails; Send waits for a choice; the chosen page is sent', async () => {
    const call = route(READING);
    const prepare = vi.fn(async (_h, n) => prepared(n));
    atTree({ openFile: async () => ({ ok: true, handle: handle('pdf', 3) }), prepare, thumbnails: async () => ['data:a', 'data:b', 'data:c'], call });
    await choose();
    const picker = screen.getByRole('group', { name: 'Which page has your tree?' });
    expect(within(picker).getAllByRole('radio')).toHaveLength(3);
    expect(picker.querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Send to Daniel' }).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Page 2/));
    await sendTree();
    expect(prepare.mock.calls[0][1]).toBe(2);
    const [path, body] = call.mock.calls[0];
    expect(path).toBe('/api/read-tree');
    expect(body).toMatchObject({ round: 'first', keyQuestion: KQ, tree: { kind: 'pdf', page: 2 }, attempt: 1 });
  });

  it('T-UP-4: several slides show their numbers and first text', async () => {
    atTree({ openFile: async () => ({ ok: true, handle: handle('pptx', 2) }), thumbnails: async () => [] });
    await choose('tree.pptx');
    const picker = screen.getByRole('group', { name: 'Which slide has your tree?' });
    expect(within(picker).getByText('Slide text 2')).toBeTruthy();
    expect(within(picker).getByText('Slide 1')).toBeTruthy();
  });
});

describe('refusals', () => {
  it('shows a refused file with its code and records it', async () => {
    const storage = atTree({ openFile: async () => ({ ok: false, reason: 'wrong_type', code: 'TS-U01', message: "notes.docx isn't a PDF or .pptx file." }) });
    await choose('notes.docx');
    expect(screen.getByRole('alert').textContent).toContain("notes.docx isn't a PDF or .pptx file. (Error code: TS-U01)");
    expect(loadSaved(storage).session.blockedUploads).toEqual([expect.objectContaining({ stage: 'tree', code: 'TS-U01' })]);
  });

  it('shows a refused page (no tree on the slide) with its code', async () => {
    const storage = atTree({
      openFile: async () => ({ ok: true, handle: handle('pptx', 1) }),
      prepare: async () => ({ ok: false, reason: 'no_tree', code: 'TS-U09', message: "We couldn't find a tree on slide 1." }),
    });
    await choose('tree.pptx');
    await sendTree();
    expect(screen.getByRole('alert').textContent).toContain('(Error code: TS-U09)');
    expect(loadSaved(storage).session.blockedUploads[0]).toMatchObject({ stage: 'tree', code: 'TS-U09' });
  });
});

describe('T-READ-1: a reading', () => {
  it('keeps the reading and the record image, does not show the outline, and stores no full-size image', async () => {
    const storage = atTree({ openFile: async () => ({ ok: true, handle: handle('pdf', 1) }), prepare: async (_h, n) => prepared(n), call: route(READING) });
    await choose();
    await sendTree();
    // The review follows at once, and the Feedback step opens.
    expect(screen.getByRole('heading', { name: 'Daniel’s review' })).toBeTruthy();
    expect(screen.queryByText('Grow?')).toBeNull();
    const saved = loadSaved(storage).session;
    expect(saved.trees).toHaveLength(1);
    expect(saved.trees[0]).toMatchObject({ round: 'first', fileName: 'tree.pdf', page: 1, recordImage: { mediaType: 'image/jpeg' }, reading: { nodes: READING.nodes }, readModel: 'claude-opus-5-5' });
    expect(JSON.stringify(saved)).not.toContain('iVBO');
  });
});

describe('T-READ-4: an unreadable page', () => {
  it("adds Daniel's email with the reason, offers a fresh upload, and doesn't use up the revision", async () => {
    const call = vi.fn().mockResolvedValueOnce({ ok: true, result: { status: 'unreadable', reason: 'blurred', nodes: [] } }).mockResolvedValueOnce({ ok: true, result: READING }).mockResolvedValueOnce({ ok: true, result: REWORK });
    const storage = atTree({ openFile: async () => ({ ok: true, handle: handle('pdf', 1) }), prepare: async (_h, n) => prepared(n), call });
    await choose();
    await sendTree();
    const email = screen.getByRole('heading', { level: 3, name: "Re: your issue tree – can't read it" }).closest('article');
    expect(within(email).getByText("I can't read the tree you sent. The page is too blurred to read the boxes. Send it to me again as one clear page, in our template.")).toBeTruthy();
    let saved = loadSaved(storage).session;
    expect(saved.unreadable).toEqual([expect.objectContaining({ round: 'first', reason: 'blurred', fileName: 'tree.pdf', page: 1 })]);
    expect(saved.trees).toEqual([]);
    expect(within(screen.getByRole('complementary', { name: 'Inbox' })).getByRole('button', { name: /can't read it/ })).toBeTruthy();
    await choose();
    await sendTree();
    saved = loadSaved(storage).session;
    expect(saved.trees).toHaveLength(1);
    expect(saved.unreadable).toHaveLength(1);
  });
});

describe('T-READ-6: a differing root', () => {
  it('adds a transcription note to the outline the review receives', () => {
    const entry = { reading: { nodes: READING.nodes, notes: ['One word is illegible.'], rootAsWritten: 'How can PEIP grow?', rootDiffers: true } };
    const outline = outlineFor(entry);
    expect(outline.split('\n').slice(0, 3)).toEqual([
      `KEY QUESTION (level 0): ${KQ}`,
      '[Transcription note: the root on the page reads "How can PEIP grow?", which differs from the agreed key question.]',
      '[One word is illegible.]',
    ]);
    expect(outlineFor({ reading: { ...entry.reading, rootDiffers: false, notes: [] } })).not.toContain('[');
  });
});
