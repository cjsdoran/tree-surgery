import { useEffect, useRef, useState } from 'react';
import { limits } from '../../shared/limits.js';
import { withCode } from '../../shared/errorCodes.js';
import { EmailView } from '../components/EmailView.jsx';
import { inboxEmails } from '../emails.js';
import { loadPdfjs } from '../extract/loadPdfjs.js';
import { closeTree, openTreeFile, prepareTreePage } from '../tree/treeUpload.js';
import { readTree } from '../tree/readTree.js';
import { afterReview, reviewTree } from '../tree/reviewTree.js';
import { useElapsed } from './KeyQuestionScreen.jsx';

/* global __TREE_TEMPLATE__ */
export const TEMPLATE_URL = typeof __TREE_TEMPLATE__ === 'undefined' ? null : __TREE_TEMPLATE__;

// The browser's file reading and canvas, loaded on first use; tests pass their own.
const defaultDeps = {
  openFile: (file) => openTreeFile(file, { loadPdfjs }),
  prepare: async (handle, n) => prepareTreePage(handle, n, (await import('../tree/browserCanvas.js')).browserDeps),
  thumbnails: async (handle) => (await import('../tree/browserCanvas.js')).pdfThumbnails(handle),
};

// What follows a reading: for the first tree, Daniel's review (IT-6, spec §7). Each returns the
// session changes to make, or a failure. The revision's sign-off is added in milestone 6.
export const RESPONSES = {
  first: {
    waiting: 'Daniel is reviewing your tree…',
    async run(session, entry, call) {
      const r = await reviewTree(session, entry, { call });
      return r.ok ? { ok: true, patch: (s) => afterReview(s, r.review) } : r;
    },
  },
};

