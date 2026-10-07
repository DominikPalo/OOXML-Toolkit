/** Browser implementation of the host API: file input, downloads and localStorage. */
import { COMMANDS, matchesAccelerator } from '@shared/commands';
import { OOXML_EXTENSIONS, type HostApi, type OpenedFile } from '@shared/api';

const PREFIX = 'ooxml-toolkit:';

export function createWebHost(): HostApi {
  const commandListeners = new Set<(command: string, arg?: string) => void>();
  const isMac = /Mac/i.test(navigator.platform);

  window.addEventListener('keydown', (e) => {
    for (const def of Object.values(COMMANDS)) {
      if ('accelerator' in def && matchesAccelerator(def.accelerator, e, isMac)) {
        e.preventDefault();
        commandListeners.forEach((l) => l(def.id));
        return;
      }
    }
  });

  return {
    kind: 'web',
    os: 'web',

    openFiles: (options) =>
      new Promise<OpenedFile[]>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = options?.multiple !== false;
        const exts = options?.filters
          ? options.filters.flatMap((f) => f.extensions)
          : OOXML_EXTENSIONS;
        if (!exts.includes('*')) input.accept = exts.map((e) => `.${e}`).join(',');
        input.onchange = async () => {
          const files = [...(input.files ?? [])];
          resolve(
            await Promise.all(
              files.map(async (f) => ({
                name: f.name,
                data: new Uint8Array(await f.arrayBuffer()),
              })),
            ),
          );
        };
        input.addEventListener('cancel', () => resolve([]));
        input.click();
      }),
    readFile: () => Promise.reject(new Error('Re-opening files by path requires the desktop app.')),
    statFile: async () => undefined,
    writeFile: () => Promise.reject(new Error('Saving in place requires the desktop app.')),
    saveAs: async (defaultName, data) => {
      const url = URL.createObjectURL(new Blob([data as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { name: defaultName };
    },
    fileExists: async () => false,
    revealInFolder: async () => undefined,
    pathForFile: () => undefined,
    approvePaths: async () => undefined,

    storageGet: async <T>(key: string) => {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw ? (JSON.parse(raw) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    storageSet: async (key, value) => {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },

    setWindowState: ({ title, dirtyCount }) => {
      document.title = (dirtyCount > 0 ? '● ' : '') + title;
    },
    setRecentFiles: () => undefined,
    forceClose: () => undefined,

    watchFiles: () => undefined,
    onFilesChanged: () => () => undefined,

    onOpenPaths: () => () => undefined,
    onCommand: (cb) => {
      commandListeners.add(cb);
      return () => commandListeners.delete(cb);
    },
    onCloseRequested: () => () => undefined,
    ready: () => undefined,
  };
}
