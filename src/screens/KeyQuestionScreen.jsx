import { useEffect, useState } from 'react';
import { config, limits } from '../../shared/limits.js';
import { withCode } from '../../shared/errorCodes.js';
import { EmailView } from '../components/EmailView.jsx';
import { ErrorSummary, FieldError } from '../components/FormErrors.jsx';
import { inboxEmails } from '../emails.js';
import { addAttempt, nextAttemptNumber, sendKeyQuestion, stage1, stage1Status, startNewRound } from '../stage1/keyQuestion.js';

export const PAUSED_MESSAGE =
  'Daniel has sent this back three times. Rework your key question, with your team if you can, and come back when you have a new one.';

export function validateKeyQuestion({ keyQuestion, subQuestions }) {
  const errors = [];
  const kq = keyQuestion.trim();
  if (!kq) errors.push({ field: 'kq-text', message: 'Enter your key question.' });
  else if (kq.length > limits.keyQuestionMaxChars) {
    errors.push({ field: 'kq-text', message: `Your key question must be ${limits.keyQuestionMaxChars} characters or fewer.` });
  }
  subQuestions.forEach((s, i) => {
    if (s.trim().length > limits.subQuestionMaxChars) {
      errors.push({ field: `kq-sub-${i}`, message: `Sub-question ${i + 1} must be ${limits.subQuestionMaxChars} characters or fewer.` });
    }
  });
  return errors;
}

export function useElapsed(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

// Step 4 (IT-3, spec §5): the key question, with optional first-level sub-questions. The tree
// upload stays locked until Daniel says it is OK.
export function KeyQuestionScreen({ session, updateSession, call }) {
  const kq = stage1(session);
  const status = stage1Status(kq);
  const draft = kq.draft;
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const elapsed = useElapsed(busy);

  const errors = validateKeyQuestion(draft);
  const shown = submitted ? errors : [];
  const errorFor = (field) => shown.find((e) => e.field === field)?.message;
  const attemptNo = nextAttemptNumber(kq);
  const lastAttempt = kq.rounds.at(-1)?.attempts.at(-1);
  const emails = inboxEmails(session);
  const lastEmail = lastAttempt?.verdict === 'not_ok' ? emails.filter((e) => e.id.startsWith('kq-') && e.id !== 'kq-ok').at(-1) : null;

  const updateKq = (fn, opts) => updateSession((s) => ({ keyQuestion: fn(stage1(s)) }), opts);
  const setDraft = (next) => updateKq((k) => ({ ...k, draft: { ...k.draft, ...next } }));
  const setSub = (i) => (e) => setDraft({ subQuestions: draft.subQuestions.map((s, j) => (j === i ? e.target.value : s)) });

  async function send(e) {
    e?.preventDefault();
    setSubmitted(true);
    setFailure(null);
    if (errors.length || busy) return;
    setBusy(true);
    const r = await sendKeyQuestion(session, draft, { call });
    setBusy(false);
    if (!r.ok) {
      setFailure(r);
      return;
    }
    setSubmitted(false);
    updateSession((s) => {
      const next = addAttempt(stage1(s), r.attempt);
      return { keyQuestion: next, ...(next.agreed ? { step: 'tree' } : {}) };
    }, { immediate: true });
  }

  if (status === 'agreed') {
    return (
      <section className="step-form" aria-labelledby="kq-heading">
        <h2 id="kq-heading">Key question</h2>
        <EmailView email={emails.find((e) => e.id === 'kq-ok')} headingLevel={3} />
        <div className="actions">
          <button type="button" className="btn" onClick={() => updateSession({ step: 'tree' }, { immediate: true })}>
            Continue to your tree
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="step-form" aria-labelledby="kq-heading">
      <h2 id="kq-heading">Key question</h2>
      {lastEmail && (
        <div className="reply">
          <EmailView email={lastEmail} headingLevel={3} />
        </div>
      )}

      {status === 'paused' ? (
        <div className="notice" role="status">
          <p>{PAUSED_MESSAGE}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => updateKq((k) => startNewRound(k), { immediate: true })}>
              I have a new key question
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={send} noValidate aria-describedby="kq-attempt">
          <p>
            Send Daniel the key question your tree will be built on. Add first-level sub-questions only if one of them
            carries your number and date.
          </p>
          <p className="mono" id="kq-attempt">Attempt {attemptNo} of {config.keyQuestionMaxAttempts}</p>
          <ErrorSummary errors={shown} />

          <div className="field">
            <label htmlFor="kq-text">Your key question</label>
            <textarea id="kq-text" rows={3} value={draft.keyQuestion} disabled={busy}
              onChange={(e) => setDraft({ keyQuestion: e.target.value })}
              aria-invalid={errorFor('kq-text') ? 'true' : undefined}
              aria-describedby={`kq-text-count${errorFor('kq-text') ? ' kq-text-error' : ''}`} />
            <Counter id="kq-text-count" value={draft.keyQuestion} max={limits.keyQuestionMaxChars} />
            <FieldError id="kq-text-error" message={errorFor('kq-text')} />
          </div>

          <fieldset className="field sub-questions">
            <legend>First-level sub-questions (optional, up to {limits.subQuestionsMax})</legend>
            {draft.subQuestions.map((s, i) => (
              <div className="sub-row" key={i}>
                <div className="field">
                  <label htmlFor={`kq-sub-${i}`}>Sub-question {i + 1}</label>
                  <input id={`kq-sub-${i}`} type="text" autoComplete="off" value={s} disabled={busy} onChange={setSub(i)}
                    aria-invalid={errorFor(`kq-sub-${i}`) ? 'true' : undefined}
                    aria-describedby={`kq-sub-${i}-count${errorFor(`kq-sub-${i}`) ? ` kq-sub-${i}-error` : ''}`} />
                  <Counter id={`kq-sub-${i}-count`} value={s} max={limits.subQuestionMaxChars} />
                  <FieldError id={`kq-sub-${i}-error`} message={errorFor(`kq-sub-${i}`)} />
                </div>
                {draft.subQuestions.length > 1 && (
                  <button type="button" className="btn secondary small" disabled={busy}
                    onClick={() => setDraft({ subQuestions: draft.subQuestions.filter((_, j) => j !== i) })}>
                    Remove sub-question {i + 1}
                  </button>
                )}
              </div>
            ))}
            {draft.subQuestions.length < limits.subQuestionsMax && (
              <button type="button" className="btn secondary" disabled={busy}
                onClick={() => setDraft({ subQuestions: [...draft.subQuestions, ''] })}>
                Add a sub-question
              </button>
            )}
          </fieldset>

          {failure && (
            <div className="error-summary" role="alert">
              <p><strong>Error:</strong> {withCode(failure.message, failure.code)}</p>
            </div>
          )}
          <p className="status" role="status" aria-live="polite">
            {busy ? `Daniel is reading your key question… ${elapsed} s` : ''}
          </p>
          <div className="actions">
            <button type="submit" className="btn" disabled={busy}>
              {failure && !failure.final ? 'Ask Daniel again' : 'Send to Daniel'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Counter({ id, value, max }) {
  const length = value.trim().length;
  const over = length > max;
  return (
    <p className={`counter${over ? ' over' : ''}`} id={id}>
      {length} / {max} characters{over ? ' (too long)' : ''}
    </p>
  );
}
