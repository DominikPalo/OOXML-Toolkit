import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { FileChange } from '../src/shared/api';
import { FileWatcher, stampOf } from '../src/main/watcher';
import { approve, approvedPath, readOpened, statFile, writeFile } from '../src/main/files';

vi.mock('electron', () => ({ dialog: {}, shell: {} }));
vi.mock('../src/main/store', () => ({ storageGet: vi.fn() }));

let dir: string;
let file: string;
const changes: FileChange[][] = [];
let watcher: FileWatcher;

/** Make the next write distinguishable by mtime even on coarse file systems. */
const touchLater = (p: string): Promise<void> => {
  const t = new Date(Date.now() + 5000 * (changes.length + 1));
  return fs.utimes(p, t, t);
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'ooxml-watch-'));
  file = path.join(dir, 'deck.pptx');
  await fs.writeFile(file, 'original');
  changes.length = 0;
  watcher = new FileWatcher(
    (p) => (p === file ? file : undefined),
    (c) => changes.push(c),
  );
});
afterEach(async () => {
  watcher.stop();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('FileWatcher', () => {
  it('reports the stamp once when a file is first watched', async () => {
    watcher.watch([file]);
    await watcher.check();
    await watcher.check();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual([{ path: file, stamp: await stampOf(file) }]);
  });

  it('reports a modification once, however many times it looks', async () => {
    watcher.watch([file]);
    await watcher.check();
    changes.length = 0;
    await fs.writeFile(file, 'changed by PowerPoint');
    await watcher.check();
    await watcher.check();
    expect(changes).toHaveLength(1);
    expect(changes[0][0].stamp.size).toBe('changed by PowerPoint'.length);
  });

  it('notices a file that was replaced by renaming another over it', async () => {
    watcher.watch([file]);
    await watcher.check();
    changes.length = 0;
    const tmp = path.join(dir, '.deck.tmp');
    await fs.writeFile(tmp, 'replacement');
    await touchLater(tmp);
    await fs.rename(tmp, file);
    await watcher.check();
    expect(changes).toHaveLength(1);
  });

  it('says nothing while the file is missing and reports it when it returns', async () => {
    watcher.watch([file]);
    await watcher.check();
    changes.length = 0;
    await fs.rm(file);
    await watcher.check();
    expect(changes).toHaveLength(0);
    await fs.writeFile(file, 'saved again, with a different length');
    await watcher.check();
    expect(changes).toHaveLength(1);
  });

  it('stops reporting files that are no longer watched or not approved', async () => {
    const other = path.join(dir, 'other.docx');
    await fs.writeFile(other, 'x');
    watcher.watch([file, other]);
    await watcher.check();
    expect(changes.flat().map((c) => c.path)).toEqual([file]); // `other` is not approved
    changes.length = 0;
    watcher.watch([]);
    await fs.writeFile(file, 'changed');
    await watcher.check();
    expect(changes).toHaveLength(0);
  });

  it('reports again after the file is watched anew (a reopened tab)', async () => {
    watcher.watch([file]);
    await watcher.check();
    watcher.watch([]);
    watcher.watch([file]);
    await watcher.check();
    expect(changes).toHaveLength(2);
  });
});

describe('stamps from the file layer', () => {
  it('match what the watcher sees after opening, saving and reading again', async () => {
    approve(file);
    expect(approvedPath(file)).toBe(path.resolve(file));
    const opened = await readOpened(file);
    expect(opened.stamp).toEqual(await stampOf(file));
    expect(await statFile(file)).toEqual(opened.stamp);

    const written = await writeFile(file, new TextEncoder().encode('saved by the app'));
    expect(written).toEqual(await stampOf(file));
    expect(written).not.toEqual(opened.stamp);
  });

  it('refuses to stat files the user has not granted', async () => {
    await expect(statFile(path.join(dir, 'secret.docx'))).rejects.toThrow('not been granted');
  });
});
