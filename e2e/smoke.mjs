// End-to-end smoke test of the built Electron app: open → inspect → edit → save → verify on disk.
// Run with `npm run e2e` (builds first). Screenshots land in e2e/screenshots/.
// To test a packaged build instead: OOXML_E2E_EXECUTABLE="release/mac-arm64/OOXML Toolkit.app/Contents/MacOS/OOXML Toolkit" node e2e/smoke.mjs
import { _electron as electron } from 'playwright';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import assert from 'node:assert/strict';

setTimeout(() => {
  console.error('\nTimed out after 90s');
  process.exit(1);
}, 90_000).unref();

const root = resolve(import.meta.dirname, '..');
const shots = join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });

if (!existsSync(join(root, 'samples', 'sample.docx')))
  throw new Error('Run `npm run samples` first.');
const work = mkdtempSync(join(tmpdir(), 'ooxml-e2e-'));
const docPath = join(work, 'work.docx');
const sheetPath = join(work, 'book.xlsx');
copyFileSync(join(root, 'samples', 'sample.docx'), docPath);
copyFileSync(join(root, 'samples', 'sample.xlsx'), sheetPath);
const original = unzipSync(new Uint8Array(readFileSync(docPath)));

const executable = process.env.OOXML_E2E_EXECUTABLE
  ? resolve(root, process.env.OOXML_E2E_EXECUTABLE)
  : undefined;
