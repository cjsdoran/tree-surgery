import { formatTime } from '../time.js';

export function Inbox({ emails, selectedId, onSelect }) {
  return (
    <aside className="inbox" aria-label="Inbox">
      <h2>Inbox</h2>
      <ul>
        {emails.map((email) => (
          <li key={email.id}>
            <button
              type="button"
              aria-current={email.id === selectedId ? 'true' : 'false'}
              onClick={() => onSelect(email.id)}
            >
              <span className="from">{email.from}</span>
              <span className="subject">{email.subject}</span>
              {email.sentAt && <span className="mono">{formatTime(email.sentAt)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
