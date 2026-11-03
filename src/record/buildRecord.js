// The record PDF (IT-10, spec §11), built in the browser: the run's details, every key question
// attempt with Daniel's Stage 1 emails, each tree page with Daniel's review or sign-off, and an
// appendix with Daniel's reading of each tree. Never prompt text, internal findings (the browser
// never has them), the context text or the slide shapes text.
import { config, footerText } from '../../shared/limits.js';
import { buildContext } from '../extract/context.js';
import { CONFIRM_LABEL } from '../copy.js';
import { SIGNATURE, inboxEmails, signOffEmail, treeReviewEmail } from '../emails.js';
import { outlineFor } from '../tree/readTree.js';
import { formatTime } from '../time.js';
import { Layout } from './layout.js';

export const APP_VERSION = config.appVersion;

const VERDICTS = {
  first_cut: 'First cut', rework: 'Rework', pass: 'Pass', signed_off: 'Signed off', not_there_yet: 'Not there yet',
};

/** `<COURSE>_TreeSurgery_<Name>_<AttemptID>.pdf`, spaces removed, other characters outside A–Z, 0–9, _ and - stripped. */
export function recordFileName(session) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '');
  return `${clean(session.setup?.course)}_TreeSurgery_${clean(session.setup?.name)}_${clean(session.attemptId)}.pdf`;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const unique = (values) => [...new Set(values.filter(Boolean))];
const tree = (session, round) => (session.trees ?? []).find((t) => t.round === round);

/** One line on how the run went, eg "Key question agreed (round 1, attempt 2) · First review: Rework · Sign-off: Signed off". */
export function outcome(session) {
  const kq = session.keyQuestion ?? { rounds: [] };
  const parts = [];
  if (kq.agreed) {
    const r = kq.rounds.length;
    parts.push(`Key question agreed (round ${r}, attempt ${kq.rounds.at(-1)?.attempts.length ?? 1})`);
  } else {
    parts.push(`Key question not yet agreed (${plural(kq.rounds.reduce((n, x) => n + x.attempts.length, 0), 'attempt')})`);
  }
  const first = tree(session, 'first');
  if (first?.review) parts.push(`First review: ${VERDICTS[first.review.verdict]}`);
  const revision = tree(session, 'revision');
  if (revision?.review) parts.push(`Sign-off: ${VERDICTS[revision.review.verdict]}`);
  return parts.join(' · ');
}

function writeDetails(L, session) {
  const s = session.setup;
  const files = buildContext(session.context?.items ?? []).files;
  const blocks = session.blockedUploads ?? [];
  const unreadable = session.unreadable ?? [];
  const attempts = (session.keyQuestion?.rounds ?? []).flatMap((r) => r.attempts);
  const trees = session.trees ?? [];

  L.field('Tool', `${config.appName}, ${config.firm} practice tool`);
  L.field('Course', s.course);
  L.field('Client or project', s.client);
  L.field('Student', `${s.name} (${s.studentId})`);
  L.field('Attempt ID', session.attemptId);
  L.field('Started', formatTime(session.startedAt));
  L.field('Finished', formatTime(session.endedAt) || 'Not finished');
  L.field('Outcome', outcome(session));
  L.field('Context files', files.length ? files.map((f) => `${f.name} (${plural(f.pageCount, 'page')})`).join('; ') : 'None');
  L.field('Upload confirmation', session.context?.confirmedAt
    ? `Confirmed ${formatTime(session.context.confirmedAt)}: "${CONFIRM_LABEL}"`
    : 'Not given');
  L.field('Blocked uploads', blocks.length
    ? `${blocks.length}: ${blocks.map((b) => `${formatTime(b.at)} (${[b.stage, b.code].filter(Boolean).join(', ')})`).join('; ')}`
    : '0');
  L.field('Pages Daniel could not read', unreadable.length
    ? `${unreadable.length}: ${unreadable.map((u) => `${formatTime(u.at)} (${u.round}, ${u.fileName} p.${u.page}, ${u.reason})`).join('; ')}`
    : '0');
  L.field('App version', APP_VERSION);
  L.field('Prompt versions', unique([...attempts.map((a) => a.promptVersion), ...trees.flatMap((t) => [t.readPromptVersion, t.review?.promptVersion])]).join(' · ') || 'None');
  L.field('Models', unique([...attempts.map((a) => a.model), ...trees.flatMap((t) => [t.readModel, t.review?.model])]).join(', ') || 'None');
}

/** Draws one of Daniel's emails as the student saw it (spec §10.5). */
export function writeEmail(L, email) {
  L.heading(email.subject, 3);
  L.text(`From ${email.from} · ${formatTime(email.sentAt)}`, { color: L.colors.grey, size: 9 });
  if (email.greeting) L.text(email.greeting);
  if (email.opener) L.text(email.opener, { font: L.fonts.bold, color: L.colors.navy });
  for (const p of email.paragraphs) L.text(p);
  for (const b of email.bullets ?? []) L.rich([{ text: b }], { bullet: '•', gap: 2 });
  (email.numbered ?? []).forEach((q, i) => {
    L.rich([{ text: `${q.question}${q.followUp ? ` ${q.followUp}` : ''}` }], { bullet: `${i + 1}.`, gap: 2 });
  });
  for (const section of email.sections ?? []) {
    L.text(section.heading, { font: L.fonts.bold, gap: 2 });
    for (const item of section.items) L.rich([{ text: item }], { bullet: '•', gap: 2 });
  }
  if (email.closing) L.text(email.closing);
  if (email.ps) L.text(`P.S. ${email.ps}`);
  L.ensure(30);
  L.text(email.signOff, { gap: 1 });
  L.text(SIGNATURE, { color: L.colors.grey, gap: 8 });
}

