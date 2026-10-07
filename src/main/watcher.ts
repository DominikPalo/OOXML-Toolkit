/** Notices when files the user has open are modified by another program. */
import { promises as fs } from 'node:fs';
import { sameStamp, type FileChange, type FileStamp } from '../shared/api';

export async function stampOf(file: string): Promise<FileStamp | undefined> {
  try {
    const s = await fs.stat(file);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return undefined;
  }
}

/**
 * Polls the watched files and reports every stamp that differs from the one reported before. It
 * does not know what the app itself has written: the renderer compares each report with the stamp
 * it recorded when it read or wrote the file.
 *
 * Polling (rather than `fs.watch`) because Office saves by replacing the file, which silently
 * ends a watch on the old inode on macOS, and because it also works on network drives.
 */
export class FileWatcher {
  /** Requested path → stamp reported last (`undefined` until the first report). */
  private readonly reported = new Map<string, FileStamp | undefined>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  /**
   * @param resolve Maps a requested path to the file to stat; `undefined` for paths the user has not granted.
   * @param onChange Receives the new stamps.
   */
  constructor(
    private readonly resolve: (path: string) => string | undefined,
    private readonly onChange: (changes: FileChange[]) => void,
    private readonly intervalMs = 1000,
  ) {}

  /** Watch exactly these paths. */
  watch(paths: string[]): void {
    const wanted = new Set(paths);
    for (const p of this.reported.keys()) if (!wanted.has(p)) this.reported.delete(p);
    for (const p of wanted) if (!this.reported.has(p)) this.reported.set(p, undefined);
    if (!this.reported.size) return this.stop();
    if (!this.timer) {
      this.timer = setInterval(() => void this.check(), this.intervalMs);
      this.timer.unref();
    }
    void this.check();
  }

  /** Look at every watched file now (also called when the window regains focus). */
  check(): Promise<void> {
    // A slow disk must not pile up overlapping rounds: join the one in progress.
    this.running ??= this.round().finally(() => (this.running = undefined));
    return this.running;
  }

  private async round(): Promise<void> {
    const changes: FileChange[] = [];
    await Promise.all(
      [...this.reported.keys()].map(async (path) => {
        const file = this.resolve(path);
        const stamp = file ? await stampOf(file) : undefined;
        // A missing file is another program in the middle of replacing it, or a deleted one.
        if (!stamp || !this.reported.has(path) || sameStamp(this.reported.get(path), stamp)) return;
        this.reported.set(path, stamp);
        changes.push({ path, stamp });
      }),
    );
    if (changes.length) this.onChange(changes);
  }

  /** Stop watching everything. */
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.reported.clear();
  }
}
