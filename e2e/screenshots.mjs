// Captures every screenshot used in the README and docs/guide.md from the real Electron app,
// using the generated samples. Usage: npm run samples && npm run screenshots
import { _electron as electron } from 'playwright';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

setTimeout(() => {
  console.error('Timed out');
  process.exit(1);
}, 240_000).unref();

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f)); // drop stale images

// Work on copies in a neutral folder so file paths shown in the UI do not reveal the author's home directory.
const samplesDir = join(process.platform === 'win32' ? tmpdir() : '/tmp', 'ooxml-samples');
mkdirSync(samplesDir, { recursive: true });
for (const f of readdirSync(join(root, 'samples')))
  if (/\.(docx|xlsx|pptx|odp)$/.test(f))
    copyFileSync(join(root, 'samples', f), join(samplesDir, f));
const sample = (n) => join(samplesDir, n);
const profile = join(mkdtempSync(join(tmpdir(), 'ooxml-shots-')), 'profile');

const app = await electron.launch({
  args: [
    root,
    `--user-data-dir=${profile}`,
    ...[
      'sample.docx',
      'sample-v2.docx',
      'sample-broken.docx',
      'sample.xlsx',
      'sample.pptx',
      'sample-v2.pptx',
      'sample.odp',
    ].map(sample),
  ],
  env: { ...process.env, OOXML_E2E: '1' },
});
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
await page.waitForFunction(() => document.querySelectorAll('.tab').length >= 7);

// ---- helpers ------------------------------------------------------------------------------------
const command = (id) =>
  app.evaluate(
    ({ BrowserWindow }, cmd) =>
      BrowserWindow.getAllWindows()[0].webContents.send('ev:command', cmd),
    id,
  );
const settle = (ms = 350) => page.waitForTimeout(ms);
const setTheme = async (theme) => {
  const isDark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark');
  if (isDark !== (theme === 'dark')) await command('view.toggleTheme');
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
};
const clearToasts = () =>
  page.evaluate(() => document.querySelectorAll('.toast button').forEach((b) => b.click()));
const shot = async (name, theme = 'light') => {
  await setTheme(theme);
  await clearToasts();
  await settle(450);
  await page.screenshot({ path: join(out, `${name}.png`), scale: 'css' });
  console.log('•', name);
};
const row = (label, nth = 0) =>
  page
    .locator('.tree-row', {
      has: page.locator('.tree-label', {
        hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      }),
    })
    .nth(nth);
const openTab = async (name) => {
  await page
    .locator('.tab')
    .filter({
      has: page.locator('.tab-name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}$`) }),
    })
    .first()
    .click();
  await settle(200);
};
const expand = async (label, nth = 0) => {
  const r = row(label, nth);
  if ((await r.getAttribute('aria-expanded')) !== 'true') await r.locator('.tree-chevron').click();
};
const expandChain = async (labels) => {
  for (const l of labels) await expand(l);
};
const explorer = async () => {
  await command('view.explorer');
  await settle(200);
};
const detailTab = (name) => page.getByRole('tab', { name, exact: true }).click();
const undoAll = async () => {
  for (let i = 0; i < 5; i++) {
    if (!(await page.locator('.tab.active .tab-close.dirty').count())) break;
    await command('edit.undo');
    await settle(150);
  }
};
const closeActiveCompare = async () => {
  await page.locator('.tab.active .tab-close').click();
  await settle(200);
};

/** Numbered call-outs painted over the UI (removed again after the screenshot). */
const callouts = (items) =>
  page.evaluate((list) => {
    list.forEach(([selector, n, dx, dy]) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const b = document.createElement('div');
      b.className = '__callout';
      b.textContent = String(n);
      b.style.cssText = `position:fixed;z-index:99999;left:${r.left + dx}px;top:${r.top + dy}px;width:24px;height:24px;border-radius:50%;background:#e11d48;color:#fff;font:700 13px/24px system-ui;text-align:center;box-shadow:0 0 0 3px rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.4);pointer-events:none`;
      document.body.appendChild(b);
    });
  }, items);
const clearCallouts = () =>
  page.evaluate(() => document.querySelectorAll('.__callout').forEach((e) => e.remove()));

// ---- 1. Window anatomy -------------------------------------------------------------------------
await openTab('sample.docx');
await explorer();
await expandChain(['document.xml', 'w:document', 'w:body']);
await row('w:p', 0).locator('.tree-chevron').click();
await row('w:pPr').locator('.tree-chevron').click();
await row('w:pStyle').click();
await settle(300);
await page.locator('.cm-line', { hasText: 'w:pStyle' }).first().click();
await settle(500);
await callouts([
  ['.tabbar', 1, 1120, 7],
  ['.activity-bar', 2, 11, 300],
  ['.explorer-toolbar', 3, 192, 3],
  ['.tree', 4, 215, 120],
  ['.breadcrumb', 5, 535, -1],
  ['.tabstrip', 6, 190, 3],
  ['.source-toolbar', 7, 380, 4],
  ['.source-body', 8, 560, 70],
  ['.source-footer', 9, 700, 3],
  ['.statusbar', 10, 560, -1],
]);
await shot('anatomy');
await clearCallouts();

// ---- 2. Hero: source with a selected element (dark) -------------------------------------------
await shot('hero-dark', 'dark');

// ---- 3. Overview of a package -----------------------------------------------------------------
await openTab('sample.pptx');
await explorer();
await row('sample.pptx').click();
await settle(300);
await page.getByRole('button', { name: /Run check/ }).click();
await settle(900);
await shot('overview');

