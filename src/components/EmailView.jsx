import { SIGNATURE } from '../emails.js';
import { formatTime } from '../time.js';

// One email from Daniel: subject, sender and time, greeting, body, sign-off and signature.
// Later stages add their structured bodies (verdict opener, questions, pointers; spec §10.5).
export function EmailView({ email }) {
  return (
    <article className="email" aria-labelledby={`email-${email.id}`}>
      <h2 id={`email-${email.id}`}>{email.subject}</h2>
      <p className="meta">
        From {email.from} · <span className="mono">{formatTime(email.sentAt)}</span>
      </p>
      {email.greeting && <p>{email.greeting}</p>}
      {email.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p>{email.signOff}</p>
      <p className="signature">{SIGNATURE}</p>
    </article>
  );
}
