// Records the animated demo (docs/demo.gif) by driving the real Electron app with a visible cursor
// and captions. Requires ffmpeg. Usage: npm run samples && npm run demo
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

setTimeout(() => {
  console.error('Timed out');
  process.exit(1);
}, 240_000).unref();

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'ooxml-demo-'));
const videoDir = join(work, 'video');
mkdirSync(videoDir);
// Work on copies in a neutral folder so file paths shown in the UI do not reveal the author's home directory.
const samplesDir = join(process.platform === 'win32' ? tmpdir() : '/tmp', 'ooxml-samples');
mkdirSync(samplesDir, { recursive: true });
for (const f of readdirSync(join(root, 'samples')))
  if (/\.(docx|xlsx|pptx)$/.test(f)) copyFileSync(join(root, 'samples', f), join(samplesDir, f));
const sample = (n) => join(samplesDir, n);

const SIZE = { width: 1280, height: 800 };
const app = await electron.launch({
  args: [
    root,
    `--user-data-dir=${join(work, 'profile')}`,
    sample('sample.docx'),
    sample('sample-v2.docx'),
    sample('sample-broken.docx'),
  ],
  env: { ...process.env, OOXML_E2E: '1' },
  recordVideo: { dir: videoDir, size: SIZE },
});
const page = await app.firstWindow();
await app.evaluate(
  ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.width, s.height),
  SIZE,
);
await page.waitForFunction(() => document.querySelectorAll('.tab').length >= 3);

const sleep = (ms) => page.waitForTimeout(ms);
const command = (id) =>
  app.evaluate(
    ({ BrowserWindow }, cmd) =>
      BrowserWindow.getAllWindows()[0].webContents.send('ev:command', cmd),
    id,
  );

// Dark theme: it compresses better and looks good in a GIF.
if (!(await page.evaluate(() => document.documentElement.dataset.theme === 'dark')))
  await command('view.toggleTheme');
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

// ---- on-screen cursor, click ripple and captions (the recording has no real cursor) -----------------
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = `
    #__cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:99998;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))}
    .__ripple{position:fixed;z-index:99997;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #7aa3f5;pointer-events:none;animation:__rip .55s ease-out forwards}
    @keyframes __rip{to{transform:scale(4.2);opacity:0}}
    #__caption{position:fixed;left:50%;bottom:44px;z-index:99999;transform:translate(-50%,12px);opacity:0;transition:opacity .35s,transform .35s;pointer-events:none;
      padding:11px 22px;border-radius:999px;font:600 18px/1.2 -apple-system,system-ui,sans-serif;color:#fff;white-space:nowrap;
      background:linear-gradient(135deg,#2f6bff,#6a3df0);box-shadow:0 8px 28px rgba(0,0,0,.45)}
    #__caption.on{opacity:1;transform:translate(-50%,0)}`;
  document.head.appendChild(style);
  const cursor = document.createElement('div');
  cursor.id = '__cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9-6.5 1.6L9.6 19z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const caption = document.createElement('div');
  caption.id = '__caption';
  document.body.append(cursor, caption);
  window.addEventListener(
    'mousemove',
    (e) => (cursor.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`),
    true,
  );
  window.addEventListener(
    'mousedown',
    (e) => {
      const r = document.createElement('div');
      r.className = '__ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    true,
  );
});

const caption = async (text) => {
  await page.evaluate((t) => {
    document.querySelectorAll('.toast button').forEach((b) => b.click()); // keep stale toasts out of the picture
    const c = document.getElementById('__caption');
    c.classList.remove('on');
    setTimeout(() => {
      c.textContent = t;
      if (t) c.classList.add('on');
    }, 180);
  }, text);
  await sleep(450);
};
const glide = async (locator, steps = 26) => {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
};
const click = async (locator, { steps, pause = 320 } = {}) => {
  await glide(locator, steps);
  await sleep(140);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(pause);
};
const type = async (text, delay = 85) => page.keyboard.type(text, { delay });
const row = (label, nth = 0) =>
  page
    .locator('.tree-row', {
      has: page.locator('.tree-label', { hasText: new RegExp(`^${label}$`) }),
    })
    .nth(nth);
const tab = (name) =>
  page
    .locator('.tab')
    .filter({
      has: page.locator('.tab-name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}$`) }),
    })
    .first();

