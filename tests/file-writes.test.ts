import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { approve, writeFile } from '../src/main/files';

vi.mock('electron', () => ({ dialog: {}, shell: {} }));
vi.mock('../src/main/store', () => ({ storageGet: vi.fn() }));

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'ooxml-writes-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('atomic file writes', () => {
  it('queues overlapping writes to one destination with distinct temporary files', async () => {
    const target = path.join(dir, 'document.docx');
    approve(target);
    await fs.writeFile(target, 'original');
    const realWrite = fs.writeFile;
    const temporary: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
      temporary.push(String(file));
      if (temporary.length === 1) await blocked;
      await realWrite(file, data, options);
    });
    const first = writeFile(target, new TextEncoder().encode('first'));
    const second = writeFile(
      path.join(dir, '.', 'document.docx'),
      new TextEncoder().encode('second'),
    );
    await vi.waitFor(() => expect(temporary).toHaveLength(1));
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    release();
    await Promise.all([first, second]);
    expect(await fs.readFile(target, 'utf8')).toBe('second');
    expect(new Set(temporary).size).toBe(2);
    expect(await fs.readdir(dir)).toEqual(['document.docx']);
  });

  it('allows the next queued write to succeed after a failed rename', async () => {
    const target = path.join(dir, 'document.docx');
    approve(target);
    await fs.writeFile(target, 'original');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));
    const first = writeFile(target, new TextEncoder().encode('failed'));
    const rejected = expect(first).rejects.toThrow('simulated rename failure');
    const second = writeFile(target, new TextEncoder().encode('recovered'));
    await rejected;
    await second;
    expect(await fs.readFile(target, 'utf8')).toBe('recovered');
    expect(await fs.readdir(dir)).toEqual(['document.docx']);
  });

  it('does not block a different destination behind a pending write', async () => {
    const a = path.join(dir, 'a.docx');
    const b = path.join(dir, 'b.docx');
    approve(a);
    approve(b);
    const realWrite = fs.writeFile;
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
      if (path.basename(String(file)).startsWith('.a.docx.')) await blocked;
      await realWrite(file, data, options);
    });
    const first = writeFile(a, new TextEncoder().encode('a'));
    try {
      await writeFile(b, new TextEncoder().encode('b'));
      expect(await fs.readFile(b, 'utf8')).toBe('b');
    } finally {
      release();
      await first;
    }
  });
});
