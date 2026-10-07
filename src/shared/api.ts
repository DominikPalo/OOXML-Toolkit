/** Contract between the Electron main process, the preload bridge and the renderer. */

/** What identifies a version of a file on disk without reading it. */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

export const sameStamp = (a: FileStamp | undefined, b: FileStamp | undefined): boolean =>
  !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;

/** A watched file whose stamp is not the one reported last time. */
export interface FileChange {
  path: string;
  stamp: FileStamp;
}

export interface OpenedFile {
  /** Absolute path (absent when the file came from a browser file input). */
  path?: string;
  name: string;
  data: Uint8Array;
  /** Stamp of the file taken before it was read (a later change is then never missed). */
  stamp?: FileStamp;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveResult {
  path?: string;
  name: string;
  /** Stamp of the file that was written. */
  stamp?: FileStamp;
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

export type HostKind = 'electron' | 'web';

/** Everything the renderer needs from the outside world. */
export interface HostApi {
  readonly kind: HostKind;
  readonly os: 'darwin' | 'win32' | 'linux' | 'web';

  /** Show the native open dialog and read the chosen files. Defaults to Office/ODF packages, multi-select. */
  openFiles(options?: OpenDialogOptions): Promise<OpenedFile[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Stamp of the file now; take it *before* `readFile` to know which version was read. */
  statFile(path: string): Promise<FileStamp | undefined>;
  /**
   * Write bytes to `path` (atomically). Optionally keep a `.bak` copy of the previous file.
   * Resolves with the stamp of the file that was written.
   */
  writeFile(
    path: string,
    data: Uint8Array,
    options?: { backup?: boolean },
  ): Promise<FileStamp | undefined>;
  /** Ask for a destination and write the bytes there. `undefined` if the user cancelled. */
  saveAs(
    defaultName: string,
    data: Uint8Array,
    filters?: FileFilter[],
  ): Promise<SaveResult | undefined>;
  fileExists(path: string): Promise<boolean>;
  revealInFolder(path: string): Promise<void>;
  /** Absolute path of a dropped `File` (Electron only). */
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

  /** The files whose changes should be reported through `onFilesChanged` (replaces the previous set). */
  watchFiles(paths: string[]): void;
  /**
   * Reports the stamp of a watched file when it differs from the one reported before — also once
   * right after the file is first watched. Changes made by this app show up here too, so compare
   * with the stamp you recorded when reading or writing the file.
   */
  onFilesChanged(cb: (changes: FileChange[]) => void): () => void;

  onOpenPaths(cb: (paths: string[]) => void): () => void;
  onCommand(cb: (command: string, arg?: string) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
  /** Tells the main process that the renderer is ready to receive `open-paths` events. */
  ready(): void;
}

export const IPC = {
  openFiles: 'host:openFiles',
  readFile: 'host:readFile',
  writeFile: 'host:writeFile',
  saveAs: 'host:saveAs',
  statFile: 'host:statFile',
  fileExists: 'host:fileExists',
  revealInFolder: 'host:revealInFolder',
  storageGet: 'host:storageGet',
  storageSet: 'host:storageSet',
  setWindowState: 'host:setWindowState',
  setRecentFiles: 'host:setRecentFiles',
  watchFiles: 'host:watchFiles',
  forceClose: 'host:forceClose',
  approvePaths: 'host:approvePaths',
  ready: 'host:ready',
  // main → renderer
  evOpenPaths: 'ev:openPaths',
  evCommand: 'ev:command',
  evCloseRequested: 'ev:closeRequested',
  evFilesChanged: 'ev:filesChanged',
} as const;
