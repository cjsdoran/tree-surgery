import { useState } from 'react';
import { formatTime } from '../time.js';

// In-page choice, not a browser dialog (spec §9). Start again asks for confirmation.
export function ResumePrompt({ saved, onResume, onStartAgain }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="panel" aria-labelledby="resume-heading">
      <h2 id="resume-heading">Resume where you left off?</h2>
      <p>
        This browser has a saved attempt <span className="mono">{saved.attemptId}</span>, last saved{' '}
        <span className="mono">{formatTime(saved.updatedAt)}</span>.
      </p>
      {!confirming ? (
        <div className="actions">
          <button type="button" className="btn" onClick={onResume}>
            Resume where you left off
          </button>
          <button type="button" className="btn secondary" onClick={() => setConfirming(true)}>
            Start again
          </button>
        </div>
      ) : (
        <div role="group" aria-labelledby="confirm-start-again">
          <p id="confirm-start-again">
            <strong>Start again?</strong> This deletes the saved attempt from this browser. It can&rsquo;t be undone.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={onStartAgain}>
              Yes, start again
            </button>
            <button type="button" className="btn secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
