import { SIGNATURE } from '../emails.js';
import { formatTime } from '../time.js';

// One email from Daniel (spec §10.5): subject, sender and time, greeting, the verdict opener in
// bold, body paragraphs, bullets or numbered questions, P.S., sign-off and signature.
export function EmailView({ email, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <article className="email" aria-labelledby={`email-${email.id}`}>
      <Heading id={`email-${email.id}`}>{email.subject}</Heading>
      <p className="meta">
        From {email.from} · <span className="mono">{formatTime(email.sentAt)}</span>
      </p>
      {email.greeting && <p>{email.greeting}</p>}
      {email.opener && <p className="verdict"><strong>{email.opener}</strong></p>}
      {email.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {email.bullets?.length > 0 && (
        <ul>{email.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
      )}
      {email.numbered?.length > 0 && (
        <ol>
          {email.numbered.map((q, i) => (
            <li key={i}>{q.question}{q.followUp ? ` ${q.followUp}` : ''}</li>
          ))}
        </ol>
      )}
      {email.ps && <p>P.S. {email.ps}</p>}
      <p>{email.signOff}</p>
      <p className="signature">{SIGNATURE}</p>
    </article>
  );
}
