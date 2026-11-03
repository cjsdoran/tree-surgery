// T-E2E-1 and T-A11Y-1: one student's whole run in Chromium, briefing to record PDF, with every
// /api call answered by mocks in the functions' NDJSON format, so no model is called. It covers a
// Not OK key question, a page picker, an unreadable page, a reload mid-run (T-SAV-1), a Rework,
// the revision and sign-off, and the record download. axe-core checks each screen for WCAG A/AA.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { loadNodePdfjs, words } from '../helpers/fixtures.js';
import { notOkReply } from '../helpers/stage1.js';
import { reworkReply } from '../helpers/stage2.js';
import { signedOff } from '../helpers/signoff.js';

const KQ = 'How can PEIP achieve positive operating cash flow within the next 12 months?';
const CONFIRM = 'I confirm this material may be shared with an AI tool. If it comes from a client, I have checked our NDA allows it.';
const nodes = (labels) => [{ level: 0, text: KQ }, ...labels.map((text) => ({ level: 1, text }))];

const ndjson = (result) => `${JSON.stringify({ type: 'meta', promptVersion: 'test' })}\n${JSON.stringify({ type: 'ping' })}\n${JSON.stringify({ type: 'result', ...result, promptVersion: 'test 1.0', servedBy: 'claude-opus-5-5', durationMs: 5 })}\n`;

async function treePdf(path, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Cover page', { x: 50, y: 790, size: 20, font });
  const p = doc.addPage([842, 595]);
  p.drawText(KQ.slice(0, 40), { x: 30, y: 300, size: 10, font });
  p.drawText(`${label} A?`, { x: 420, y: 420, size: 12, font });
  p.drawText(`${label} B?`, { x: 420, y: 180, size: 12, font });
  p.drawLine({ start: { x: 260, y: 304 }, end: { x: 410, y: 424 } });
  p.drawLine({ start: { x: 260, y: 304 }, end: { x: 410, y: 184 } });
  writeFileSync(path, await doc.save());
}

async function axe(page, where) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${where}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

