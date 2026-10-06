import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { ZipArchive, writeZip } from '@core/zip/zip';
import { crc32 } from '@core/zip/crc32';

const dec = new TextDecoder();

describe('crc32', () => {
  it('matches the well-known check value', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('ZipArchive', () => {
  it('reads archives produced by another implementation (fflate)', () => {
    const big = 'lorem ipsum '.repeat(5000);
    const data = zipSync({
      'a.txt': strToU8('hello'),
      'dir/b.xml': strToU8(big),
      'ünï/cödé.txt': strToU8('unicode name'),
    });
    const zip = ZipArchive.open(data);
    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.xml', 'ünï/cödé.txt']);
    expect(dec.decode(zip.read(zip.get('a.txt')!))).toBe('hello');
    expect(dec.decode(zip.read(zip.get('dir/b.xml')!))).toBe(big);
    expect(dec.decode(zip.read(zip.get('ünï/cödé.txt')!))).toBe('unicode name');
    expect(zip.get('dir/b.xml')!.compressedSize).toBeLessThan(zip.get('dir/b.xml')!.size);
  });

  it('rejects non-zip data', () => {
    expect(() => ZipArchive.open(strToU8('definitely not a zip file at all'))).toThrow(/Not a ZIP/);
  });

  it('detects corruption through the CRC check', () => {
    const data = writeZip([{ kind: 'data', name: 'x.txt', data: strToU8('abcdef'), method: 0 }]);
    const zip = ZipArchive.open(data);
    const e = zip.get('x.txt')!;
    // flip a payload byte (stored entry: payload starts right after the 30-byte header + name)
    data[30 + 'x.txt'.length] ^= 0xff;
    expect(() => zip.read(e)).toThrow(/CRC/);
  });
});

describe('writeZip', () => {
  it('produces archives that an independent reader accepts', () => {
    const big = '<a>' + 'x'.repeat(20000) + '</a>';
    const out = writeZip([
      { kind: 'data', name: '[Content_Types].xml', data: strToU8('<Types/>') },
      { kind: 'data', name: 'word/document.xml', data: strToU8(big) },
      { kind: 'data', name: 'empty.bin', data: new Uint8Array() },
      { kind: 'data', name: 'folder/', data: new Uint8Array() },
      { kind: 'data', name: 'ünï.txt', data: strToU8('ü') },
    ]);
    const files = unzipSync(out);
    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml',
      'word/document.xml',
      'empty.bin',
      'folder/',
      'ünï.txt',
    ]);
    expect(dec.decode(files['word/document.xml'])).toBe(big);
    expect(dec.decode(files['ünï.txt'])).toBe('ü');
  });

  it('copies untouched entries verbatim (same compressed bytes, crc, sizes)', () => {
    const original = writeZip([
      { kind: 'data', name: 'a.xml', data: strToU8('<a>' + 'y'.repeat(5000) + '</a>') },
      { kind: 'data', name: 'b.txt', data: strToU8('bee') },
    ]);
    const zip = ZipArchive.open(original);
    const rewritten = writeZip(
      zip.entries.map((e) => ({ kind: 'raw' as const, entry: e, compressed: zip.raw(e) })),
    );
    const zip2 = ZipArchive.open(rewritten);
    for (const e of zip.entries) {
      const e2 = zip2.get(e.name)!;
      expect(e2.crc32).toBe(e.crc32);
      expect(e2.size).toBe(e.size);
      expect(e2.compressedSize).toBe(e.compressedSize);
      expect(zip2.raw(e2)).toEqual(zip.raw(e));
    }
  });

  it('round-trips timestamps with 2 second resolution', () => {
    const when = new Date(2023, 5, 7, 8, 9, 10);
    const zip = ZipArchive.open(
      writeZip([{ kind: 'data', name: 'x', data: strToU8('x'), modified: when }]),
    );
    expect(zip.entries[0].modified.getTime()).toBe(when.getTime());
  });
});
