/**
 * "Tags" of a document: the metadata that people, add-ins and Office itself attach to a package.
 *
 *  - keywords / categories    `docProps/core.xml`   (what Explorer and Finder show as "Tags")
 *  - custom properties        `docProps/custom.xml`  (name / typed value; classification labels, add-in data)
 *  - PowerPoint tags          `ppt/tags/tagN.xml`    (name / value pairs on the presentation and its slides)
 *  - Word document variables  `word/settings.xml`    (`w:docVars`)
 *
 * Everything is found through relationships, so non-standard part names work too.
 */
import type { PartSource } from './model';
import { analyzePackage, type PackageAnalysis } from './opc';
import { baseName } from './kinds';
import {
  child,
  elementPath,
  getAttr,
  getAttrLocal,
  textContent,
  tryParseXml,
  type XmlDocument,
  type XmlElement,
} from '../xml/parser';

/** Where a tag lives, so the UI can jump to its XML. */
export interface TagSource {
  part: string;
  /** Element index path inside the part (see `elementPath`). */
  path: number[];
}

export interface TagEntry extends TagSource {
  name: string;
  value: string;
  /** Property type for custom properties (`text`, `number`, `yes/no`, `date`, …). */
  type?: string;
  /** What the tag belongs to: `Presentation`, `Slide 3`, `Slide master`, … */
  scope?: string;
}

export interface DocumentTags {
  /** Individual keywords (split at `;`, `,` and line breaks). */
  keywords: string[];
  keywordsSource?: TagSource;
  categories: string[];
  categoriesSource?: TagSource;
  customProperties: TagEntry[];
  /** PowerPoint tags (presentation, slides, masters). */
  presentationTags: TagEntry[];
  documentVariables: TagEntry[];
  /** Number of items across all groups. */
  total: number;
  /** True when more tags exist than are listed. */
  truncated: boolean;
}

const MAX_ENTRIES = 2000;

function parse(src: PartSource, part: string | undefined): XmlDocument | undefined {
  return part && src.has(part) ? tryParseXml(src.getText(part).text).doc : undefined;
}

/** Target of the first relationship of `type` (suffix match) owned by `source`, falling back to `fallback`. */
function related(
  analysis: PackageAnalysis,
  src: PartSource,
  source: string,
  typeSuffix: string,
  fallback?: string,
): string | undefined {
  const rel = analysis.relationships
    .get(source)
    ?.find((r) => r.type.endsWith(typeSuffix) && r.resolved !== undefined && src.has(r.resolved));
  return rel?.resolved ?? (fallback && src.has(fallback) ? fallback : undefined);
}

