// Focused regression: a file modified by another program (PowerPoint, ...) while it is open shows a
// warning that offers to reload it, and the app's own saves never trigger that warning.
import { _electron as electron } from 'playwright';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import assert from 'node:assert/strict';

setTimeout(() => {
  console.error('\nTimed out after 90s');
  process.exit(1);
}, 90_000).unref();

const shots = join(import.meta.dirname, 'screenshots');
mkdirSync(shots, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'ooxml-external-'));
const file = join(work, 'draft.zip');
const draft = (status, value) =>
  zipSync({
    'draft.xml': new TextEncoder().encode(
      `<root status="${status}"><value>${value}</value></root>`,
    ),
  });
writeFileSync(file, draft('old', 'original'));

/** What Office does: write a temporary file, then move it over the document. */
let clock = Date.now() + 60_000;
const writeExternally = (status, value) => {
  const tmp = join(work, '.draft.tmp');
  writeFileSync(tmp, draft(status, value));
  utimesSync(tmp, new Date((clock += 60_000)), new Date(clock));
  renameSync(tmp, file);
};
const onDisk = () =>
  new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(file)))['draft.xml']);

const app = await electron.launch({
  args: [resolve(import.meta.dirname, '..'), `--user-data-dir=${join(work, 'profile')}`, file],
  env: { ...process.env, OOXML_E2E: '1' },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const command = (id) =>
    app.evaluate(
      ({ BrowserWindow }, command) =>
        BrowserWindow.getAllWindows()[0].webContents.send('ev:command', command),
      id,
    );
  const row = (label) =>
    page.locator('.tree-row', {
      has: page.locator('.tree-label', { hasText: new RegExp(`^${label}$`) }),
    });
  const banner = page.locator('.disk-banner');
  const clean = page.locator('.tab.active .tab-close:not(.dirty)');
  const dirty = page.locator('.tab.active .tab-close.dirty');

  await page.locator('.tab').waitFor();
  await row('draft.xml').locator('.tree-chevron').click();
  await row('root').click();
  await page.getByRole('tab', { name: 'Source', exact: true }).click();
  await page.waitForSelector('.cm-content');
  await page.waitForTimeout(2500);
  assert.equal(await banner.count(), 0, 'opening a file must not look like a change');
  console.log('No warning for an untouched file');

  writeExternally('old', 'changed outside');
  await banner.waitFor({ timeout: 5000 });
  assert.match(await banner.textContent(), /draft\.zip was changed by another program/);
  assert.equal(await page.locator('.tab-stale').count(), 1);
  await page.screenshot({ path: join(shots, 'external-change.png') });
  console.log('Warning shown when another program replaces the file');

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  assert.equal(await banner.count(), 0);
  assert.equal(await page.locator('.tab-stale').count(), 1, 'the tab keeps its warning icon');
  writeExternally('old', 'changed outside twice');
  await banner.waitFor({ timeout: 5000 });
  console.log('Dismissed warning comes back when the file changes again');

  await banner.getByRole('button', { name: 'Reload' }).click();
  await banner.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.tab-stale').count(), 0);
  await page.waitForFunction(() =>
    /changed outside twice/.test(document.querySelector('.cm-content')?.textContent ?? ''),
  );
  assert.match(await page.textContent('.part-head'), /root/, 'the selection is kept');
  console.log('Reload shows the new content and keeps the selection');

  // The app's own save must not be reported back as a change.
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  const attr = page.locator('.attr-value input').first();
  await attr.fill('mine');
  await attr.press('Enter');
  await dirty.waitFor();
  await command('file.save');
  await clean.waitFor();
  assert.match(onDisk(), /status="mine"/);
  await page.waitForTimeout(2500);
  assert.equal(await banner.count(), 0, 'saving must not warn');
  console.log('No warning after saving from the app');

  // Unsaved edits + an outside change: the warning says so and Save asks before overwriting.
  await attr.fill('unsaved');
  await attr.press('Enter');
  await dirty.waitFor();
  writeExternally('theirs', 'theirs');
  await banner.waitFor({ timeout: 5000 });
  assert.match(await banner.textContent(), /unsaved changes/);
  await command('file.save');
  await page.locator('.modal').waitFor();
  assert.match(await page.textContent('.modal'), /changed by another program/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.match(onDisk(), /status="theirs"/, 'cancel leaves their version in place');
  await command('file.save');
  await page.getByRole('button', { name: 'Overwrite', exact: true }).click();
  await clean.waitFor();
  assert.match(onDisk(), /status="unsaved"/);
  await banner.waitFor({ state: 'detached' });
  console.log('Save asks before overwriting an outside change');

  // Reload from the menu, even without a warning, discards edits only after asking.
  await attr.fill('discard me');
  await attr.press('Enter');
  await dirty.waitFor();
  await command('file.reload');
  await page.getByRole('button', { name: 'Discard Changes and Reload', exact: true }).click();
  await clean.waitFor();
  await page.waitForFunction(
    () => document.querySelector('.attr-value input')?.value === 'unsaved',
  );
  console.log('Reload from Disk discards unsaved edits after asking');

  assert.deepEqual(errors, []);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await app.close().catch(() => undefined);
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
