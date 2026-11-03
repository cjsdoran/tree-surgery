import { useState } from 'react';
import { buildRecord, outcome, recordFileName } from '../record/buildRecord.js';

/** Saves bytes as a file through a temporary link. */
export function saveFile(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Step 8 (IT-9, IT-10, spec §11, §13): download the record for Canvas. The run is locked:
// nothing more can be sent. Nothing is stored server-side, so this PDF is the only lasting copy.
export function RecordScreen({ session, updateSession, onNewRun, build = buildRecord, save = saveFile }) {
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [confirmNewRun, setConfirmNewRun] = useState(false);
  const fileName = recordFileName(session);

  async function download() {
    setState({ busy: true, error: null, done: null });
    try {
      const result = await build(session);
      save(result.bytes, result.fileName);
      updateSession({ recordDownloadedAt: new Date().toISOString() }, { immediate: true });
      setState({ busy: false, error: null, done: result });
    } catch {
      setState({ busy: false, error: "We couldn't make the PDF. Try again, or try another browser.", done: null });
    }
  }

  return (
    <section className="step-form" aria-labelledby="record-heading">
      <h2 id="record-heading">Your record</h2>
      <p><strong>{outcome(session)}</strong></p>
      {session.locked && <p className="notice">This run is complete and locked: nothing more can be sent to Daniel.</p>}
      <p>
        Download the record and upload it to Canvas. It holds your key questions, your trees, Daniel&rsquo;s emails and
        his reading of each tree. Nothing is kept on our servers: this PDF is the only lasting copy.
      </p>
      <p className="mono">{fileName}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={download} disabled={state.busy}>
          {state.busy ? 'Making your PDF…' : 'Download record PDF'}
        </button>
      </div>
      <p role="status" aria-live="polite" className="status">
        {state.done ? `Downloaded ${state.done.fileName} (${state.done.pageCount} pages).` : ''}
      </p>
      {state.done?.replacedCharacters > 0 && (
        <p className="field-warning"><strong>Note:</strong> some characters, such as Chinese names, can&rsquo;t be printed in the PDF and appear as &ldquo;?&rdquo;.</p>
      )}
      {state.error && <div className="error-summary" role="alert"><p><strong>Error:</strong> {state.error}</p></div>}

      <section className="panel" aria-labelledby="new-run-heading">
        <h3 id="new-run-heading">Another case?</h3>
        <p>
          You can run Tree Surgery again on another case, such as the final case. It starts a fresh run with your details
          filled in. Download this record first: a new run replaces this one in this browser.
        </p>
        {!confirmNewRun ? (
          <div className="actions">
            <button type="button" className="btn secondary" onClick={() => setConfirmNewRun(true)}>Start a new run</button>
          </div>
        ) : (
          <div role="group" aria-labelledby="confirm-new-run">
            <p id="confirm-new-run">
              <strong>Start a new run?</strong> This run, including Daniel&rsquo;s emails, is deleted from this browser. It can&rsquo;t be undone.
            </p>
            <div className="actions">
              <button type="button" className="btn" onClick={onNewRun}>Yes, start a new run</button>
              <button type="button" className="btn secondary" onClick={() => setConfirmNewRun(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
