import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header.jsx';
import { Footer } from './components/Footer.jsx';
import { StepBar } from './components/StepBar.jsx';
import { Inbox } from './components/Inbox.jsx';
import { EmailView } from './components/EmailView.jsx';
import { ResumePrompt } from './components/ResumePrompt.jsx';
import { StorageWarning } from './components/StorageWarning.jsx';
import { BriefingScreen } from './screens/BriefingScreen.jsx';
import { NotYetScreen } from './screens/NotYetScreen.jsx';
import { inboxEmails } from './emails.js';
import { STEPS } from './steps.js';
import { clearSaved, createAutosaver, createSession, defaultStorage, loadSaved, newRunFrom, saveSession } from './store/session.js';

export const TASK_ID = 'task';

export const OUTDATED_NOTICE =
  "Tree Surgery has been updated since your last visit, so your earlier attempt in this browser can't be resumed. Start again.";

function initialState(storage) {
  const { session, ok, outdated } = loadSaved(storage);
  if (session) return { phase: 'resume', saved: session, session: null, storageOk: ok };
  // A session from another version is deleted, with a notice; a fresh run starts.
  if (outdated) clearSaved(storage);
  const fresh = createSession();
  return { phase: 'active', saved: null, session: fresh, storageOk: saveSession(fresh, storage), outdated: Boolean(outdated) };
}

export default function App({ storage = defaultStorage(), screens = {} }) {
  const [state, setState] = useState(() => initialState(storage));
  const [selected, setSelected] = useState(TASK_ID);

  const autosaver = useRef(null);
  if (!autosaver.current) {
    autosaver.current = createAutosaver({
      storage,
      onResult: (ok) => setState((s) => (s.storageOk === ok ? s : { ...s, storageOk: ok })),
    });
  }
  useEffect(() => () => autosaver.current.cancel(), []);

  // Screens call this. `patch` is an object or a function of the latest session.
  // Edits save after a 1 s pause; step changes and uploads save at once.
  const updateSession = useCallback((patch, { immediate = false } = {}) => {
    setState((s) => {
      const changes = typeof patch === 'function' ? patch(s.session) : patch;
      const session = { ...s.session, ...changes, updatedAt: new Date().toISOString() };
      if (immediate) autosaver.current.flush(session);
      else autosaver.current.schedule(session);
      return { ...s, session };
    });
    if (patch?.step) setSelected(TASK_ID);
  }, []);

  const resume = () => setState((s) => ({ ...s, phase: 'active', session: s.saved, saved: null }));

  const replaceSession = (fresh) => {
    autosaver.current.cancel();
    clearSaved(storage);
    const ok = saveSession(fresh, storage);
    setSelected(TASK_ID);
    setState({ phase: 'active', saved: null, session: fresh, storageOk: ok });
  };
  const startAgain = () => replaceSession(createSession());
  const newRun = () => replaceSession(newRunFrom(state.session));

  const { phase, session, saved, storageOk, outdated } = state;
  const emails = useMemo(() => (session ? inboxEmails(session) : []), [session]);
  const stepLabel = STEPS.find((s) => s.id === session?.step)?.label;
  const inboxItems = session
    ? [{ id: TASK_ID, from: 'Your task', subject: `Step: ${stepLabel}`, sentAt: null }, ...emails]
    : [];
  const email = emails.find((e) => e.id === selected);

  return (
    <div className="app">
      <Header session={session} />
      {!storageOk && <StorageWarning />}
      {outdated && <p className="notice" role="status" aria-label="Update notice">{OUTDATED_NOTICE}</p>}
      {phase === 'resume' ? (
        <main className="pane">
          <ResumePrompt saved={saved} onResume={resume} onStartAgain={startAgain} />
        </main>
      ) : (
        <>
          <StepBar current={session.step} />
          <div className="workspace">
            <Inbox emails={inboxItems} selectedId={email ? email.id : TASK_ID} onSelect={setSelected} />
            <main className="pane">
              {email ? <EmailView email={email} /> : <StepScreen session={session} updateSession={updateSession} screens={screens} onNewRun={newRun} />}
            </main>
          </div>
        </>
      )}
      <Footer course={session?.setup?.course} />
    </div>
  );
}

// Each later milestone replaces a NotYetScreen with its step's screen.
function StepScreen({ session, updateSession }) {
  const props = { session, updateSession };
  switch (session.step) {
    case 'briefing':
      return <BriefingScreen {...props} />;
    default:
      return <NotYetScreen step={session.step} />;
  }
}
