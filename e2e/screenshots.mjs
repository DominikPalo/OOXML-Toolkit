// Captures the README screenshots from the real Electron app, using the generated samples.
// Usage: npm run screenshots   (builds first, requires `npm run samples`)
import { _electron as electron } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

setTimeout(() => process.exit(1), 120_000).unref();
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const sample = (n) => join(root, 'samples', n);
const profile = join(mkdtempSync(join(tmpdir(), 'ooxml-shots-')), 'profile');

const app = await electron.launch({
  args: [
    root,
    `--user-data-dir=${profile}`,
    sample('sample.docx'),
    sample('sample.xlsx'),
    sample('sample.pptx'),
    sample('sample-v2.pptx'),
  ],
  env: { ...process.env, OOXML_E2E: '1' },
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
await page.waitForSelector('.tab');
await page.waitForFunction(() => document.querySelectorAll('.tab').length >= 4);

const command = (id) =>
  app.evaluate(
    ({ BrowserWindow }, cmd) =>
      BrowserWindow.getAllWindows()[0].webContents.send('ev:command', cmd),
    id,
  );
const setTheme = async (theme) => {
  const isDark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark');
  if (isDark !== (theme === 'dark')) await command('view.toggleTheme');
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
};
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, name), scale: 'css' });
  console.log('•', name);
};
const row = (label, nth = 0) =>
  page
    .locator('.tree-row', {
      has: page.locator('.tree-label', { hasText: new RegExp(`^${label}$`) }),
    })
    .nth(nth);
const openTab = (name) => page.locator('.tab', { hasText: name }).first().click();
const expandChain = async (labels) => {
  for (const l of labels) {
    const r = row(l);
    if ((await r.getAttribute('aria-expanded')) !== 'true')
      await r.locator('.tree-chevron').click();
  }
};

// 1 + 2: Word document — source with the selected element, then the inspector
await openTab('sample.docx');
await expandChain(['document.xml', 'w:document', 'w:body']);
await row('w:p', 0).locator('.tree-chevron').click();
await row('w:pPr').locator('.tree-chevron').click();
await row('w:pStyle').click();
await setTheme('dark');
await shot('source-dark.png');
await page.getByRole('tab', { name: 'Inspector' }).click();
await setTheme('light');
await shot('inspector-light.png');

// 3: worksheet preview
await openTab('sample.xlsx');
await expandChain(['xl', 'worksheets']);
await row('sheet1.xml').click();
await page.getByRole('tab', { name: 'Preview' }).click();
await page.locator('.sheet-cell.num').first().click();
await shot('worksheet-light.png');

// 4: comparison of two presentations
await setTheme('dark');
await openTab('sample.pptx');
await page.getByRole('button', { name: /^Compare$/ }).click();
await page.waitForSelector('.compare-setup');
const selects = page.locator('.side-picker select');
const labels = async (i) => selects.nth(i).locator('option').allTextContents();
const idx = async (i, text) => (await labels(i)).findIndex((t) => t.startsWith(text));
await selects.nth(0).selectOption({ index: await idx(0, 'sample.pptx') });
await selects.nth(1).selectOption({ index: await idx(1, 'sample-v2.pptx') });
await page.locator('.modal .btn.primary').click();
await page.waitForSelector('.compare-head');
await page
  .locator('.tree-row', { has: page.locator('.tree-label', { hasText: /^presentation\.xml$/ }) })
  .first()
  .click();
await shot('compare-dark.png');

await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
