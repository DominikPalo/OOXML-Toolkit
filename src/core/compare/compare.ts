/** Package-level comparison: which parts were added, removed or changed. */
import type { PartSource } from '../package/model';
import { formatXml } from '../xml/format';
import { partKind } from '../package/kinds';
import { CONTENT_TYPES_PART, analyzePackage, contentTypeOf } from '../package/opc';
import type { PartKind } from '../package/kinds';

export type DiffStatus = 'added' | 'removed' | 'modified' | 'formatting' | 'unchanged';

export interface PartDiff {
  name: string;
  status: DiffStatus;
  kind: PartKind;
  sizeA?: number;
  sizeB?: number;
}

export interface CompareOptions {
  /** Treat parts that only differ in insignificant whitespace/indentation as `formatting`. Default: true. */
  detectFormatting?: boolean;
  /** Also ignore attribute order when normalising XML. Default: false. */
  sortAttributes?: boolean;
}

export interface CompareResult {
  parts: PartDiff[];
  counts: Record<DiffStatus, number>;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Text used for diffing: pretty-printed XML when parseable, else the raw text. */
export function normalizedText(src: PartSource, name: string, opts: CompareOptions = {}): string {
  const { text } = src.getText(name);
  try {
    return formatXml(text, { sortAttributes: opts.sortAttributes });
  } catch {
    return text;
  }
}

export async function comparePackages(
  a: PartSource,
  b: PartSource,
  opts: CompareOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<CompareResult> {
  const detectFormatting = opts.detectFormatting ?? true;
  const typesA = a.has(CONTENT_TYPES_PART) ? analyzePackage(a).contentTypes : undefined;
  const typesB = b.has(CONTENT_TYPES_PART) ? analyzePackage(b).contentTypes : undefined;
  const empty = { defaults: new Map<string, string>(), overrides: new Map<string, string>() };

  const namesA = new Set(a.names());
  const namesB = new Set(b.names());
  const all = [...new Set([...a.names(), ...b.names()])];
  const parts: PartDiff[] = [];
  let done = 0;
  let last = performance.now();

  for (const name of all) {
    const inA = namesA.has(name);
    const inB = namesB.has(name);
    const kind = partKind(name, contentTypeOf((inA ? typesA : typesB) ?? empty, name));
    const diff: PartDiff = {
      name,
      kind,
      status: 'unchanged',
      sizeA: inA ? a.size(name) : undefined,
      sizeB: inB ? b.size(name) : undefined,
    };
    if (!inA) diff.status = 'added';
    else if (!inB) diff.status = 'removed';
    else diff.status = comparePart(a, b, name, kind, detectFormatting, opts);
    parts.push(diff);

    done++;
    if (performance.now() - last > 16) {
      onProgress?.(done, all.length);
      await tick();
      last = performance.now();
    }
  }
  onProgress?.(all.length, all.length);

  const counts: Record<DiffStatus, number> = {
    added: 0,
    removed: 0,
    modified: 0,
    formatting: 0,
    unchanged: 0,
  };
  for (const p of parts) counts[p.status]++;
  return { parts, counts };
}

function comparePart(
  a: PartSource,
  b: PartSource,
  name: string,
  kind: PartKind,
  detectFormatting: boolean,
  opts: CompareOptions,
): DiffStatus {
  const crcA = a.knownCrc(name);
  const crcB = b.knownCrc(name);
  const sameSize = a.size(name) === b.size(name);
  let identical: boolean;
  if (crcA !== undefined && crcB !== undefined && crcA !== crcB) identical = false;
  else if (!sameSize) identical = false;
  else identical = bytesEqual(a.getBytes(name), b.getBytes(name));
  if (identical) return 'unchanged';

  if (detectFormatting && (kind === 'xml' || kind === 'rels')) {
    try {
      if (normalizedText(a, name, opts) === normalizedText(b, name, opts)) return 'formatting';
    } catch {
      /* unreadable: fall through to modified */
    }
  }
  return 'modified';
}

export function diffLabel(status: DiffStatus): string {
  return {
    added: 'Added',
    removed: 'Removed',
    modified: 'Modified',
    formatting: 'Formatting only',
    unchanged: 'Unchanged',
  }[status];
}

export function buildReport(labelA: string, labelB: string, result: CompareResult): string {
  const c = result.counts;
  const lines = [
    '# OOXML comparison',
    '',
    `- **A:** ${labelA}`,
    `- **B:** ${labelB}`,
    '',
    `Added: ${c.added} · Removed: ${c.removed} · Modified: ${c.modified} · Formatting only: ${c.formatting} · Unchanged: ${c.unchanged}`,
    '',
  ];
  for (const status of ['added', 'removed', 'modified', 'formatting'] as const) {
    const items = result.parts.filter((p) => p.status === status);
    if (!items.length) continue;
    lines.push(`## ${diffLabel(status)} (${items.length})`, '');
    for (const p of items) {
      const sizes =
        p.sizeA !== undefined && p.sizeB !== undefined ? ` — ${p.sizeA} → ${p.sizeB} bytes` : '';
      lines.push(`- \`${p.name}\`${sizes}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