test('a student runs Tree Surgery from the briefing to the record PDF', async ({ page }, testInfo) => {
  const calls = [];
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  // Under `netlify serve` (E2E_BASE_URL) the real CSP applies: any violation fails the run.
  page.on('console', (msg) => { if (/Content Security Policy/i.test(msg.text())) pageErrors.push(msg.text()); });
  let kqCalls = 0;
  let reads = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ path, body, code: route.request().headers()['x-ts-access-code'] });
    if (path === '/api/check') return route.fulfill({ status: 204 });
    const reply = (result) => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson(result) });
    if (path === '/api/key-question') {
      kqCalls += 1;
      const { findings: _f, ...notOk } = notOkReply();
      return reply(kqCalls === 1 ? notOk : { verdict: 'ok', email: null });
    }
    if (path === '/api/read-tree') {
      reads += 1;
      if (reads === 1) return reply({ status: 'unreadable', reason: 'blurred', nodes: [], notes: [] });
      const labels = body.round === 'first' ? ['How to increase cash inflow?', 'How to decrease cash outflow?'] : ['How can PEIP grow cash from jam?', 'How can PEIP improve the non-jam businesses?'];
      return reply({ status: 'read', reason: null, rootAsWritten: KQ, rootDiffers: false, nodes: nodes(labels), notes: [] });
    }
    if (path === '/api/review-tree') {
      return reply(body.part === 'findings' ? { part: 'findings', token: 'SEALED' } : { part: 'email', verdict: 'rework', email: reworkReply().email });
    }
    if (path === '/api/sign-off') return reply({ verdict: 'signed_off', email: signedOff().email });
    return route.fulfill({ status: 404 });
  });

  await page.goto('/');

  // 1. Briefing
  await expect(page.getByRole('heading', { name: 'Your issue tree: key question first' })).toBeVisible();
  await axe(page, 'briefing');
  await page.getByRole('button', { name: 'Set up →' }).click();

  // 2. Setup
  await page.getByLabel('Access code').fill('e2e-code');
  await page.getByLabel('Your name').fill('Mei Chan');
  await page.getByLabel('Student ID').fill('20871234');
  await page.getByLabel('Course').selectOption('MGMT 5760');
  await page.getByLabel('Client or project name').fill('PEIP');
  await axe(page, 'setup');
  await page.getByRole('button', { name: 'Continue to context' }).click();

  // 3. Context
  await expect(page.getByRole('heading', { name: 'Client context' })).toBeVisible();
  await page.getByLabel(CONFIRM).check();
  await page.getByLabel('Or paste your notes').fill(`PEIP makes premium jam on Prince Edward Island. ${words(120)}`);
  await page.getByRole('button', { name: 'Add these notes' }).click();
  await axe(page, 'context');
  await page.getByRole('button', { name: 'Continue to your key question' }).click();

  // 4. Key question: Not OK, then OK
  await page.getByRole('textbox', { name: 'Your key question' }).fill('How can PEIP avoid going bankrupt and stabilise cashflow?');
  await page.getByRole('button', { name: 'Send to Daniel' }).click();
  await expect(page.getByText('Attempt 2 of 3')).toBeVisible();
  await expect(page.getByText(notOkReply().email.opener)).toBeVisible();
  await axe(page, 'key question, Not OK');
  await page.getByRole('textbox', { name: 'Your key question' }).fill(KQ);
  await page.getByRole('button', { name: 'Send to Daniel' }).click();

  // 5. Tree: a reload first (T-SAV-1), then an unreadable page, then a readable one
  await expect(page.getByRole('heading', { name: 'Your issue tree' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Resume where you left off' }).click();
  await expect(page.getByText(`Agreed key question: ${KQ}`)).toBeVisible();
  const first = testInfo.outputPath('tree.pdf');
  await treePdf(first, 'Branch');
  await page.getByLabel('Upload your tree (PDF or .pptx)').setInputFiles(first);
  await expect(page.getByRole('group', { name: 'Which page has your tree?' }).locator('img')).toHaveCount(2);
  await axe(page, 'tree, page picker');
  await page.getByLabel(/Page 2/).check();
  await page.getByRole('button', { name: 'Send to Daniel' }).click();
  await expect(page.getByText("I can't read the tree you sent. The page is too blurred to read the boxes.", { exact: false })).toBeVisible();
  await page.getByLabel('Upload your tree (PDF or .pptx)').setInputFiles(first);
  await page.getByLabel(/Page 2/).check();
  await page.getByRole('button', { name: 'Send to Daniel' }).click();

  // 6. Feedback: Rework
  await expect(page.getByRole('heading', { name: 'Daniel’s review' })).toBeVisible();
  await expect(page.getByText(reworkReply().email.opener)).toBeVisible();
  await axe(page, 'feedback');
  await page.getByRole('button', { name: 'Upload your revised tree' }).click();

  // 7. Revision and sign-off
  const revised = testInfo.outputPath('revised.pdf');
  await treePdf(revised, 'Unit');
  await page.getByLabel('Upload your tree (PDF or .pptx)').setInputFiles(revised);
  await page.getByLabel(/Page 2/).check();
  await page.getByRole('button', { name: 'Send to Daniel' }).click();
  await expect(page.getByRole('heading', { name: 'Daniel’s sign-off' })).toBeVisible();
  await expect(page.getByText(signedOff().email.opener)).toBeVisible();
  await axe(page, 'sign-off');
  await page.getByRole('button', { name: 'Continue to your record' }).click();

  // 8. Record
  await expect(page.getByText('This run is complete and locked: nothing more can be sent to Daniel.')).toBeVisible();
  await axe(page, 'record');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download record PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^MGMT5760_TreeSurgery_MeiChan_[A-Z2-7]{8}\.pdf$/);
  const saved = testInfo.outputPath('record.pdf');
  await download.saveAs(saved);

  // The record opens, has the tree image and Daniel's emails, and no findings or prompt text.
  const pdfjs = await loadNodePdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(saved)), verbosity: 0 }).promise;
  let text = '';
  let images = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const pageObj = await doc.getPage(i);
    text += (await pageObj.getTextContent()).items.map((it) => it.str).join(' ');
    images += (await pageObj.getOperatorList()).fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
  }
  for (const s of ['Tree Surgery record', 'Round 1, attempt 2', reworkReply().email.opener, signedOff().email.opener, "Appendix: Daniel's reading of each tree", 'How can PEIP grow cash from jam?']) {
    expect(text.replace(/\s+/g, ' ')).toContain(s);
  }
  expect(images).toBe(2);
  expect(text).not.toContain('FINDING');

  // Every call carried the access code; the review's email call sent back the sealed findings.
  expect(calls.every((c) => c.code === 'e2e-code')).toBe(true);
  expect(calls.map((c) => c.path)).toEqual([
    '/api/check', '/api/key-question', '/api/key-question', '/api/read-tree', '/api/read-tree',
    '/api/review-tree', '/api/review-tree', '/api/read-tree', '/api/sign-off',
  ]);
  expect(calls.find((c) => c.body.part === 'email').body.token).toBe('SEALED');
  expect(pageErrors).toEqual([]);
});

test('the app works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your issue tree: key question first' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await axe(page, 'phone briefing');
});