function writeKeyQuestion(L, session) {
  const kq = session.keyQuestion ?? { rounds: [] };
  const emails = inboxEmails(session);
  L.heading('Key question', 2);
  kq.rounds.forEach((round, r) => {
    round.attempts.forEach((attempt, a) => {
      L.heading(`Round ${r + 1}, attempt ${a + 1} · sent ${formatTime(attempt.sentAt)}`, 3);
      L.field('Key question', attempt.keyQuestion);
      attempt.subQuestions.forEach((sq, i) => L.field(`Sub-question ${i + 1}`, sq));
      L.space(4);
      const email = emails.find((e) => e.id === `kq-${r + 1}-${a + 1}`);
      if (email) writeEmail(L, email);
    });
  });
  if (kq.agreed) writeEmail(L, emails.find((e) => e.id === 'kq-ok'));
  else L.text('The key question was not agreed in this run.', { color: L.colors.grey });
}

async function writeTree(L, doc, session, entry, title) {
  L.newPage();
  L.heading(title, 2);
  const unit = entry.kind === 'pptx' ? 'slide' : 'page';
  L.field('File', `${entry.fileName}, ${unit} ${entry.page} of ${entry.pageCount}`);
  L.field('Sent', formatTime(entry.sentAt ?? entry.readAt));
  L.space(4);
  const image = entry.recordImage;
  if (image?.base64) {
    const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
    const embedded = image.mediaType === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    L.image(embedded);
  } else {
    // A .pptx slide has no picture in the record (assumption 5): the reading stands in for it.
    L.text(`PowerPoint ${unit}: see Daniel's reading of this tree in the appendix.`, { color: L.colors.grey });
  }
  if (entry.review) {
    L.space(6);
    writeEmail(L, entry.round === 'revision' ? signOffEmail(session, entry) : treeReviewEmail(session, entry));
  }
}

function writeAppendix(L, session) {
  const trees = (session.trees ?? []).filter((t) => t.reading?.nodes?.length);
  if (!trees.length) return;
  L.newPage();
  L.heading("Appendix: Daniel's reading of each tree", 2);
  L.text('The outline Daniel reviewed, as read from the page or slide. Text in [square brackets] is a transcription note.', { color: L.colors.grey, size: 9 });
  for (const entry of trees) {
    L.heading(entry.round === 'first' ? 'First tree' : 'Revised tree', 3);
    for (const line of outlineFor(entry).split('\n')) {
      if (!line.trim()) {
        L.space(4);
        continue;
      }
      const indent = line.length - line.trimStart().length;
      L.text(line.trim(), { indent: indent * 3.5, gap: 1, size: 9 });
    }
  }
}

/**
 * @param {object} session a finished run
 * @param {object} [lib] the pdf-lib module (loaded on first use in the browser)
 * @returns {Promise<{ bytes: Uint8Array, fileName: string, pageCount: number, replacedCharacters: number }>}
 */
export async function buildRecord(session, lib) {
  const pdfLib = lib ?? (await import('pdf-lib'));
  const { PDFDocument, StandardFonts } = pdfLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Tree Surgery record: ${session.setup.name}, ${session.setup.client}`);
  doc.setAuthor(session.setup.name);
  doc.setSubject(`${session.setup.course} Tree Surgery record, attempt ${session.attemptId}`);
  doc.setCreator(`${config.appName} ${APP_VERSION}`);
  doc.setProducer(`${config.appName} ${APP_VERSION}`);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const L = new Layout(pdfLib, doc, fonts, {
    runningHeader: `${config.firm} · ${config.appName} · ${session.setup.client} · ${session.setup.name}`,
    footer: footerText(session.setup.course),
  });

  L.heading('Tree Surgery record', 1);
  writeDetails(L, session);
  L.newPage();
  writeKeyQuestion(L, session);
  for (const [round, title] of [['first', 'Your issue tree'], ['revision', 'Your revised tree']]) {
    const entry = tree(session, round);
    if (entry) await writeTree(L, doc, session, entry, title);
  }
  writeAppendix(L, session);

  L.finish();
  if (L.replaced.size > 0) {
    const list = [...L.replaced].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
    const last = doc.getPages().at(-1);
    last.drawText(L.clean(`Note: ${L.replaced.size} character${L.replaced.size === 1 ? '' : 's'} outside Western European scripts (eg Chinese names) print as "?" in this PDF: ${list}.`).slice(0, 160), {
      x: 56, y: 60, size: 7, font: fonts.regular, color: L.colors.grey,
    });
  }
  const bytes = await doc.save();
  return { bytes, fileName: recordFileName(session), pageCount: doc.getPageCount(), replacedCharacters: L.replaced.size };
}

