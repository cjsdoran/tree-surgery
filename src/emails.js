// Daniel's emails shown in the inbox. The app writes subjects of its own emails, greetings and
// signatures; the model writes the subject and body of its emails (spec D11). Wording of the
// app's emails lives in config/app.json.
import { config, greeting } from '../shared/limits.js';

export const SIGNATURE = `${config.em.name} | ${config.em.title} | ${config.firm}`;

/** Daniel's briefing (IT-1, spec §2). Greets the student by first name once setup is done. */
export function briefingEmail(session) {
  const { subject, paragraphs } = config.emails.briefing;
  return {
    id: 'briefing',
    from: config.em.name,
    sentAt: session.startedAt,
    subject,
    greeting: greeting(session.setup?.name),
    paragraphs,
    signOff: config.em.signOff,
  };
}

/** Every email the session has received so far, oldest first. Later stages add theirs. */
export function inboxEmails(session) {
  return [briefingEmail(session)];
}