export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[;,\n\r]+/)) {
    const v = part.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

const VT_TYPES: Record<string, string> = {
  lpwstr: 'text',
  lpstr: 'text',
  bstr: 'text',
  i1: 'number',
  i2: 'number',
  i4: 'number',
  i8: 'number',
  int: 'number',
  ui1: 'number',
  ui2: 'number',
  ui4: 'number',
  ui8: 'number',
  uint: 'number',
  r4: 'number',
  r8: 'number',
  decimal: 'number',
  bool: 'yes/no',
  filetime: 'date',
  date: 'date',
  clsid: 'id',
  cy: 'currency',
  blob: 'binary',
  vector: 'list',
  array: 'list',
};

function readCustomProperties(src: PartSource, analysis: PackageAnalysis, out: TagEntry[]): void {
  const part = related(analysis, src, '', '/custom-properties', 'docProps/custom.xml');
  const doc = parse(src, part);
  if (!doc || !part) return;
  for (const prop of doc.root.elements) {
    if (prop.local !== 'property') continue;
    const valueEl = prop.elements[0];
    const kind = valueEl?.local ?? '';
    let value = valueEl ? textContent(doc, valueEl).trim() : '';
    if (kind === 'bool') value = /^(1|true)$/i.test(value) ? 'true' : 'false';
    out.push({
      name: getAttr(prop, 'name') ?? '',
      value,
      type: VT_TYPES[kind] ?? (kind || 'unknown'),
      part,
      path: elementPath(prop),
    });
  }
}

function readDocumentVariables(src: PartSource, analysis: PackageAnalysis, out: TagEntry[]): void {
  const main = analysis.mainPart;
  if (!main) return;
  const part = related(analysis, src, main, '/settings');
  const doc = parse(src, part);
  const vars = doc && child(doc.root, 'docVars');
  if (!doc || !vars || !part) return;
  for (const v of vars.elements) {
    if (v.local !== 'docVar') continue;
    out.push({
      name: getAttrLocal(v, 'name') ?? '',
      value: getAttrLocal(v, 'val') ?? '',
      part,
      path: elementPath(v),
    });
  }
}

/** `rId → slide part` in presentation order, to label slide tags as "Slide N". */
function slideNumbers(src: PartSource, analysis: PackageAnalysis): Map<string, number> {
  const numbers = new Map<string, number>();
  const main = analysis.mainPart;
  const doc = parse(src, main);
  const list = doc && child(doc.root, 'sldIdLst');
  if (!main || !list) return numbers;
  const rels = analysis.relationships.get(main) ?? [];
  for (const el of list.elements) {
    const rid = el.attrs.find((a) => a.name.endsWith(':id'))?.value;
    const target = rels.find((r) => r.id === rid)?.resolved;
    if (target) numbers.set(target, numbers.size + 1);
  }
  return numbers;
}

function scopeLabel(
  source: string,
  analysis: PackageAnalysis,
  slides: Map<string, number>,
): string {
  if (source === analysis.mainPart) return 'Presentation';
  const n = slides.get(source);
  if (n !== undefined) return `Slide ${n}`;
  if (source.includes('/slideMasters/')) return 'Slide master';
  if (source.includes('/slideLayouts/')) return 'Slide layout';
  if (source.includes('/notesSlides/')) return 'Notes';
  return baseName(source);
}

function scopeOrder(scope: string): number {
  if (scope === 'Presentation') return 0;
  const m = /^Slide (\d+)$/.exec(scope);
  return m ? 1 + Number(m[1]) / 1e6 : 2;
}

function readPresentationTags(
  src: PartSource,
  analysis: PackageAnalysis,
  out: TagEntry[],
): boolean {
  const slides = slideNumbers(src, analysis);
  const found: TagEntry[] = [];
  let truncated = false;
  outer: for (const [source, rels] of analysis.relationships) {
    for (const rel of rels) {
      if (!rel.type.endsWith('/tags') || rel.resolved === undefined) continue;
      const doc = parse(src, rel.resolved);
      if (!doc) continue;
      const scope = scopeLabel(source, analysis, slides);
      for (const tag of doc.root.elements) {
        if (tag.local !== 'tag') continue;
        if (found.length >= MAX_ENTRIES) {
          truncated = true;
          break outer;
        }
        found.push({
          name: getAttr(tag, 'name') ?? '',
          value: getAttr(tag, 'val') ?? '',
          scope,
          part: rel.resolved,
          path: elementPath(tag),
        });
      }
    }
  }
  // Stable, readable order: presentation, slides in order, then masters/layouts; tags in file order.
  found.sort((a, b) => scopeOrder(a.scope!) - scopeOrder(b.scope!));
  out.push(...found);
  return truncated;
}

function readCoreList(
  src: PartSource,
  analysis: PackageAnalysis,
  local: string,
): { values: string[]; source?: TagSource } {
  const part = related(analysis, src, '', '/core-properties', 'docProps/core.xml');
  const doc = parse(src, part);
  const el: XmlElement | undefined = doc && child(doc.root, local);
  if (!doc || !el || !part) return { values: [] };
  return { values: splitList(textContent(doc, el)), source: { part, path: elementPath(el) } };
}

export function readDocumentTags(
  src: PartSource,
  analysis: PackageAnalysis = analyzePackage(src),
): DocumentTags {
  const keywords = readCoreList(src, analysis, 'keywords');
  const categories = readCoreList(src, analysis, 'category');
  const customProperties: TagEntry[] = [];
  const presentationTags: TagEntry[] = [];
  const documentVariables: TagEntry[] = [];
  readCustomProperties(src, analysis, customProperties);
  readDocumentVariables(src, analysis, documentVariables);
  const truncated = readPresentationTags(src, analysis, presentationTags);

  return {
    keywords: keywords.values,
    keywordsSource: keywords.source,
    categories: categories.values,
    categoriesSource: categories.source,
    customProperties,
    presentationTags,
    documentVariables,
    total:
      keywords.values.length +
      categories.values.length +
      customProperties.length +
      presentationTags.length +
      documentVariables.length,
    truncated,
  };
}
