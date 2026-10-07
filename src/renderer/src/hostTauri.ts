/** Tauri implementation of the host API. The native side lives in `src-tauri/src/main.rs`. */
import { invoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { OPEN_FILTERS, type FileFilter, type HostApi, type OpenedFile } from '@shared/api';
import { createTauriMenu } from './tauriMenu';

export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

const ALL_FILES: FileFilter[] = [{ name: 'All files', extensions: ['*'] }];

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** Commands reject with the Rust error string; the renderer expects `Error`s. */
async function call<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try {
    return await invoke<T>(cmd, args, options);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

function emitter<A extends unknown[]>() {
  const listeners = new Set<(...args: A) => void>();
  return {
    emit: (...args: A) => listeners.forEach((l) => l(...args)),
    on: (cb: (...args: A) => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}

export function createTauriHost(): HostApi {
  const os = /Mac/i.test(navigator.platform)
    ? 'darwin'
    : /Win/i.test(navigator.platform)
      ? 'win32'
      : 'linux';
  const commands = emitter<[string, string?]>();
  const opened = emitter<[string[]]>();
  const closeRequested = emitter<[]>();

  // Subscribed once, up front: `ready()` waits for these so no event can slip past.
  const listening = Promise.all([
    listen<string[]>('ev:openPaths', (e) => opened.emit(e.payload)),
    listen('ev:closeRequested', () => closeRequested.emit()),
  ]);
  const menu = createTauriMenu(os, commands.emit);

  // Raw bytes both ways: a 50 MB package must not travel as a JSON number array.
  const readFile = async (path: string): Promise<Uint8Array> =>
    new Uint8Array(await call<ArrayBuffer>('read_file', { path }));
  const writeFile = (path: string, data: Uint8Array, options?: { backup?: boolean }) =>
    call<void>('write_file', data, {
      headers: { 'x-path': encodeURIComponent(path), 'x-backup': options?.backup ? '1' : '0' },
    });

  return {
    kind: 'tauri',
    os,

    openFiles: async (options) => {
      const paths = await call<string[]>('open_files', {
        options: { ...options, filters: options?.filters ?? OPEN_FILTERS },
      });
      return Promise.all(
        paths.map(async (path): Promise<OpenedFile> => ({
          path,
          name: baseName(path),
          data: await readFile(path),
        })),
      );
    },
    readFile,
    writeFile,
    saveAs: async (defaultName, data, filters) => {
      const path = await call<string | null>('pick_save_path', {
        defaultName,
        filters: filters ?? ALL_FILES,
      });
      if (!path) return undefined;
      await writeFile(path, data);
      return { path, name: baseName(path) };
    },
    fileExists: (path) => call<boolean>('file_exists', { path }),
    revealInFolder: (path) => call<void>('reveal_in_folder', { path }),
    // Drops arrive as native paths through `onOpenPaths`, approved by the native side itself.
    pathForFile: () => undefined,
    approvePaths: async () => undefined,

    storageGet: async <T>(key: string) =>
      (await call<T | null>('storage_get', { key })) ?? undefined,
    storageSet: (key, value) => call<void>('storage_set', { key, value }),

    setWindowState: ({ title, path, dirtyCount }) =>
      void call('set_window_state', { title, path: path ?? null, edited: dirtyCount > 0 }).catch(
        () => undefined,
      ),
    setRecentFiles: (paths) => {
      menu.setRecent(paths);
      void call('note_recent_documents', { paths: paths.slice(0, 10) }).catch(() => undefined);
    },
    forceClose: () => void call('force_close'),

    onOpenPaths: opened.on,
    onCommand: commands.on,
    onCloseRequested: closeRequested.on,
    onFileDrag: (cb) => {
      const off = getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter') cb(payload.paths.length > 0);
        else if (payload.type !== 'over') cb(false);
      });
      return () => void off.then((f) => f());
    },
    ready: () =>
      void listening
        .then(() => call<string[]>('renderer_ready'))
        .then((paths) => paths.length && opened.emit(paths)),
  };
}
