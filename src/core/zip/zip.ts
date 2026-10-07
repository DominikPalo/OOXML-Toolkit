/**
 * Minimal ZIP reader/writer tailored for OOXML packages.
 *
 * Why not use a library end-to-end? We want
 *  - lazy extraction (only inflate the parts the user looks at),
 *  - the central-directory metadata (sizes, CRC) without inflating anything,
 *  - verbatim re-use of the compressed bytes of untouched entries when saving, so that a
 *    save never disturbs parts the user did not edit.
 *
 * Compression itself is delegated to fflate (raw DEFLATE).
 */
import { deflateSync, inflateSync } from 'fflate';
import { crc32 } from './crc32';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

export const METHOD_STORED = 0;
export const METHOD_DEFLATE = 8;

export interface ZipEntry {
  /** Entry path inside the archive, without a leading slash (e.g. `word/document.xml`). */
  name: string;
  isDirectory: boolean;
  /** Compression method (0 = stored, 8 = deflate). */
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  /** Uncompressed size. */
  size: number;
  modified: Date;
  comment: string;
  externalAttrs: number;
  versionMadeBy: number;
  /** Offset of the local file header (only meaningful for entries read from an archive). */
  localOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

function decodeName(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

function dosToDate(date: number, time: number): Date {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = Math.max(1, (date >> 5) & 0x0f);
  const day = Math.max(1, date & 0x1f);
  return new Date(year, month - 1, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

function dateToDos(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

function u64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x1_0000_0000;
}

export class ZipArchive {
  readonly entries: ZipEntry[];
  private readonly byName = new Map<string, ZipEntry>();

  private constructor(
    private readonly data: Uint8Array,
    entries: ZipEntry[],
  ) {
    this.entries = entries;
    for (const e of entries) this.byName.set(e.name, e);
  }

  static open(data: Uint8Array): ZipArchive {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Locate the end-of-central-directory record (scan backwards, it may be followed by a comment).
    let eocd = -1;
    const minPos = Math.max(0, data.length - 22 - 0xffff);
    for (let i = data.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('Not a ZIP archive (end of central directory not found).');

    let total = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);

    if (total === 0xffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && view.getUint32(loc, true) === SIG_EOCD64_LOCATOR) {
        const off64 = u64(view, loc + 8);
        if (view.getUint32(off64, true) !== SIG_EOCD64) throw new ZipError('Corrupt ZIP64 record.');
        total = u64(view, off64 + 32);
        cdOffset = u64(view, off64 + 48);
      }
    }

    const entries: ZipEntry[] = [];
    let p = cdOffset;
    for (let i = 0; i < total; i++) {
      if (p + 46 > data.length || view.getUint32(p, true) !== SIG_CENTRAL) {
        throw new ZipError('Corrupt ZIP central directory.');
      }
      const versionMadeBy = view.getUint16(p + 4, true);
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const time = view.getUint16(p + 12, true);
      const date = view.getUint16(p + 14, true);
      const crc = view.getUint32(p + 16, true);
      let compressedSize = view.getUint32(p + 20, true);
      let size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const externalAttrs = view.getUint32(p + 38, true);
      let localOffset = view.getUint32(p + 42, true);
      const nameStart = p + 46;
      const name = decodeName(data.subarray(nameStart, nameStart + nameLen));
      const comment = commentLen
        ? decodeName(
            data.subarray(
              nameStart + nameLen + extraLen,
              nameStart + nameLen + extraLen + commentLen,
            ),
          )
        : '';

      // ZIP64 extended information extra field.
      let q = nameStart + nameLen;
      const extraEnd = q + extraLen;
      while (q + 4 <= extraEnd) {
        const id = view.getUint16(q, true);
        const len = view.getUint16(q + 2, true);
        if (id === 0x0001) {
          let o = q + 4;
          if (size === 0xffffffff) ((size = u64(view, o)), (o += 8));
          if (compressedSize === 0xffffffff) ((compressedSize = u64(view, o)), (o += 8));
          if (localOffset === 0xffffffff) localOffset = u64(view, o);
        }
        q += 4 + len;
      }

      entries.push({
        name: name.replace(/\\/g, '/'),
        isDirectory: name.endsWith('/'),
        method,
        flags,
        crc32: crc,
        compressedSize,
        size,
        modified: dosToDate(date, time),
        comment,
        externalAttrs,
        versionMadeBy,
        localOffset,
      });
      p = nameStart + nameLen + extraLen + commentLen;
    }
    return new ZipArchive(data, entries);
  }

  get(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  /** Raw (still compressed) bytes of an entry. */
  raw(entry: ZipEntry): Uint8Array {
    const view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    const o = entry.localOffset;
    if (o + 30 > this.data.length || view.getUint32(o, true) !== SIG_LOCAL) {
      throw new ZipError(`Corrupt local header for "${entry.name}".`);
    }
    const start = o + 30 + view.getUint16(o + 26, true) + view.getUint16(o + 28, true);
    return this.data.subarray(start, start + entry.compressedSize);
  }

  /** Uncompressed bytes of an entry. CRC is verified. */
  read(entry: ZipEntry): Uint8Array {
    if (entry.flags & 0x1)
      throw new ZipError(`"${entry.name}" is encrypted; encrypted entries are not supported.`);
    const raw = this.raw(entry);
    let out: Uint8Array;
    if (entry.method === METHOD_STORED) out = raw.slice();
    else if (entry.method === METHOD_DEFLATE)
      out = inflateSync(raw, { out: new Uint8Array(entry.size) });
    else throw new ZipError(`"${entry.name}" uses unsupported compression method ${entry.method}.`);
    if (entry.size && out.length !== entry.size) {
      throw new ZipError(`"${entry.name}" has an unexpected size (corrupt archive?).`);
    }
    if (crc32(out) !== entry.crc32)
      throw new ZipError(`CRC mismatch for "${entry.name}" (corrupt archive?).`);
    return out;
  }
}

/** One entry to be written to a new archive. Either carry raw compressed data or plain data. */
export type ZipWriteItem =
  | { kind: 'raw'; entry: ZipEntry; compressed: Uint8Array }
  | {
      kind: 'data';
      name: string;
      data: Uint8Array;
      modified?: Date;
      comment?: string;
      externalAttrs?: number;
      /** Force a method; by default deflate is used when it makes the entry smaller. */
      method?: number;
    };

interface Prepared {
  name: Uint8Array;
  comment: Uint8Array;
  method: number;
  flags: number;
  crc: number;
  csize: number;
  size: number;
  modified: Date;
  externalAttrs: number;
  versionMadeBy: number;
  payload: Uint8Array;
}

const enc = new TextEncoder();

function prepare(item: ZipWriteItem): Prepared {
  if (item.kind === 'raw') {
    const e = item.entry;
    if (e.flags & 0x1) throw new ZipError(`"${e.name}" is encrypted and cannot be re-written.`);
    return {
      name: enc.encode(e.name),
      comment: enc.encode(e.comment),
      method: e.method,
      // Keep the entry's flags but drop "data descriptor" (we always write sizes up front) and set UTF-8.
      flags: (e.flags & ~0x8) | 0x800,
      crc: e.crc32,
      csize: item.compressed.length,
      size: e.size,
      modified: e.modified,
      externalAttrs: e.externalAttrs,
      versionMadeBy: e.versionMadeBy,
      payload: item.compressed,
    };
  }
  const isDir = item.name.endsWith('/');
  // ODF requires the `mimetype` entry to be stored uncompressed (readers sniff its bytes).
  let method = item.method ?? (item.name === 'mimetype' ? METHOD_STORED : METHOD_DEFLATE);
  let payload = item.data;
  if (isDir || item.data.length === 0) method = METHOD_STORED;
  else if (method === METHOD_DEFLATE) {
    const deflated = deflateSync(item.data, { level: 6 });
    if (deflated.length < item.data.length) payload = deflated;
    else method = METHOD_STORED;
  }
  return {
    name: enc.encode(item.name),
    comment: enc.encode(item.comment ?? ''),
    method,
    flags: 0x800,
    crc: crc32(item.data),
    csize: payload.length,
    size: item.data.length,
    modified: item.modified ?? new Date(),
    externalAttrs: item.externalAttrs ?? (isDir ? 0x10 : 0),
    versionMadeBy: 20,
    payload,
  };
}

/** Serialise entries to a ZIP archive (no ZIP64: archives are limited to 4 GiB / 65535 entries). */
export function writeZip(items: ZipWriteItem[]): Uint8Array {
  if (items.length > 0xfffe)
    throw new ZipError('Too many entries (ZIP64 writing is not supported).');
  const prepared = items.map(prepare);
  let total = 22;
  for (const p of prepared)
    total += 30 + p.name.length + p.payload.length + 46 + p.name.length + p.comment.length;
  if (total >= 0xffffffff)
    throw new ZipError('Archive is too large (ZIP64 writing is not supported).');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];

  for (const p of prepared) {
    offsets.push(o);
    const { date, time } = dateToDos(p.modified);
    view.setUint32(o, SIG_LOCAL, true);
    view.setUint16(o + 4, 20, true);
    view.setUint16(o + 6, p.flags, true);
    view.setUint16(o + 8, p.method, true);
    view.setUint16(o + 10, time, true);
    view.setUint16(o + 12, date, true);
    view.setUint32(o + 14, p.crc, true);
    view.setUint32(o + 18, p.csize, true);
    view.setUint32(o + 22, p.size, true);
    view.setUint16(o + 26, p.name.length, true);
    view.setUint16(o + 28, 0, true);
    out.set(p.name, o + 30);
    out.set(p.payload, o + 30 + p.name.length);
    o += 30 + p.name.length + p.payload.length;
  }

  const cdStart = o;
  prepared.forEach((p, i) => {
    const { date, time } = dateToDos(p.modified);
    view.setUint32(o, SIG_CENTRAL, true);
    view.setUint16(o + 4, p.versionMadeBy, true);
    view.setUint16(o + 6, 20, true);
    view.setUint16(o + 8, p.flags, true);
    view.setUint16(o + 10, p.method, true);
    view.setUint16(o + 12, time, true);
    view.setUint16(o + 14, date, true);
    view.setUint32(o + 16, p.crc, true);
    view.setUint32(o + 20, p.csize, true);
    view.setUint32(o + 24, p.size, true);
    view.setUint16(o + 28, p.name.length, true);
    view.setUint16(o + 30, 0, true);
    view.setUint16(o + 32, p.comment.length, true);
    view.setUint16(o + 34, 0, true);
    view.setUint16(o + 36, 0, true);
    view.setUint32(o + 38, p.externalAttrs, true);
    view.setUint32(o + 42, offsets[i], true);
    out.set(p.name, o + 46);
    out.set(p.comment, o + 46 + p.name.length);
    o += 46 + p.name.length + p.comment.length;
  });
  const cdSize = o - cdStart;

  view.setUint32(o, SIG_EOCD, true);
  view.setUint16(o + 4, 0, true);
  view.setUint16(o + 6, 0, true);
  view.setUint16(o + 8, prepared.length, true);
  view.setUint16(o + 10, prepared.length, true);
  view.setUint32(o + 12, cdSize, true);
  view.setUint32(o + 16, cdStart, true);
  view.setUint16(o + 20, 0, true);
  return out;
}

/** True if the bytes start with a ZIP local-file or empty-archive signature. */
export function looksLikeZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    ((data[2] === 0x03 && data[3] === 0x04) || (data[2] === 0x05 && data[3] === 0x06))
  );
}
