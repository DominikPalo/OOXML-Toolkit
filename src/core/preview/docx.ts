/** Read-only text outline of a WordprocessingML document. */
import type { PartSource } from '../package/model';
import {
  child,
  getAttrLocal,
  textContent,
  tryParseXml,
  type XmlDocument,
  type XmlElement,
} from '../xml/parser';

export type DocBlock =
  | { type: 'paragraph'; text: string; style?: string; headingLevel?: number; list?: boolean }
  | { type: 'table'; rows: string[][] };

export interface DocContent {
  blocks: DocBlock[];
  truncated: boolean;
}

/** Elements whose content is not body text (properties, deletions, drawings, field codes, markers). */
const SKIP = new Set([
  'pPr',
  'rPr',
  'sdtPr',
  'sdtEndPr',
  'tblPr',
  'trPr',
  'tcPr',
  'del',
  'moveFrom',
  'delText',
  'instrText',
  'drawing',
  'pict',
  'object',
  'AlternateContent',
  'proofErr',
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
]);

function runText(doc: XmlDocument, el: XmlElement): string {
  let out = '';
  for (const c of el.elements) {
    switch (c.local) {
      case 't':
        out += textContent(doc, c);
        break;
      case 'tab':
        out += '\t';
        break;
      case 'br':
      case 'cr':
        out += '\n';
        break;
      case 'noBreakHyphen':
        out += '-';
        break;
      default:
        if (!SKIP.has(c.local)) out += runText(doc, c);
    }
  }
  return out;
}

function headingLevelOf(style: string | undefined): number | undefined {
  const m = style && /^heading\s*([1-9])$/i.exec(style);
  return m ? parseInt(m[1], 10) : undefined;
}

function paragraph(doc: XmlDocument, p: XmlElement): DocBlock {
  const pPr = child(p, 'pPr');
  const pStyle = pPr && child(pPr, 'pStyle');
  const styleName = pStyle ? getAttrLocal(pStyle, 'val') : undefined;
  return {
    type: 'paragraph',
    text: runText(doc, p),
    style: styleName,
    headingLevel: headingLevelOf(styleName),
    list: !!(pPr && child(pPr, 'numPr')),
  };
}

/** All paragraphs below `el` (including nested tables), in order. */
function collectParagraphs(doc: XmlDocument, el: XmlElement, out: string[]): void {
  for (const c of el.elements) {
    if (c.local === 'p') out.push(runText(doc, c));
    else if (!SKIP.has(c.local)) collectParagraphs(doc, c, out);
  }
}

function table(doc: XmlDocument, tbl: XmlElement): DocBlock {
  const rows: string[][] = [];
  for (const tr of tbl.elements) {
    if (tr.local !== 'tr') continue;
    const cells: string[] = [];
    for (const tc of tr.elements) {
      if (tc.local !== 'tc') continue;
      const texts: string[] = [];
      collectParagraphs(doc, tc, texts);
      cells.push(texts.join('\n'));
    }
    rows.push(cells);
  }
  return { type: 'table', rows };
}

export function readDocument(
  src: PartSource,
  part: string,
  limits: { maxBlocks?: number } = {},
): DocContent {
  const maxBlocks = limits.maxBlocks ?? 2000;
  const out: DocContent = { blocks: [], truncated: false };
  if (!src.has(part)) return out;
  const doc = tryParseXml(src.getText(part).text).doc;
  const body = doc && child(doc.root, 'body');
  if (!doc || !body) return out;

  const walk = (el: XmlElement): void => {
    for (const c of el.elements) {
      if (out.truncated) return;
      if (c.local === 'p' || c.local === 'tbl') {
        if (out.blocks.length >= maxBlocks) {
          out.truncated = true;
          return;
        }
        out.blocks.push(c.local === 'p' ? paragraph(doc, c) : table(doc, c));
      } else if (c.local === 'sdt') {
        const content = child(c, 'sdtContent');
        if (content) walk(content);
      } else if (c.local === 'customXml' || c.local === 'smartTag') {
        walk(c);
      }
    }
  };
  walk(body);
  return out;
}

export function readDocumentText(src: PartSource, part: string): string {
  const lines: string[] = [];
  for (const b of readDocument(src, part, { maxBlocks: Number.MAX_SAFE_INTEGER }).blocks) {
    if (b.type === 'paragraph') lines.push(b.text);
    else for (const row of b.rows) lines.push(row.join('\t'));
  }
  return lines.join('\n');
}
