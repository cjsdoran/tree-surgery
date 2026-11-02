import { EmailView } from '../components/EmailView.jsx';
import { briefingEmail } from '../emails.js';

// Step 1 (IT-1): Daniel's briefing email and one button to setup.
export function BriefingScreen({ session, updateSession }) {
  return (
    <section className="step-form" aria-labelledby="email-briefing">
      <EmailView email={briefingEmail(session)} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => updateSession({ step: 'setup' }, { immediate: true })}>
          Set up →
        </button>
      </div>
    </section>
  );
}
