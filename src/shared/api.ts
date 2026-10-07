/** Contract between the native host (Electron main + preload, or Tauri) and the renderer. */

export interface OpenedFile {
  /** Absolute path (absent when the file came from a browser file input). */
  path?: string;
  name: string;
  data: Uint8Array;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveResult {
  path?: string;
  name: string;
}

export interface OpenDialogOptions {
  title?: string;
  filters?: FileFilter[];
  multiple?: boolean;
}

export const OOXML_EXTENSIONS = [
  'docx',
  'docm',
  'dotx',
  'dotm',
  'xlsx',
  'xlsm',
  'xltx',
  'xltm',
  'xlsb',
  'pptx',
  'pptm',
  'potx',
  'potm',
  'ppsx',
  'ppsm',
  'vsdx',
  'vsdm',
  'odt',
  'ods',
  'odp',
  'odg',
  'zip',
];

export const OPEN_FILTERS: FileFilter[] = [
  { name: 'Office Open XML & ODF', extensions: OOXML_EXTENSIONS },
  { name: 'All files', extensions: ['*'] },
];

export type HostKind = 'electron' | 'tauri' | 'web';

/** Everything the renderer needs from the outside world. */
export interface HostApi {
  readonly kind: HostKind;
  readonly os: 'darwin' | 'win32' | 'linux' | 'web';

  /** Show the native open dialog and read the chosen files. Defaults to Office/ODF packages, multi-select. */
  openFiles(options?: OpenDialogOptions): Promise<OpenedFile[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Write bytes to `path` (atomically). Optionally keep a `.bak` copy of the previous file. */
  writeFile(path: string, data: Uint8Array, options?: { backup?: boolean }): Promise<void>;
  /** Ask for a destination and write the bytes there. `undefined` if the user cancelled. */
  saveAs(
    defaultName: string,
    data: Uint8Array,
    filters?: FileFilter[],
  ): Promise<SaveResult | undefined>;
  fileExists(path: string): Promise<boolean>;
  revealInFolder(path: string): Promise<void>;
  /** Absolute path of a dropped `File` (Electron only; Tauri delivers drops via `onOpenPaths`). */
  pathForFile(file: File): string | undefined;
  /** Allow saving to paths of files the user dropped onto the window. */
  approvePaths(paths: string[]): Promise<void>;

  storageGet<T>(key: string): Promise<T | undefined>;
  storageSet(key: string, value: unknown): Promise<void>;

  /** Window integration. */
  setWindowState(state: { title: string; path?: string; dirtyCount: number }): void;
  setRecentFiles(paths: string[]): void;
  /** Close the window without asking again (after the renderer confirmed). */
  forceClose(): void;

  onOpenPaths(cb: (paths: string[]) => void): () => void;
  onCommand(cb: (command: string, arg?: string) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
  /**
   * Files are dragged over the window. Only for hosts that take OS drops away from the page
   * (Tauri), where no HTML5 drag events fire.
   */
  onFileDrag?(cb: (active: boolean) => void): () => void;
  /** Tells the main process that the renderer is ready to receive `open-paths` events. */
  ready(): void;
}

export const IPC = {
  openFiles: 'host:openFiles',
  readFile: 'host:readFile',
  writeFile: 'host:writeFile',
  saveAs: 'host:saveAs',
  fileExists: 'host:fileExists',
  revealInFolder: 'host:revealInFolder',
  storageGet: 'host:storageGet',
  storageSet: 'host:storageSet',
  setWindowState: 'host:setWindowState',
  setRecentFiles: 'host:setRecentFiles',
  forceClose: 'host:forceClose',
  approvePaths: 'host:approvePaths',
  ready: 'host:ready',
  // main → renderer
  evOpenPaths: 'ev:openPaths',
  evCommand: 'ev:command',
  evCloseRequested: 'ev:closeRequested',
} as const;
