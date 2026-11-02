import { EmailView } from '../components/EmailView.jsx';
import { treeReviewEmail } from '../emails.js';

export const PASS_NEXT = 'Your tree passes, so this run is complete. Download your record and upload it to Canvas.';
export const REVISE_NEXT = "Revise your tree using Daniel's questions, then upload it once more. He will sign it off.";

// Step 6 (IT-6, IT-7, spec §7): Daniel's first review. A Pass ends the run, which is already
// locked (IT-9); otherwise the student revises once.
export function FeedbackScreen({ session, updateSession }) {
  const entry = (session.trees ?? []).find((t) => t.round === 'first' && t.review);
  if (!entry) return null;
  const pass = entry.review.verdict === 'pass';
  return (
    <section className="step-form" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">Daniel&rsquo;s review</h2>
      <div className="reply"><EmailView email={treeReviewEmail(session, entry)} headingLevel={3} /></div>
      <p className="notice">{pass ? PASS_NEXT : REVISE_NEXT}</p>
      <div className="actions">
        <button type="button" className="btn"
          onClick={() => updateSession({ step: pass ? 'record' : 'revision' }, { immediate: true })}>
          {pass ? 'Continue to your record' : 'Upload your revised tree'}
        </button>
      </div>
    </section>
  );
}