// Start from a clean, quiet state.
await tab('sample.docx').click();
await page.mouse.move(640, 420);
await sleep(900);

// ---- 1. intro ---------------------------------------------------------------------------------------
await caption('OOXML Toolkit — view, edit and compare Office files');
await sleep(1500);

// ---- 2. explore -------------------------------------------------------------------------------------
await caption('Browse the package: every part, down to each XML element');
for (const label of ['document.xml', 'w:document', 'w:body'])
  await click(row(label).locator('.tree-chevron'), { steps: 14, pause: 170 });
await click(row('w:p', 0).locator('.tree-chevron'), { steps: 14, pause: 170 });
await click(row('w:pPr').locator('.tree-chevron'), { steps: 14, pause: 170 });
await click(row('w:pStyle'), { steps: 14, pause: 800 });

// ---- 3. edit ----------------------------------------------------------------------------------------
await caption('Edit in the inspector — everything is undoable');
await click(page.getByRole('tab', { name: 'Inspector', exact: true }), { steps: 22 });
const input = page.locator('.attr-value input').first();
await click(input, { steps: 22 });
await page.keyboard.press('Meta+A');
await type('Heading2');
await page.keyboard.press('Enter');
await sleep(900);

// ---- 4. review changes ------------------------------------------------------------------------------
await caption('See exactly what changed before you save');
await click(row('sample.docx'), { steps: 20 });
await click(page.getByRole('button', { name: /Review changes/ }), { steps: 22, pause: 400 });
await page.waitForSelector('.compare .cm-mergeView');
await sleep(1800);
await click(page.locator('.tab.active .tab-close'), { steps: 16, pause: 200 });
await tab('sample.docx').click();
await command('edit.undo');
await sleep(500);

// ---- 5. search --------------------------------------------------------------------------------------
await caption('Search every part — text, regex or XPath');
await click(page.locator('.activity-btn[aria-label="Search"]'), { steps: 20 });
await click(page.getByLabel('Search query'), { steps: 18 });
await type('Hello');
await page.waitForSelector('.result-hit');
await sleep(500);
await click(page.locator('.result-hit').first(), { steps: 18, pause: 1200 });

// ---- 6. compare -------------------------------------------------------------------------------------
await caption('Compare two versions side by side');
await click(page.locator('.tabbar-actions .btn-ghost'), { steps: 24, pause: 500 });
await page.waitForSelector('.compare-setup');
const selects = page.locator('.side-picker select');
await selects.nth(0).selectOption({ label: 'sample.docx' });
await sleep(350);
await selects.nth(1).selectOption({ label: 'sample-v2.docx' });
await sleep(550);
await click(page.locator('.modal .btn.primary'), { steps: 22, pause: 400 });
await page.waitForSelector('.compare .cm-mergeView');
await sleep(2200);

// ---- 7. package check -------------------------------------------------------------------------------
await caption('Spot broken packages: malformed XML, missing parts, bad relationships');
await click(tab('sample-broken.docx'), { steps: 24 });
await click(page.locator('.activity-btn[aria-label="Package check"]'), { steps: 22 });
await page.waitForSelector('.problem');
await sleep(600);
await click(page.locator('.problem').first(), { steps: 18, pause: 1700 });

// ---- 8. outro ---------------------------------------------------------------------------------------
await caption('Free & open source — macOS · Windows · Linux');
await sleep(1900);
await caption('');
await sleep(400);

// Leave nothing unsaved so the window can close, then finalise the video.
await app.close();
const webm = readdirSync(videoDir)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => join(videoDir, f))[0];
console.log('recorded', webm, `${(statSync(webm).size / 1e6).toFixed(1)} MB`);

const gif = join(root, 'docs', 'demo.gif');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    '1.2',
    '-i',
    webm,
    '-vf',
    'fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    '-loop',
    '0',
    gif,
  ],
  { stdio: 'inherit' },
);
console.log('wrote docs/demo.gif', `${(statSync(gif).size / 1e6).toFixed(1)} MB`);
