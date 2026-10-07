/**
 * Editable view over a ZIP-based package.
 *
 * The original archive is never mutated. Edits live in a per-part *overlay* (text, bytes, or
 * "absent" for deletions). Saving writes untouched parts back using their original compressed
 * bytes, so a save only ever changes the parts the user actually edited.
 *
 * All mutations are recorded on an undo/redo history owned by the model.
 */
import { ZipArchive, ZipEntry, writeZip, type ZipWriteItem } from '../zip/zip';
import { crc32 } from '../zip/crc32';
import {
  DEFAULT_TEXT_FORMAT,
  decodeText,
  encodeText,
  type DecodedText,
  type TextFormat,
} from '../text';
import { tryParseXml, type XmlDocument, type XmlParseError } from '../xml/parser';

export type PartSnapshot =
  | { kind: 'original' }
  | { kind: 'text'; text: string; format: TextFormat }
  | { kind: 'bytes'; data: Uint8Array }
  | { kind: 'absent' };

export type PartStatus = 'unchanged' | 'modified' | 'added' | 'deleted';

/** Read access to the parts of a package. Implemented by the model and by read-only views. */
export interface PartSource {
  readonly label: string;
  names(): string[];
  has(name: string): boolean;
  size(name: string): number;
  /** CRC-32 if known without reading the part (originals only). */
  knownCrc(name: string): number | undefined;
  getBytes(name: string): Uint8Array;
  getText(name: string): DecodedText;
}

export interface PartChange {
  part: string;
  before: PartSnapshot;
  after: PartSnapshot;
}

export interface UndoEntry {
  label: string;
  changes: PartChange[];
  time: number;
  coalesceKey?: string;
}

export interface EditOptions {
  /** Consecutive edits with the same key within a short window collapse into one undo step. */
  coalesceKey?: string;
  label?: string;
}

const COALESCE_WINDOW_MS = 1200;
const MAX_UNDO_ENTRIES = 300;
const MAX_UNDO_BYTES = 256 * 1024 * 1024;

export interface ParsedXml {
  doc?: XmlDocument;
  error?: XmlParseError;
}

