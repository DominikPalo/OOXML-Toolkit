import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type HostApi } from '../shared/api';

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const host: HostApi = {
  kind: 'electron',
  os: process.platform as HostApi['os'],

  openFiles: (options) => ipcRenderer.invoke(IPC.openFiles, options),
  readFile: (path) => ipcRenderer.invoke(IPC.readFile, path),
  writeFile: (path, data, options) => ipcRenderer.invoke(IPC.writeFile, path, data, options),
  saveAs: (name, data, filters) => ipcRenderer.invoke(IPC.saveAs, name, data, filters),
  statFile: (path) => ipcRenderer.invoke(IPC.statFile, path),
  fileExists: (path) => ipcRenderer.invoke(IPC.fileExists, path),
  revealInFolder: (path) => ipcRenderer.invoke(IPC.revealInFolder, path),
  pathForFile: (file) => {
    try {
      const p = webUtils.getPathForFile(file);
      return p || undefined;
    } catch {
      return undefined;
    }
  },

  approvePaths: (paths) => ipcRenderer.invoke(IPC.approvePaths, paths),

  storageGet: (key) => ipcRenderer.invoke(IPC.storageGet, key),
  storageSet: (key, value) => ipcRenderer.invoke(IPC.storageSet, key, value),

  setWindowState: (state) => ipcRenderer.send(IPC.setWindowState, state),
  setRecentFiles: (paths) => ipcRenderer.send(IPC.setRecentFiles, paths),
  forceClose: () => ipcRenderer.send(IPC.forceClose),

  watchFiles: (paths) => ipcRenderer.send(IPC.watchFiles, paths),
  onFilesChanged: (cb) => subscribe(IPC.evFilesChanged, cb),

  onOpenPaths: (cb) => subscribe(IPC.evOpenPaths, cb),
  onCommand: (cb) => subscribe(IPC.evCommand, cb),
  onCloseRequested: (cb) => subscribe(IPC.evCloseRequested, cb),
  ready: () => ipcRenderer.send(IPC.ready),
};

contextBridge.exposeInMainWorld('host', host);