const app = await electron.launch({
  executablePath: executable,
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${join(work, 'profile')}`,
    docPath,
    sheetPath,
  ],
  env: { ...process.env, OOXML_E2E: '1', ELECTRON_ENABLE_LOGGING: '0' },
});
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log('ok');
};

await step('window opens the files passed on the command line', async () => {
  await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, undefined, {
    timeout: 15000,
  });
  assert.equal(await page.evaluate(() => window.host?.kind), 'electron');
  await page.locator('.tab', { hasText: 'work.docx' }).click();
  assert.match(await page.textContent('.tab.active'), /work\.docx/);
  await page.screenshot({ path: join(shots, '01-overview.png') });
});

await step('search results never leak from one document into another', async () => {
  await page.locator('.activity-btn[aria-label="Search"]').click();
  await page.getByLabel('Search query').fill('Hello');
  await page.waitForSelector('.result-hit');
  assert.match(await page.textContent('.results'), /document\.xml/);
  await page.locator('.tab', { hasText: 'book.xlsx' }).click();
  // Immediately after the switch (before any debounced re-search) nothing from the Word file may be offered:
  // clicking such a hit would try to open word/document.xml in the spreadsheet.
  assert.equal(await page.locator('.result-hit').count(), 0, 'stale hits are still shown');
  assert.doesNotMatch(await page.textContent('.main'), /no longer exists/);
  // the same query is then re-run against the spreadsheet, which does not contain it
  await page.waitForFunction(() =>
    /0 results/.test(document.querySelector('.search-status')?.textContent ?? ''),
  );
  await page.locator('.tab', { hasText: 'work.docx' }).click();
  await page.locator('.activity-btn[aria-label="Explorer"]').click();
});

await step('tree → part → element selection shows the source', async () => {
  const row = (label, nth = 0) =>
    page
      .locator('.tree-row', {
        has: page.locator('.tree-label', { hasText: new RegExp(`^${label}$`) }),
      })
      .nth(nth);
  await row('document.xml').click();
  await page.waitForSelector('.cm-content');
  assert.match(await page.textContent('.cm-content'), /Hello, OOXML/);
  for (const label of ['document.xml', 'w:document', 'w:body'])
    await row(label).locator('.tree-chevron').click();
  await row('w:p', 0).locator('.tree-chevron').click();
  await row('w:pPr').locator('.tree-chevron').click();
  await row('w:pStyle').click();
  await page.getByRole('tab', { name: 'Inspector' }).click();
  await page.waitForSelector('.attr-value input');
  await page.screenshot({ path: join(shots, '02-inspector.png') });
});

await step('the Preview tab renders the document text', async () => {
  await page.locator('.crumb', { hasText: 'document.xml' }).click();
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.waitForSelector('.doc-page');
  assert.match(await page.textContent('.doc-page'), /Hello, OOXML/);
  await page.screenshot({ path: join(shots, '02b-preview.png') });
  // back to the element for the next step
  await page
    .locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^w:pStyle$/ }) })
    .click();
  await page.getByRole('tab', { name: 'Inspector' }).click();
});

await step('the Compare dialog opens and runs a comparison', async () => {
  await page.getByRole('button', { name: /^Compare$/ }).click();
  await page.waitForSelector('.compare-setup');
  const select = page.locator('.side-picker select').nth(1);
  // B: a second copy of the same file (an open document) → everything is unchanged
  await page.locator('.side-picker select').nth(0).selectOption({ index: 1 });
  await select.selectOption({ index: 1 });
  await page.locator('.modal .btn.primary').click();
  await page.waitForSelector('.compare-head');
  await page.locator('.tab', { hasText: 'work.docx' }).first().click();
  await page.waitForSelector('.attr-value input');
});

await step('editing an attribute marks the document dirty', async () => {
  const input = page.locator('.attr-value input').first();
  await input.fill('Heading2');
  await input.press('Enter');
  await page.waitForSelector('.tab.active .tab-close.dirty');
  assert.match(await page.textContent('.statusbar'), /1 unsaved part/);
});

await step('save (via the menu command) writes the file atomically', async () => {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('ev:command', 'file.save'),
  );
  await page.waitForSelector('.tab.active .tab-close:not(.dirty)', { timeout: 10000 });
  const saved = unzipSync(new Uint8Array(readFileSync(docPath)));
  assert.match(new TextDecoder().decode(saved['word/document.xml']), /w:val="Heading2"/);
  assert.deepEqual(Object.keys(saved), Object.keys(original), 'same entries in the same order');
  for (const name of Object.keys(original)) {
    if (name !== 'word/document.xml')
      assert.deepEqual(saved[name], original[name], `${name} must be untouched`);
  }
});

await step('undo after save reverts the edit and re-marks the document dirty', async () => {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('ev:command', 'edit.undo'),
  );
  await page.waitForSelector('.tab.active .tab-close.dirty');
});

await step('review changes opens a diff', async () => {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('ev:command', 'file.compareChanges'),
  );
  await page.waitForSelector('.compare .cm-mergeView', { timeout: 10000 });
  await page.screenshot({ path: join(shots, '03-review-changes.png') });
});

await step('no console errors', async () => {
  assert.deepEqual(errors, []);
});

// Let the debounced session write (400 ms) land, then quit. The window refuses to close while there
// are unsaved changes (by design), so exit the app directly.
await page.waitForTimeout(900);
await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);

// --- second launch with the same profile: session restore + history -----------------------------------
const app2 = await electron.launch({
  executablePath: executable,
  args: [...(executable ? [] : [root]), `--user-data-dir=${join(work, 'profile')}`],
  env: { ...process.env, OOXML_E2E: '1' },
});
const page2 = await app2.firstWindow();

await step('the previous file is restored on the next start', async () => {
  await page2.waitForSelector('.tab', { timeout: 15000 });
  assert.match(await page2.textContent('.tabs'), /work\.docx/);
  assert.match(await page2.textContent('.tabs'), /book\.xlsx/);
  await page2.waitForSelector('.cm-content, .part-view, .overview', { timeout: 10000 });
  await page2.screenshot({ path: join(shots, '04-restored.png') });
});

await step('closing the restored tab shows the recent-files list', async () => {
  // Both documents come back; close them all to reach the welcome screen.
  while (await page2.locator('.tab').count())
    await page2.locator('.tab').first().locator('.tab-close').click();
  await page2.waitForSelector('.welcome');
  assert.match(await page2.textContent('.welcome-recent'), /work\.docx/);
  // clicking a history entry re-opens it through the allow-listed main-process path
  await page2.locator('.welcome-recent .hist-item', { hasText: 'work.docx' }).click();
  await page2.waitForSelector('.tab.active');
});

await app2.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
console.log('\nAll end-to-end checks passed.');
