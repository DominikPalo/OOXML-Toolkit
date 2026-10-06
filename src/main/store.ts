/** Tiny JSON key/value store in the user-data directory (history, bookmarks, settings, session). */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const dir = (): string => path.join(app.getPath('userData'), 'storage');
const fileFor = (key: string): string =>
  path.join(dir(), `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

// Serialise writes per key so concurrent saves can never interleave.
const queues = new Map<string, Promise<void>>();

export async function storageGet<T>(key: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(fileFor(key), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function storageSet(key: string, value: unknown): Promise<void> {
  const run = async (): Promise<void> => {
    await fs.mkdir(dir(), { recursive: true });
    const target = fileFor(key);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
    await fs.rename(tmp, target);
  };
  const next = (queues.get(key) ?? Promise.resolve()).then(run, run);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}
