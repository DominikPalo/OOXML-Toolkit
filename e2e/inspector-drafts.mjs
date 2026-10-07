// Focused regression: Inspector drafts must survive Save and both kinds of close.
import { _electron as electron } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import assert from 'node:assert/strict';

const work = mkdtempSync(join(tmpdir(), 'ooxml-inspector-'));
const file = join(work, 'draft.zip');
writeFileSync(
  file,
  zipSync({
    'draft.xml': new TextEncoder().encode('<root status="old"><value>original</value></root>'),
  }),
);
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
  const saved = () =>
    new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(file)))['draft.xml']);

  await page.locator('.tab').waitFor();
  await row('draft.xml').locator('.tree-chevron').click();
  await row('root').click();
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  const attr = page.locator('.attr-value input').first();
  await attr.fill('saved'); // Keep focus: no Enter or blur.
  await page.locator('.tab.active .tab-close.dirty').waitFor();
  await command('file.save');
  await page.locator('.tab.active .tab-close:not(.dirty)').waitFor();
  assert.match(saved(), /status="saved"/);
  console.log('Inspector attribute saved without blur');

  await attr.fill('cancelled');
  await attr.press('Escape');
  await page.locator('.tab.active .tab-close:not(.dirty)').waitFor();
  assert.equal(await attr.inputValue(), 'saved');
  console.log('Escape discards the pending attribute draft');

  await row('root').locator('.tree-chevron').click();
  await row('value').click();
  const text = page.locator('.inspector textarea');
  await text.fill('text saved');
  await command('file.save');
  await page.locator('.tab.active .tab-close:not(.dirty)').waitFor();
  assert.match(saved(), /<value>text saved<\/value>/);
  console.log('Inspector text saved without blur');

  await text.fill('pending close');
  await command('file.close');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.tab.active .tab-close.dirty').waitFor();
  assert.equal(await page.locator('.tab').count(), 1);
  assert.equal(await text.inputValue(), 'pending close');
  await command('file.save');
  await page.locator('.tab.active .tab-close:not(.dirty)').waitFor();
  console.log('Close prompts and Cancel retains the draft');

  await text.fill('native close draft');
  await page.locator('.tab.active .tab-close.dirty').waitFor();
  // On macOS this also waits for the dirty state to reach the main process.
  if (process.platform === 'darwin') {
    for (let i = 0; i < 50; i++) {
      if (
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isDocumentEdited(),
        )
      )
        break;
      await page.waitForTimeout(20);
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await text.inputValue(), 'native close draft');
  assert.deepEqual(errors, []);
  console.log('Native window close prompts for uncommitted input');
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await app.close().catch(() => undefined);
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