// Step 5 (IT-2, IT-4, IT-5, spec §6), and step 7 for the revision (IT-7): upload one PDF or .pptx,
// pick the page with the tree, Daniel reads it, then replies. No correction step. An unreadable
// page gets Daniel's email and a fresh upload; it doesn't use up the revision.
export function TreeScreen({ session, updateSession, round = 'first', deps = {} }) {
  const { openFile, prepare, thumbnails, call } = { ...defaultDeps, ...deps };
  const response = RESPONSES[round];
  const [handle, setHandle] = useState(null);
  const [thumbs, setThumbs] = useState([]);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const handleRef = useRef(null);
  const elapsed = useElapsed(busy === 'reading' || busy === 'responding');

  useEffect(() => () => { closeTree(handleRef.current); }, []);

  const stage = round === 'first' ? 'tree' : 'revision';
  const agreed = session.keyQuestion?.agreed;
  const entry = (session.trees ?? []).find((t) => t.round === round);
  const unreadable = (session.unreadable ?? []).map((u, i) => ({ ...u, i })).filter((u) => u.round === round);
  const lastUnreadable = unreadable.at(-1);
  const unreadableEmail = lastUnreadable && !handle && inboxEmails(session).find((e) => e.id === `unreadable-${lastUnreadable.i + 1}`);

  const recordRefusal = (code) => updateSession((s) => ({
    blockedUploads: [...(s.blockedUploads ?? []), { at: new Date().toISOString(), stage, code }],
  }), { immediate: true });

  function reset(next = null) {
    closeTree(handleRef.current);
    handleRef.current = next;
    setHandle(next);
    setThumbs([]);
    setPage(next?.pageCount === 1 ? 1 : null);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    reset();
    setBusy('opening');
    const r = await openFile(file);
    setBusy(null);
    if (!r.ok) {
      recordRefusal(r.code);
      setError(withCode(r.message, r.code, r.detail));
      return;
    }
    reset(r.handle);
    if (r.handle.kind === 'pdf' && r.handle.pageCount > 1) {
      thumbnails(r.handle).then(setThumbs).catch(() => setThumbs([]));
    }
  }

  async function send() {
    if (!handle || !page || busy) return;
    setError(null);
    setBusy('preparing');
    let prepared;
    try {
      prepared = await prepare(handle, page);
    } catch (err) {
      prepared = { ok: false, code: 'TS-U07', message: `We couldn't read page ${page}. Export it to PDF again and upload it.`, detail: err?.name };
    }
    if (!prepared.ok) {
      setBusy(null);
      recordRefusal(prepared.code);
      setError(withCode(prepared.message, prepared.code, prepared.detail));
      return;
    }
    setBusy('reading');
    const upload = { ...prepared, fileName: handle.name, kind: handle.kind, pageCount: handle.pageCount };
    const r = await readTree(session, round, upload, { call });
    setBusy(null);
    if (!r.ok) {
      setError(withCode(r.message, r.code));
      return;
    }
    if (!r.readable) {
      updateSession((s) => ({ unreadable: [...(s.unreadable ?? []), r.unreadable] }), { immediate: true });
      reset();
      return;
    }
    updateSession((s) => ({ trees: [...(s.trees ?? []).filter((t) => t.round !== round), r.entry] }), { immediate: true });
    reset();
    await respond({ ...session, trees: [...(session.trees ?? []).filter((t) => t.round !== round), r.entry] }, r.entry);
  }

  // Daniel's reply to a tree he has read. A failure leaves the reading in place, so asking again
  // reruns only the reply.
  async function respond(latest, readEntry) {
    if (!response) return;
    setError(null);
    setBusy('responding');
    const r = await response.run(latest, readEntry, call);
    setBusy(null);
    if (!r.ok) {
      setError(withCode(r.message, r.code));
      return;
    }
    updateSession(r.patch, { immediate: true });
  }

  if (entry) {
    return (
      <section className="step-form" aria-labelledby="tree-heading">
        <h2 id="tree-heading">{round === 'first' ? 'Your issue tree' : 'Your revised tree'}</h2>
        <p className="notice">Daniel has your tree: {entry.fileName}, {entry.kind === 'pptx' ? 'slide' : 'page'} {entry.page}.</p>
        {error && <div className="error-summary" role="alert"><p><strong>Error:</strong> {error}</p></div>}
        <p className="status" role="status" aria-live="polite">{busy === 'responding' ? `${response.waiting} ${elapsed} s` : ''}</p>
        {response && !busy && (
          <div className="actions">
            <button type="button" className="btn" onClick={() => respond(session, entry)}>Ask Daniel again</button>
          </div>
        )}
      </section>
    );
  }

  const unit = handle?.kind === 'pptx' ? 'slide' : 'page';
  return (
    <section className="step-form" aria-labelledby="tree-heading">
      <h2 id="tree-heading">{round === 'first' ? 'Your issue tree' : 'Your revised tree'}</h2>
      {agreed && (
        <p>Agreed key question: <strong>{agreed.keyQuestion}</strong></p>
      )}
      {round === 'revision' && <p>Revise your tree and upload it once more. Daniel will sign it off.</p>}
      {TEMPLATE_URL && (
        <p><a href={TEMPLATE_URL} download>Download the template (PowerPoint)</a></p>
      )}

      {unreadableEmail && (
        <div className="reply"><EmailView email={unreadableEmail} headingLevel={3} /></div>
      )}

      <div className="panel upload-panel">
        <p>
          Upload your tree as one PDF or PowerPoint (.pptx) file. <strong>Up to {limits.treeMaxPages} pages or slides, {limits.treeMaxMB} MB.</strong>
          {' '}If it has several pages, you&rsquo;ll pick the one with the tree.
        </p>
        <p>
          Use one page for the whole tree, with the agreed key question at the root. Daniel reads the tree as it stands:
          there is no chance to correct his reading, so keep the text in boxes and the lines clear.
        </p>
        <div className="field">
          <label htmlFor="tree-file">Upload your tree (PDF or .pptx)</label>
          <input id="tree-file" type="file" accept=".pdf,.pptx,.ppt" disabled={Boolean(busy)} onChange={onFile} />
        </div>
      </div>

      {error && (
        <div className="error-summary" role="alert"><p><strong>Error:</strong> {error}</p></div>
      )}

      {handle && handle.pageCount > 1 && (
        <fieldset className="field page-picker">
          <legend>Which {unit} has your tree?</legend>
          <div className="pages">
            {handle.pages.map((p, i) => (
              <label key={p.n} className={`page-choice${page === p.n ? ' chosen' : ''}`}>
                <input type="radio" name="tree-page" value={p.n} checked={page === p.n} disabled={Boolean(busy)}
                  onChange={() => setPage(p.n)} />
                <span className="page-label">{unit === 'slide' ? 'Slide' : 'Page'} {p.n}</span>
                {thumbs[i] && <img src={thumbs[i]} alt="" />}
                {p.label && <span className="hint">{p.label}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {handle && (
        <p className="hint">{handle.name}: {handle.pageCount} {handle.pageCount === 1 ? unit : `${unit}s`}{page ? `. Sending ${unit} ${page}.` : `. Choose the ${unit} with your tree.`}</p>
      )}

      <p className="status" role="status" aria-live="polite">
        {busy === 'opening' && 'Opening your file…'}
        {busy === 'preparing' && `Preparing ${unit} ${page}…`}
        {busy === 'reading' && `Daniel is reading your tree… ${elapsed} s`}
      </p>
      <div className="actions">
        <button type="button" className="btn" disabled={!handle || !page || Boolean(busy)} onClick={send}>
          Send to Daniel
        </button>
      </div>
    </section>
  );
}
