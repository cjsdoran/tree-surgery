// Daniel's emails shown in the inbox. The app writes subjects of its own emails, greetings and
// signatures; the model writes the subject and body of its emails (spec D11). Wording of the
// app's emails lives in config/app.json.
//
// An email: { id, from, sentAt, subject, greeting, opener?, paragraphs, bullets?, numbered?, ps?, signOff }.
// `opener` is the verdict line, shown first and in bold (spec §10.5).
import { config, greeting } from '../shared/limits.js';

export const SIGNATURE = `${config.em.name} | ${config.em.title} | ${config.firm}`;

const fromDaniel = (session) => ({ from: config.em.name, greeting: greeting(session.setup?.name), signOff: config.em.signOff });

/** Daniel's briefing (IT-1, spec §2). Greets the student by first name once setup is done. */
export function briefingEmail(session) {
  const { subject, paragraphs } = config.emails.briefing;
  return { id: 'briefing', ...fromDaniel(session), sentAt: session.startedAt, subject, paragraphs };
}

/** Daniel's Stage 1 email on a Not OK key question (spec §5.3). */
export function keyQuestionEmail(session, attempt, round, number) {
  const { email } = attempt;
  return {
    id: `kq-${round}-${number}`,
    ...fromDaniel(session),
    sentAt: attempt.receivedAt,
    subject: email.subject,
    opener: email.opener,
    paragraphs: email.whatWorks ? [email.whatWorks] : [],
    bullets: email.points,
  };
}

/** The app's "agreed" email after a Stage 1 OK (TS-8, D15). */
export function keyQuestionOkEmail(session) {
  const { subject, paragraphs } = config.emails.keyQuestionOk;
  return { id: 'kq-ok', ...fromDaniel(session), sentAt: session.keyQuestion.agreed.at, subject, paragraphs };
}

/** Daniel's in-world reply when a tree page can't be read (TS-12, spec §6.5). */
export function unreadableEmail(session, u, i) {
  const e = config.emails.unreadable;
  const reason = e.reasons[u.reason] ?? e.reasons.other;
  return { id: `unreadable-${i + 1}`, ...fromDaniel(session), sentAt: u.at, subject: e.subject, paragraphs: [`${e.before} ${reason} ${e.after}`] };
}

/** Daniel's first review (IT-6) or, later, his sign-off: the model's subject and body (spec §10.5). */
export function treeReviewEmail(session, entry) {
  const { email } = entry.review;
  return {
    id: `review-${entry.round}`,
    ...fromDaniel(session),
    sentAt: entry.review.receivedAt,
    subject: email.subject,
    opener: email.opener,
    paragraphs: [email.whatWorks],
    numbered: email.questions,
    bullets: email.pointers,
    ps: email.ps,
  };
}

/** Daniel's sign-off on the revised tree (IT-8): headed sections, stated not asked (spec §8). */
export function signOffEmail(session, entry) {
  const { email } = entry.review;
  const sections = [
    ['What improved', email.improved],
    ['What still needs work', email.stillFails],
    ['Lower-level points', email.heldPoints],
  ].filter(([, items]) => items.length).map(([heading, items]) => ({ heading, items }));
  return {
    id: 'sign-off',
    ...fromDaniel(session),
    sentAt: entry.review.receivedAt,
    subject: email.subject,
    opener: email.opener,
    paragraphs: [],
    sections,
    closing: `Lesson for next time: ${email.lesson}`,
    ps: email.ps,
  };
}

/** An email as plain text, as the student read it: what the sign-off gets as the first review. */
export function emailAsText(email) {
  return [
    `Subject: ${email.subject}`,
    '',
    email.greeting,
    email.opener,
    ...email.paragraphs,
    ...(email.numbered ?? []).map((q, i) => `${i + 1}. ${q.question}${q.followUp ? ` ${q.followUp}` : ''}`),
    ...(email.bullets ?? []).map((b) => `- ${b}`),
    ...(email.ps ? [`P.S. ${email.ps}`] : []),
  ].filter((line) => line !== undefined && line !== null).join('\n');
}

/** Every email the session has received so far, oldest first. */
export function inboxEmails(session) {
  const emails = [briefingEmail(session)];
  const kq = session.keyQuestion;
  (kq?.rounds ?? []).forEach((round, r) => {
    round.attempts.forEach((attempt, a) => {
      if (attempt.verdict === 'not_ok' && attempt.email) emails.push(keyQuestionEmail(session, attempt, r + 1, a + 1));
    });
  });
  if (kq?.agreed) emails.push(keyQuestionOkEmail(session));
  (session.unreadable ?? []).forEach((u, i) => emails.push(unreadableEmail(session, u, i)));
  for (const entry of session.trees ?? []) {
    if (entry.review) emails.push(entry.round === 'revision' ? signOffEmail(session, entry) : treeReviewEmail(session, entry));
  }
  return emails.sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
}
