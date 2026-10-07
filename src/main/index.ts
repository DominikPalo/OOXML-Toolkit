import { BrowserWindow, app, ipcMain, nativeTheme, screen, shell } from 'electron';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { IPC, OOXML_EXTENSIONS, type OpenDialogOptions } from '../shared/api';
import {
  approve,
  approvedPath,
  approveRememberedPaths,
  fileExists,
  openFilesDialog,
  readFile,
  revealInFolder,
  saveAs,
  statFile,
  writeFile,
} from './files';
import { buildMenu } from './menu';
import { storageGet, storageSet } from './store';
import { FileWatcher } from './watcher';

let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let pendingPaths: string[] = [];
let forceClose = false;
let recent: string[] = [];

const watcher = new FileWatcher(approvedPath, (changes) => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IPC.evFilesChanged, changes);
});

app.setName('OOXML Toolkit');
app.setAboutPanelOptions({
  applicationName: 'OOXML Toolkit',
  applicationVersion: app.getVersion(),
  copyright: 'MIT License',
  credits: 'View, edit and compare OOXML packages.',
});

// ---------------------------------------------------------------------------------------------
// Opening files from the OS (double click, "Open with", CLI, second instance)
// ---------------------------------------------------------------------------------------------

const extensions = new Set(OOXML_EXTENSIONS.map((e) => `.${e}`));

function pathsFromArgv(argv: string[]): string[] {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter(
      (a) => !a.startsWith('-') && extensions.has(path.extname(a).toLowerCase()) && existsSync(a),
    )
    .map((a) => path.resolve(a));
}

function openPaths(paths: string[]): void {
  if (!paths.length) return;
  paths.forEach(approve);
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.evOpenPaths, paths);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingPaths.push(...paths);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => openPaths(pathsFromArgv(argv)));
}

app.on('open-file', (event, p) => {
  event.preventDefault();
  openPaths([p]);
});

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const stateFile = (): string => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1360, height: 860 };
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState;
    if (s.x !== undefined && s.y !== undefined) {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return (
          s.x! < b.x + b.width - 80 &&
          s.x! + s.width > b.x + 80 &&
          s.y! >= b.y - 20 &&
          s.y! < b.y + b.height - 80
        );
      });
      if (!visible) return { width: s.width, height: s.height, maximized: s.maximized };
    }
    return { ...fallback, ...s };
  } catch {
    return fallback;
  }
}

function createWindow(): void {
  const state = loadWindowState();
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 860,
    minHeight: 520,
    show: false,
    title: 'OOXML Toolkit',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c20' : '#ffffff',
    titleBarStyle: mac ? 'hiddenInset' : 'default',
    trafficLightPosition: mac ? { x: 14, y: 13 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();

  // OOXML_E2E keeps the window hidden so automated runs don't steal focus.
  win.once('ready-to-show', () => {
    if (process.env.OOXML_E2E !== '1') win.show();
  });

  const saveState = (): void => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    fs.writeFile(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })).catch(
      () => undefined,
    );
  };
  win.on('close', (e) => {
    saveState();
    // Always let the renderer decide: it knows about input that has not reached the dirty state
    // mirrored here yet. A renderer that cannot answer must not keep the window open.
    if (rendererReady && !forceClose && !win.webContents.isCrashed()) {
      e.preventDefault();
      win.webContents.send(IPC.evCloseRequested);
    }
  });
  // Coming back from another program (PowerPoint, ...) is when a change matters most.
  win.on('focus', () => void watcher.check());
  win.on('closed', () => {
    watcher.stop();
    mainWindow = null;
    rendererReady = false;
    forceClose = false;
  });

  // The app never navigates; external links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// ---------------------------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------------------------

const windowOf = (e: { sender: Electron.WebContents }): BrowserWindow | null =>
  BrowserWindow.fromWebContents(e.sender);

function registerIpc(): void {
  ipcMain.handle(IPC.openFiles, (e, options?: OpenDialogOptions) =>
    openFilesDialog(windowOf(e), options),
  );
  ipcMain.handle(IPC.readFile, (_e, p: string) => readFile(p));
  ipcMain.handle(IPC.writeFile, (_e, p: string, data: Uint8Array, options?: { backup?: boolean }) =>
    writeFile(p, data, options),
  );
  ipcMain.handle(IPC.saveAs, (e, name: string, data: Uint8Array, filters) =>
    saveAs(windowOf(e), name, data, filters),
  );
  ipcMain.handle(IPC.statFile, (_e, p: string) => statFile(p));
  ipcMain.handle(IPC.fileExists, (_e, p: string) => fileExists(p));
  ipcMain.handle(IPC.revealInFolder, (_e, p: string) => revealInFolder(p));
  ipcMain.handle(IPC.approvePaths, (_e, paths: string[]) => paths.forEach(approve));
  ipcMain.handle(IPC.storageGet, (_e, key: string) => storageGet(key));
  ipcMain.handle(IPC.storageSet, (_e, key: string, value: unknown) => storageSet(key, value));

  ipcMain.on(IPC.setWindowState, (e, s: { title: string; path?: string; dirtyCount: number }) => {
    const win = windowOf(e);
    if (!win) return;
    win.setTitle(s.title);
    if (process.platform === 'darwin') {
      win.setRepresentedFilename(s.path ?? '');
      win.setDocumentEdited(s.dirtyCount > 0);
    }
  });
  ipcMain.on(IPC.setRecentFiles, (_e, paths: string[]) => {
    recent = paths;
    buildMenu(recent);
    if (process.platform === 'darwin' || process.platform === 'win32') {
      for (const p of [...paths].reverse().slice(-10)) if (existsSync(p)) app.addRecentDocument(p);
    }
  });
  ipcMain.on(IPC.watchFiles, (_e, paths: string[]) => watcher.watch(paths));
  ipcMain.on(IPC.forceClose, () => {
    forceClose = true;
    mainWindow?.close();
  });
  ipcMain.on(IPC.ready, () => {
    rendererReady = true;
    if (pendingPaths.length && mainWindow) {
      mainWindow.webContents.send(IPC.evOpenPaths, pendingPaths);
      pendingPaths = [];
    }
  });
}

void app.whenReady().then(async () => {
  await approveRememberedPaths();
  pendingPaths.push(...pathsFromArgv(process.argv));
  pendingPaths.forEach(approve);
  registerIpc();
  buildMenu(recent);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
