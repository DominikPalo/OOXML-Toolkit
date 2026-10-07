/** File access for the renderer. Only paths the user picked (or previously opened) are accessible. */
import { BrowserWindow, dialog, shell } from 'electron';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OPEN_FILTERS,
  type FileFilter,
  type OpenDialogOptions,
  type OpenedFile,
  type SaveResult,
} from '../shared/api';
import { storageGet } from './store';

const approved = new Set<string>();
const writes = new Map<string, Promise<void>>();

export const approve = (p: string): void => {
  approved.add(path.resolve(p));
};

function assertApproved(p: string): string {
  const abs = path.resolve(p);
  if (!approved.has(abs))
    throw new Error(`Access to "${p}" has not been granted. Open the file through the app first.`);
  return abs;
}

/** Paths remembered by earlier sessions (history / session restore) may be re-opened. */
export async function approveRememberedPaths(): Promise<void> {
  const history = await storageGet<Array<{ path?: string }>>('history');
  const session = await storageGet<{ tabs?: Array<{ path?: string }> }>('session');
  for (const e of [...(history ?? []), ...(session?.tabs ?? [])]) if (e?.path) approve(e.path);
}

export async function readOpened(p: string): Promise<OpenedFile> {
  const abs = path.resolve(p);
  const data = await fs.readFile(abs);
  approve(abs);
  return {
    path: abs,
    name: path.basename(abs),
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

export async function openFilesDialog(
  win: BrowserWindow | null,
  options: OpenDialogOptions = {},
): Promise<OpenedFile[]> {
  const opts: Electron.OpenDialogOptions = {
    title: options.title,
    properties: options.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    filters: options.filters ?? OPEN_FILTERS,
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(readOpened));
}

export async function readFile(p: string): Promise<Uint8Array> {
  const data = await fs.readFile(assertApproved(p));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export async function writeFile(
  p: string,
  data: Uint8Array,
  options?: { backup?: boolean },
): Promise<void> {
  const target = assertApproved(p);
  const run = (): Promise<void> => writeApprovedFile(target, data, options);
  const next = (writes.get(target) ?? Promise.resolve()).then(run, run);
  writes.set(target, next);
  try {
    await next;
  } finally {
    if (writes.get(target) === next) writes.delete(target);
  }
}

async function writeApprovedFile(
  target: string,
  data: Uint8Array,
  options?: { backup?: boolean },
): Promise<void> {
  let mode: number | undefined;
  try {
    mode = (await fs.stat(target)).mode;
    if (options?.backup) await fs.copyFile(target, `${target}.bak`, constants.COPYFILE_FICLONE);
  } catch {
    /* new file */
  }
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tmp, data, { mode, flag: 'wx' });
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(
        `Cannot write "${path.basename(target)}": the file is read-only or locked by another program.`,
      );
    }
    throw e;
  }
}

export async function saveAs(
  win: BrowserWindow | null,
  defaultName: string,
  data: Uint8Array,
  filters?: FileFilter[],
): Promise<SaveResult | undefined> {
  const opts: Electron.SaveDialogOptions = {
    defaultPath: defaultName,
    filters: filters ?? [{ name: 'All files', extensions: ['*'] }],
  };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return undefined;
  approve(r.filePath);
  await writeFile(r.filePath, data);
  return { path: r.filePath, name: path.basename(r.filePath) };
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(assertApproved(p));
    return true;
  } catch {
    return false;
  }
}

export function revealInFolder(p: string): void {
  shell.showItemInFolder(assertApproved(p));
}
