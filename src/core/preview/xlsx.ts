/** Read-only extraction of worksheet data (raw values, no number formatting). */
import type { PartSource } from '../package/model';
import { analyzePackage } from '../package/opc';
import {
  child,
  getAttr,
  textContent,
  tryParseXml,
  type XmlDocument,
  type XmlElement,
} from '../xml/parser';

export interface SheetRef {
  name: string;
  part: string;
  state: 'visible' | 'hidden' | 'veryHidden';
}

export interface Cell {
  ref: string;
  /** 0-based. */
  col: number;
  /** 1-based. */
  row: number;
  value: string;
  type: 'number' | 'string' | 'boolean' | 'error' | 'empty';
  formula?: string;
}

export interface SheetGrid {
  rows: Array<{ row: number; cells: Cell[] }>;
  columnCount: number;
  rowCount: number;
  truncated: boolean;
  mergedCells: string[];
  dimension?: string;
}

export function columnName(index0: number): string {
  let n = index0 + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function parseCellRef(ref: string): { col: number; row: number } | undefined {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) return undefined;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) };
}

function parse(src: PartSource, part: string): XmlDocument | undefined {
  if (!src.has(part)) return undefined;
  return tryParseXml(src.getText(part).text).doc;
}

/** The `r:id`-style attribute (any prefix), as opposed to a plain `id`. */
const relAttr = (el: XmlElement, local: string): string | undefined =>
  el.attrs.find((a) => a.name.endsWith(`:${local}`))?.value;

export function listSheets(src: PartSource): SheetRef[] {
  const analysis = analyzePackage(src);
  const main = analysis.mainPart;
  if (!main) return [];
  const doc = parse(src, main);
  const sheets = doc && child(doc.root, 'sheets');
  if (!sheets) return [];
  const rels = analysis.relationships.get(main) ?? [];
  const out: SheetRef[] = [];
  for (const el of sheets.elements) {
    if (el.local !== 'sheet') continue;
    const rid = relAttr(el, 'id');
    const target = rels.find((r) => r.id === rid)?.resolved;
    if (!target || !src.has(target)) continue;
    const state = getAttr(el, 'state');
    out.push({
      name: getAttr(el, 'name') ?? target,
      part: target,
      state: state === 'hidden' || state === 'veryHidden' ? state : 'visible',
    });
  }
  return out;
}

function readSharedStrings(src: PartSource): string[] {
  const analysis = analyzePackage(src);
  const main = analysis.mainPart;
  const viaRel = main
    ? analysis.relationships.get(main)?.find((r) => r.type.endsWith('/sharedStrings'))?.resolved
    : undefined;
  const part = viaRel ?? 'xl/sharedStrings.xml';
  const doc = parse(src, part);
  if (!doc) return [];
  const out: string[] = [];
  for (const si of doc.root.elements) {
    if (si.local !== 'si') continue;
    let text = '';
    for (const c of si.elements) {
      if (c.local === 't') text += textContent(doc, c);
      else if (c.local === 'r')
        for (const t of c.elements) if (t.local === 't') text += textContent(doc, t);
      // `rPh` (phonetic runs) are intentionally skipped.
    }
    out.push(text);
  }
  return out;
}

export function readSheet(
  src: PartSource,
  part: string,
  limits: { maxRows?: number; maxCols?: number } = {},
): SheetGrid {
  const maxRows = limits.maxRows ?? 1000;
  const maxCols = limits.maxCols ?? 100;
  const grid: SheetGrid = {
    rows: [],
    columnCount: 0,
    rowCount: 0,
    truncated: false,
    mergedCells: [],
  };
  const doc = parse(src, part);
  if (!doc) return grid;

  grid.dimension = getAttr(child(doc.root, 'dimension') ?? doc.root, 'ref');
  const merge = child(doc.root, 'mergeCells');
  if (merge)
    for (const m of merge.elements)
      if (m.local === 'mergeCell') grid.mergedCells.push(getAttr(m, 'ref') ?? '');

  const data = child(doc.root, 'sheetData');
  if (!data) return grid;
  let shared: string[] | undefined;
  const sharedString = (i: number): string => (shared ??= readSharedStrings(src))[i] ?? '';

  let lastRow = 0;
  for (const rowEl of data.elements) {
    if (rowEl.local !== 'row') continue;
    const rowNum = parseInt(getAttr(rowEl, 'r') ?? '', 10) || lastRow + 1;
    lastRow = rowNum;
    grid.rowCount = Math.max(grid.rowCount, rowNum);
    if (grid.rows.length >= maxRows) {
      grid.truncated = true;
      continue; // keep counting rows for `rowCount`, but build nothing
    }

    const cells: Cell[] = [];
    let lastCol = -1;
    for (const c of rowEl.elements) {
      if (c.local !== 'c') continue;
      const ref = getAttr(c, 'r');
      const pos = ref ? parseCellRef(ref) : undefined;
      const col = pos?.col ?? lastCol + 1;
      lastCol = col;
      if (col >= maxCols) {
        grid.truncated = true;
        continue;
      }
      const t = getAttr(c, 't');
      const v = child(c, 'v');
      const f = child(c, 'f');
      const raw = v ? textContent(doc, v) : '';
      let value = raw;
      let type: Cell['type'] = 'number';
      if (t === 's') {
        value = sharedString(parseInt(raw, 10));
        type = 'string';
      } else if (t === 'inlineStr') {
        const is = child(c, 'is');
        value = is
          ? is.elements
              .filter((x) => x.local === 't' || x.local === 'r')
              .map((x) =>
                x.local === 't'
                  ? textContent(doc, x)
                  : x.elements
                      .filter((y) => y.local === 't')
                      .map((y) => textContent(doc, y))
                      .join(''),
              )
              .join('')
          : '';
        type = 'string';
      } else if (t === 'str' || t === 'd') {
        type = 'string';
      } else if (t === 'b') {
        value = raw === '1' ? 'TRUE' : 'FALSE';
        type = 'boolean';
      } else if (t === 'e') {
        type = 'error';
      } else if (!v) {
        type = 'empty';
      }
      const formula = f ? textContent(doc, f) || undefined : undefined;
      cells.push({
        ref: ref ?? `${columnName(col)}${rowNum}`,
        col,
        row: rowNum,
        value,
        type,
        formula,
      });
      grid.columnCount = Math.max(grid.columnCount, col + 1);
    }
    grid.rows.push({ row: rowNum, cells });
  }

  if (grid.dimension) {
    const end = grid.dimension.split(':').pop();
    const pos = end ? parseCellRef(end) : undefined;
    if (pos) grid.rowCount = Math.max(grid.rowCount, pos.row);
  }
  return grid;
}