// ---- 4. Relations view + slide preview --------------------------------------------------------
await page.getByRole('button', { name: /Relations/ }).click();
await settle(200);
await expand('presentation.xml');
await row('slide2.xml').click();
await settle(300);
await detailTab('Preview');
await shot('relations-slide');
await page.getByRole('button', { name: /^Parts$/ }).click();

// ---- 4b. An OpenDocument package: metadata and the manifest ----------------------------------
await openTab('sample.odp');
await explorer();
await row('sample.odp').click();
await settle(300);
await shot('odf-overview');
await page.getByRole('button', { name: /Manifest/ }).click();
await settle(200);
await row('content.xml').click();
await settle(400);
await shot('odf-manifest');
await page.getByRole('button', { name: /^Parts$/ }).click();

// ---- 5. Search: text and XPath ----------------------------------------------------------------
await openTab('sample.docx');
await command('view.search');
await page.getByLabel('Search query').fill('Heading');
await page.waitForSelector('.result-hit');
await page.locator('.result-hit').first().click();
await shot('search-text');

await openTab('sample.xlsx');
await command('view.search');
await page.locator('.search-options .segmented button', { hasText: 'XPath' }).click();
await page.getByLabel('Search query').fill('//x:c[x:f]');
await page.waitForSelector('.result-hit');
await page.locator('.result-hit').first().click();
await shot('search-xpath');
await page.locator('.search-options .segmented button', { hasText: 'Text' }).click();
await page.getByLabel('Search query').fill('');

// ---- 6. Worksheet and document previews -------------------------------------------------------
await explorer();
await expandChain(['xl', 'worksheets']);
await row('sheet1.xml').click();
await detailTab('Preview');
await page.locator('.sheet-cell.num').nth(2).click();
await shot('preview-worksheet');

await openTab('sample.docx');
await row('document.xml').click();
await detailTab('Preview');
await shot('preview-document');

// ---- 7. Inspector: edit an attribute -----------------------------------------------------------
await row('w:pStyle').click();
await detailTab('Inspector');
const attr = page.locator('.attr-value input').first();
await attr.fill('Heading2');
await attr.press('Enter');
await page.waitForSelector('.tab.active .tab-close.dirty');
await shot('inspector-edit');

// ---- 8. Review unsaved changes ----------------------------------------------------------------
await command('file.compareChanges');
await page.waitForSelector('.compare .cm-mergeView');
await shot('review-changes');
await closeActiveCompare();
await openTab('sample.docx');
await undoAll();

// ---- 9. Reordering slides from the tree --------------------------------------------------------
await openTab('sample.pptx');
await explorer();
await expandChain(['ppt']);
await expand('presentation.xml');
await expandChain(['p:presentation', 'p:sldIdLst']);
await row('p:sldId', 0).click({ button: 'right' });
await page.waitForSelector('.ctx');
await shot('context-menu');
await page.locator('.ctx-item', { hasText: 'Move Down' }).click();
await settle(400);
await command('file.compareChanges');
await page.waitForSelector('.compare .cm-mergeView');
await shot('reorder-slides-diff');
await closeActiveCompare();
await openTab('sample.pptx');
await undoAll();

// ---- 10. Compare two files ---------------------------------------------------------------------
await openTab('sample.docx');
await page.getByRole('button', { name: /^Compare$/ }).click();
await page.waitForSelector('.compare-setup');
const selects = page.locator('.side-picker select');
await selects.nth(0).selectOption({ label: 'sample.docx' });
await selects.nth(1).selectOption({ label: 'sample-v2.docx' });
await shot('compare-setup');
await page.locator('.modal .btn.primary').click();
await page.waitForSelector('.compare .cm-mergeView');
await shot('compare-files');
await page.getByRole('button', { name: /Unified/ }).click();
await settle(300);
await shot('compare-unified');
await closeActiveCompare();

// ---- 11. Package check on a damaged file -------------------------------------------------------
await openTab('sample-broken.docx');
await command('view.problems');
await page.waitForSelector('.problem');
await page.locator('.problem', { hasText: 'Not well-formed' }).first().click();
await settle(500);
await shot('package-check');

// ---- 12. Bookmarks ----------------------------------------------------------------------------
await openTab('sample.docx');
await explorer();
await row('styles.xml').click();
await command('bookmark.toggle');
await row('document.xml').click();
await command('bookmark.toggle');
await row('w:pStyle').click();
await command('bookmark.toggle');
await command('view.bookmarks');
await page.waitForSelector('.bm-item');
// give the element bookmark a name and a note
const bm = page.locator('.bm-item', { hasText: 'w:pStyle' }).first();
await bm.hover();
await bm.getByRole('button', { name: 'Edit bookmark' }).click();
await page.locator('.modal input').fill('Title style');
await page.locator('.modal .btn.primary').click();
await page.locator('.modal textarea').fill('Heading style used by the document title');
await page.locator('.modal .btn.primary').click();
await shot('bookmarks');

// ---- 13. Go to part --------------------------------------------------------------------------------
await openTab('sample.pptx');
await command('view.quickOpen');
await page.locator('.palette-input').fill('slide');
await shot('quick-open');
await page.keyboard.press('Escape');

// ---- 14. Settings ----------------------------------------------------------------------------------
await command('app.settings');
await page.waitForSelector('.settings');
await shot('settings');
await page.keyboard.press('Escape');

// ---- 15. Welcome screen with recent files ------------------------------------------------------
await command('view.toggleSidebar'); // the welcome screen reads best without a side bar
for (let i = 0; i < 12 && (await page.locator('.tab').count()); i++) {
  await page.locator('.tab').first().locator('.tab-close').click();
  await settle(120);
}
await page.waitForSelector('.welcome-recent');
await shot('welcome');

await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
console.log('done');