function snapshotWeight(s: PartSnapshot): number {
  return s.kind === 'text' ? s.text.length * 2 : s.kind === 'bytes' ? s.data.length : 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class PackageModel implements PartSource {
  readonly label: string;
  private archive: ZipArchive;
  private overlay = new Map<string, PartSnapshot>();
  private added: string[] = [];
  private bytesCache = new Map<string, Uint8Array>();
  private bytesCacheSize = 0;
  private textCache = new Map<string, DecodedText>();
  private xmlCache = new Map<string, { text: string; result: ParsedXml }>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<() => void>();

  /** Increments on every change (including undo/redo). */
  version = 0;
  /** Increments when parts are added/removed or `[Content_Types].xml`, `.rels` or the ODF manifest change. */
  structureVersion = 0;

  private constructor(archive: ZipArchive, label: string) {
    this.archive = archive;
    this.label = label;
  }

  static open(data: Uint8Array, label = 'package'): PackageModel {
    return new PackageModel(ZipArchive.open(data), label);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(structural: boolean): void {
    this.version++;
    if (structural) this.structureVersion++;
    for (const l of this.listeners) l();
  }

  // ---- PartSource ---------------------------------------------------------------------------

  private origEntry(name: string): ZipEntry | undefined {
    return this.archive.get(name);
  }

  names(): string[] {
    const out: string[] = [];
    for (const e of this.archive.entries) {
      if (e.isDirectory) continue;
      if (this.overlay.get(e.name)?.kind === 'absent') continue;
      out.push(e.name);
    }
    for (const n of this.added) out.push(n);
    return out;
  }

  has(name: string): boolean {
    const o = this.overlay.get(name);
    if (o) return o.kind !== 'absent';
    return !!this.origEntry(name) && !this.origEntry(name)!.isDirectory;
  }

  status(name: string): PartStatus {
    const o = this.overlay.get(name);
    if (!o) return 'unchanged';
    if (o.kind === 'absent') return 'deleted';
    return this.origEntry(name) ? 'modified' : 'added';
  }

  /** Names of deleted original parts. */
  deletedNames(): string[] {
    const out: string[] = [];
    for (const [n, s] of this.overlay) if (s.kind === 'absent') out.push(n);
    return out;
  }

  isDirty(): boolean {
    return this.overlay.size > 0;
  }

  changedParts(): Array<{ name: string; status: PartStatus }> {
    return [...this.overlay.keys()].map((name) => ({ name, status: this.status(name) }));
  }

  size(name: string): number {
    const o = this.overlay.get(name);
    if (o?.kind === 'bytes') return o.data.length;
    if (o?.kind === 'text') return encodeText(o.text, o.format).length;
    return this.origEntry(name)?.size ?? 0;
  }

  compressedSize(name: string): number | undefined {
    return this.overlay.has(name) ? undefined : this.origEntry(name)?.compressedSize;
  }

  entryInfo(name: string): ZipEntry | undefined {
    return this.overlay.has(name) ? undefined : this.origEntry(name);
  }

  knownCrc(name: string): number | undefined {
    return this.overlay.has(name) ? undefined : this.origEntry(name)?.crc32;
  }

  getBytes(name: string): Uint8Array {
    const o = this.overlay.get(name);
    if (o?.kind === 'bytes') return o.data;
    if (o?.kind === 'text') return encodeText(o.text, o.format);
    if (o?.kind === 'absent') throw new Error(`Part "${name}" does not exist.`);
    return this.readOriginal(name);
  }

  getText(name: string): DecodedText {
    const o = this.overlay.get(name);
    if (o?.kind === 'text') return { text: o.text, ...o.format };
    if (o?.kind === 'bytes') return decodeText(o.data);
    if (o?.kind === 'absent') throw new Error(`Part "${name}" does not exist.`);
    let cached = this.textCache.get(name);
    if (!cached) {
      cached = decodeText(this.readOriginal(name));
      this.textCache.set(name, cached);
    }
    return cached;
  }

  /** Parsed XML for a part (cached by text identity). */
  getXml(name: string): ParsedXml {
    const { text } = this.getText(name);
    const hit = this.xmlCache.get(name);
    if (hit && hit.text === text) return hit.result;
    const r = tryParseXml(text);
    const result: ParsedXml = r.doc ? { doc: r.doc } : { error: r.error };
    this.xmlCache.set(name, { text, result });
    return result;
  }

  private readOriginal(name: string): Uint8Array {
    const hit = this.bytesCache.get(name);
    if (hit) return hit;
    const entry = this.origEntry(name);
    if (!entry) throw new Error(`Part "${name}" does not exist.`);
    const data = this.archive.read(entry);
    if (this.bytesCacheSize + data.length > 192 * 1024 * 1024) {
      this.bytesCache.clear();
      this.bytesCacheSize = 0;
    }
    this.bytesCache.set(name, data);
    this.bytesCacheSize += data.length;
    return data;
  }

  /** Original bytes of an unmodified-or-modified part, ignoring edits. */
  getOriginalBytes(name: string): Uint8Array | undefined {
    return this.origEntry(name) && !this.origEntry(name)!.isDirectory
      ? this.readOriginal(name)
      : undefined;
  }

  // ---- Snapshots / restore ------------------------------------------------------------------

  snapshot(name: string): PartSnapshot {
    const o = this.overlay.get(name);
    if (o) return o;
    return this.origEntry(name) && !this.origEntry(name)!.isDirectory
      ? { kind: 'original' }
      : { kind: 'absent' };
  }

  private snapshotsEqual(name: string, s: PartSnapshot): boolean {
    // Does the snapshot describe exactly the original content of the part?
    const entry = this.origEntry(name);
    if (!entry) return false;
    if (s.kind === 'original') return true;
    if (s.kind === 'text') {
      const orig = this.getOriginalDecoded(name);
      return (
        orig.text === s.text && orig.encoding === s.format.encoding && orig.bom === s.format.bom
      );
    }
    if (s.kind === 'bytes') {
      if (s.data.length !== entry.size) return false;
      if (crc32(s.data) !== entry.crc32) return false;
      return bytesEqual(s.data, this.readOriginal(name));
    }
    return false;
  }

  private getOriginalDecoded(name: string): DecodedText {
    let cached = this.textCache.get(name);
    if (!cached) {
      cached = decodeText(this.readOriginal(name));
      this.textCache.set(name, cached);
    }
    return cached;
  }

  private put(name: string, snap: PartSnapshot): void {
    const isOrig = !!this.origEntry(name) && !this.origEntry(name)!.isDirectory;
    if (
      snap.kind === 'original' ||
      (isOrig && snap.kind !== 'absent' && this.snapshotsEqual(name, snap))
    ) {
      this.overlay.delete(name);
      return;
    }
    if (snap.kind === 'absent') {
      if (isOrig) this.overlay.set(name, snap);
      else {
        this.overlay.delete(name);
        this.added = this.added.filter((n) => n !== name);
      }
      return;
    }
    this.overlay.set(name, snap);
    if (!isOrig && !this.added.includes(name)) this.added.push(name);
  }

  private isStructural(name: string): boolean {
    // The ODF manifest plays the part of [Content_Types].xml: it types every part.
    return (
      name === '[Content_Types].xml' || name === 'META-INF/manifest.xml' || name.endsWith('.rels')
    );
  }

  // ---- History -----------------------------------------------------------------------------

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  private record(label: string, changes: PartChange[], opts: EditOptions = {}): void {
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      opts.coalesceKey &&
      top &&
      top.coalesceKey === opts.coalesceKey &&
      now - top.time < COALESCE_WINDOW_MS &&
      top.changes.length === 1 &&
      changes.length === 1 &&
      top.changes[0].part === changes[0].part
    ) {
      top.changes[0].after = changes[0].after;
      top.time = now;
    } else {
      this.undoStack.push({ label, changes, time: now, coalesceKey: opts.coalesceKey });
    }
    this.redoStack = [];
    this.trimHistory();
  }

  private trimHistory(): void {
    const weight = (e: UndoEntry): number =>
      e.changes.reduce((n, c) => n + snapshotWeight(c.before) + snapshotWeight(c.after), 0);
    let total = this.undoStack.reduce((n, e) => n + weight(e), 0);
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > MAX_UNDO_ENTRIES || total > MAX_UNDO_BYTES)
    ) {
      total -= weight(this.undoStack.shift()!);
    }
  }

  /** Group several mutations into one undo step. */
  transaction(label: string, fn: () => void): void {
    const startUndo = this.undoStack.length;
    const savedRedo = this.redoStack;
    fn();
    const entries = this.undoStack.splice(startUndo);
    if (!entries.length) {
      this.redoStack = savedRedo;
      return;
    }
    const merged: PartChange[] = [];
    for (const e of entries) for (const c of e.changes) merged.push(c);
    this.undoStack.push({ label, changes: merged, time: Date.now() });
  }

  undo(): UndoEntry | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    for (let i = entry.changes.length - 1; i >= 0; i--)
      this.put(entry.changes[i].part, entry.changes[i].before);
    this.redoStack.push(entry);
    this.afterHistoryJump(entry);
    return entry;
  }

  redo(): UndoEntry | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    for (const c of entry.changes) this.put(c.part, c.after);
    this.undoStack.push(entry);
    this.afterHistoryJump(entry);
    return entry;
  }

  private afterHistoryJump(entry: UndoEntry): void {
    this.changed(
      entry.changes.some(
        (c) => this.isStructural(c.part) || c.before.kind === 'absent' || c.after.kind === 'absent',
      ),
    );
  }

  // ---- Mutations ---------------------------------------------------------------------------

  private apply(name: string, after: PartSnapshot, opts: EditOptions, defaultLabel: string): void {
    const before = this.snapshot(name);
    this.put(name, after);
    this.record(
      opts.label ?? defaultLabel,
      [{ part: name, before, after: this.snapshot(name) }],
      opts,
    );
    const structural =
      this.isStructural(name) || before.kind === 'absent' || this.snapshot(name).kind === 'absent';
    this.changed(structural);
  }

  /** Replace a text part. The part keeps its original encoding / BOM. */
  setText(name: string, text: string, opts: EditOptions = {}): void {
    const current = this.has(name) ? this.getText(name) : undefined;
    if (current && current.text === text) return;
    const format: TextFormat = current
      ? { encoding: current.encoding, bom: current.bom }
      : DEFAULT_TEXT_FORMAT;
    this.apply(
      name,
      { kind: 'text', text, format },
      { coalesceKey: `text:${name}`, ...opts },
      `Edit ${name}`,
    );
  }

  setBytes(name: string, data: Uint8Array, opts: EditOptions = {}): void {
    this.apply(name, { kind: 'bytes', data }, opts, `Replace ${name}`);
  }

  addPart(name: string, data: Uint8Array | string, opts: EditOptions = {}): void {
    if (this.has(name)) throw new Error(`Part "${name}" already exists.`);
    const snap: PartSnapshot =
      typeof data === 'string'
        ? { kind: 'text', text: data, format: DEFAULT_TEXT_FORMAT }
        : { kind: 'bytes', data };
    this.apply(name, snap, opts, `Add ${name}`);
  }

  removePart(name: string, opts: EditOptions = {}): void {
    if (!this.has(name)) return;
    this.apply(name, { kind: 'absent' }, opts, `Delete ${name}`);
  }

  renamePart(from: string, to: string): void {
    if (!this.has(from)) throw new Error(`Part "${from}" does not exist.`);
    if (this.has(to)) throw new Error(`Part "${to}" already exists.`);
    const snap = this.snapshot(from);
    const content: PartSnapshot =
      snap.kind === 'original' ? { kind: 'bytes', data: this.readOriginal(from) } : snap;
    this.transaction(`Rename ${from}`, () => {
      this.apply(to, content, {}, `Add ${to}`);
      this.apply(from, { kind: 'absent' }, {}, `Delete ${from}`);
    });
  }

  // ---- Persistence -------------------------------------------------------------------------

  /** Serialise the current state. Unchanged parts reuse their original compressed bytes. */
  serialize(): Uint8Array {
    const items: ZipWriteItem[] = [];
    for (const e of this.archive.entries) {
      const o = this.overlay.get(e.name);
      if (o?.kind === 'absent') continue;
      if (!o) {
        items.push({ kind: 'raw', entry: e, compressed: this.archive.raw(e) });
      } else {
        items.push({
          kind: 'data',
          name: e.name,
          data: this.getBytes(e.name),
          comment: e.comment,
          externalAttrs: e.externalAttrs,
        });
      }
    }
    for (const name of this.added) items.push({ kind: 'data', name, data: this.getBytes(name) });
    return writeZip(items);
  }

  /**
   * Treat `data` (the bytes just written to disk) as the new baseline. Undo history stays valid:
   * snapshots that referred to the old original are converted to concrete content first.
   */
  rebase(data: Uint8Array): void {
    const old = this.archive;
    const concrete = (name: string, s: PartSnapshot): PartSnapshot => {
      if (s.kind !== 'original') return s;
      const e = old.get(name);
      return e ? { kind: 'bytes', data: old.read(e) } : { kind: 'absent' };
    };
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      for (const c of entry.changes) {
        c.before = concrete(c.part, c.before);
        c.after = concrete(c.part, c.after);
      }
    }
    this.archive = ZipArchive.open(data);
    this.overlay.clear();
    this.added = [];
    this.bytesCache.clear();
    this.bytesCacheSize = 0;
    this.textCache.clear();
    this.xmlCache.clear();
    this.changed(true);
  }

  /** A read-only view of the package as it was opened (ignoring all edits). */
  originalView(label = `${this.label} (original)`): PartSource {
    const model = this;
    const archive = this.archive;
    return {
      label,
      names: () => archive.entries.filter((e) => !e.isDirectory).map((e) => e.name),
      has: (n) => !!archive.get(n) && !archive.get(n)!.isDirectory,
      size: (n) => archive.get(n)?.size ?? 0,
      knownCrc: (n) => archive.get(n)?.crc32,
      getBytes: (n) => model.getOriginalBytes(n) ?? new Uint8Array(),
      getText: (n) => model.getOriginalDecoded(n),
    };
  }

  /** ZIP metadata for all original entries, including directory entries. */
  originalEntries(): readonly ZipEntry[] {
    return this.archive.entries;
  }
}
