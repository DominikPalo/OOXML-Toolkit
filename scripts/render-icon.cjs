// Renders build/icon.svg to build/icon.png (1024x1024, transparent) using Electron's Chromium.
// Usage: npx electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const svg = readFileSync(join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage();
  writeFileSync(join(__dirname, '..', 'build', 'icon.png'), image.toPNG());
  console.log('wrote build/icon.png', image.getSize());
  app.quit();
});
