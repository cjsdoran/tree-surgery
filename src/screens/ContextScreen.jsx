import { useState } from 'react';
import { limits } from '../../shared/limits.js';
import { withCode } from '../../shared/errorCodes.js';
import { buildContext, checkTotals, processFile, processPaste } from '../extract/context.js';
import { loadPdfjs } from '../extract/loadPdfjs.js';
import { countWords, formatNumber } from '../extract/text.js';

export const CONFIRM_LABEL =
  'I confirm this material may be shared with an AI tool. If it comes from a client, I have checked our NDA allows it.';

export function emptyContext() {
  return { confirmedAt: null, items: [], pasteDraft: '' };
}

const defaultProcessFile = (file) => processFile(file, { loadPdfjs });

// Step 3 (IT-11, spec §4): context is required, as in Question Time. Every refusal shows its
// error code and is recorded by time, stage and code only.
export function ContextScreen({ session, updateSession, processFileImpl = defaultProcessFile }) {
  const context = { ...emptyContext(), ...session.context };
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(null);

  const confirmed = Boolean(context.confirmedAt);
  const totalPages = context.items.reduce((n, i) => n + i.pageCount, 0);
  const pasteWords = countWords(context.pasteDraft);

  // Functional updates, so results from slow file reads never overwrite newer state.
  const updateContext = (fn, opts) =>
    updateSession((s) => ({ context: fn({ ...emptyContext(), ...s.context }) }), opts);

  const recordRefusal = (code) => {
    if (!code) return;
    updateSession((s) => ({ blockedUploads: [...(s.blockedUploads ?? []), { at: new Date().toISOString(), stage: 'context', code }] }),
      { immediate: true });
  };

  function setConfirmed(e) {
    const at = e.target.checked ? new Date().toISOString() : null;
    updateContext((c) => ({ ...c, confirmedAt: at }), { immediate: true });
  }

  // Adds a checked item unless the context as a whole would break a cap. Returns a refusal or null.
  function tryAdd(item, latestItems) {
    const refused = checkTotals([...latestItems, item]);
    if (refused) return refused;
    updateContext((c) => ({ ...c, items: [...c.items, { ...item, id: `${Date.now()}-${c.items.length}` }] }), { immediate: true });
    return null;
  }

  async function onFiles(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    const found = [];
    let items = context.items;
    for (const file of files) {
      setBusy(`Reading ${file.name}…`);
      const result = (await processFileImpl(file));
      const refused = result.ok ? tryAdd(result.item, items) : result;
      if (refused) {
        recordRefusal(refused.code);
        found.push(`${file.name}: ${withCode(refused.message, refused.code, refused.detail)}`);
        continue;
      }
      items = [...items, result.item];
    }
    setBusy(null);
    setErrors(found);
  }

  function onAddPaste() {
    const result = processPaste(context.pasteDraft);
    const refused = result.ok ? tryAdd(result.item, context.items) : result;
    if (refused) {
      recordRefusal(refused.code);
      setErrors([withCode(refused.message, refused.code)]);
      return;
    }
    updateContext((c) => ({ ...c, pasteDraft: '' }), { immediate: true });
    setErrors([]);
  }

  function remove(id) {
    updateContext((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) }), { immediate: true });
  }

  const built = buildContext(context.items);
  const ready = context.items.length > 0 && !busy;

  return (
    <section className="step-form" aria-labelledby="context-heading">
      <h2 id="context-heading">Client context</h2>
      <p>
        Upload your client brief, kick-off notes or your own notes. <strong>Context: up to {limits.contextMaxPages} pages.</strong>
      </p>
      <p>Do not upload a case PDF. Publisher terms bar case text from AI tools, and the app will block it.</p>

      <div className="field checkbox">
        <input id="context-confirm" type="checkbox" checked={confirmed} onChange={setConfirmed} />
        <label htmlFor="context-confirm">{CONFIRM_LABEL}</label>
      </div>
      {!confirmed && <p className="hint">Tick the box above to upload files or add notes.</p>}

      {errors.length > 0 && (
        <div className="error-summary" role="alert">
          <h3>{errors.length === 1 ? "We couldn't add this" : "We couldn't add these"}</h3>
          <ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <p className="status" role="status" aria-live="polite">{busy}</p>

      <div className="field">
        <label htmlFor="context-files">Upload files (PDF, .docx or .pptx)</label>
        <input id="context-files" type="file" multiple accept=".pdf,.docx,.pptx,.doc,.ppt"
          disabled={!confirmed || Boolean(busy)} onChange={onFiles} />
      </div>

      <div className="field">
        <label htmlFor="context-paste">Or paste your notes</label>
        <textarea id="context-paste" rows={6} value={context.pasteDraft} disabled={!confirmed}
          aria-describedby="context-paste-count"
          onChange={(e) => updateContext((c) => ({ ...c, pasteDraft: e.target.value }))} />
        <p className={`counter${pasteWords > limits.pasteMaxWords ? ' over' : ''}`} id="context-paste-count">
          {formatNumber(pasteWords)} / {formatNumber(limits.pasteMaxWords)} words
          {pasteWords > limits.pasteMaxWords ? ' (too long)' : ''}
        </p>
        <button type="button" className="btn secondary" disabled={!confirmed || !context.pasteDraft.trim()} onClick={onAddPaste}>
          Add these notes
        </button>
      </div>

      {context.items.length > 0 && (
        <div className="context-list">
          <h3>Your context: {totalPages} of {limits.contextMaxPages} pages</h3>
          <ul>
            {context.items.map((item, idx) => {
              const file = built.files[idx];
              return (
                <li key={item.id}>
                  <span>
                    <strong>{item.name}</strong>: {item.approx ? 'about ' : ''}{item.pageCount} {item.pageCount === 1 ? 'page' : 'pages'}
                    {' '}<span className="mono">(cited as p.{file.firstPage}{file.lastPage !== file.firstPage ? `–${file.lastPage}` : ''})</span>
                  </span>
                  <button type="button" className="btn secondary small" onClick={() => remove(item.id)}>
                    Remove {item.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {context.items.length === 0 && (
        <p className="hint" id="context-required">Add your context to continue: Daniel reads it for the client's situation.</p>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={!ready} aria-describedby={context.items.length ? undefined : 'context-required'}
          onClick={() => updateSession({ step: 'key-question' }, { immediate: true })}>
          Continue to your key question
        </button>
        <button type="button" className="btn secondary" onClick={() => updateSession({ step: 'setup' }, { immediate: true })}>
          Back to setup
        </button>
      </div>
    </section>
  );
}
