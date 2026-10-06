/** Open Packaging Conventions: content types, relationships, package family detection. */
import type { PartSource } from './model';
import { decodeEntities, tryParseXml } from '../xml/parser';

export const CONTENT_TYPES_PART = '[Content_Types].xml';
export const PACKAGE_RELS_PART = '_rels/.rels';

export interface ContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
}

export function parseContentTypes(xml: string): ContentTypes {
  const out: ContentTypes = { defaults: new Map(), overrides: new Map() };
  const r = tryParseXml(xml);
  if (!r.doc) return out;
  for (const el of r.doc.root.elements) {
    const ct = el.attrs.find((a) => a.name === 'ContentType')?.value;
    if (!ct) continue;
    if (el.local === 'Default') {
      const ext = el.attrs.find((a) => a.name === 'Extension')?.value;
      if (ext) out.defaults.set(ext.toLowerCase(), ct);
    } else if (el.local === 'Override') {
      const pn = el.attrs.find((a) => a.name === 'PartName')?.value;
      if (pn) out.overrides.set(pn.replace(/^\//, ''), ct);
    }
  }
  return out;
}

export function contentTypeOf(types: ContentTypes, partName: string): string | undefined {
  const o = types.overrides.get(partName);
  if (o) return o;
  const dot = partName.lastIndexOf('.');
  if (dot === -1 || dot < partName.lastIndexOf('/')) return undefined;
  return types.defaults.get(partName.slice(dot + 1).toLowerCase());
}

export interface Relationship {
  id: string;
  type: string;
  /** Raw `Target` attribute. */
  target: string;
  external: boolean;
  /** Part that owns the relationships (`''` for the package itself). */
  source: string;
  /** The `.rels` part this relationship is stored in. */
  relsPart: string;
  /** Resolved target part name; undefined for external links and fragment-only targets. */
  resolved?: string;
}

export function relsPartFor(partName: string): string {
  if (partName === '') return PACKAGE_RELS_PART;
  const slash = partName.lastIndexOf('/');
  const dir = slash === -1 ? '' : partName.slice(0, slash + 1);
  const file = partName.slice(slash + 1);
  return `${dir}_rels/${file}.rels`;
}

/** The part a `.rels` part belongs to (`''` for the package-level relationships). */
export function sourceOfRels(relsPart: string): string | undefined {
  if (relsPart === PACKAGE_RELS_PART) return '';
  const m = /^(.*)_rels\/([^/]+)\.rels$/.exec(relsPart);
  return m ? m[1] + m[2] : undefined;
}

export function resolveTarget(source: string, target: string): string {
  // Strip the fragment from the raw URI first: an encoded `%23` is part of the name, a literal `#` is not.
  const hash = target.indexOf('#');
  let t = safeDecode(hash === -1 ? target : target.slice(0, hash)).replace(/\\/g, '/');
  const segments: string[] = [];
  if (!t.startsWith('/')) {
    const slash = source.lastIndexOf('/');
    if (slash !== -1) segments.push(...source.slice(0, slash).split('/'));
  }
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}

/** Percent-encode a part path the way it appears in URIs (`Target`, `PartName`). `/` is kept. */
export function encodePartUri(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join('/');
}

/** Why `name` cannot be used as a part name, or `undefined` if it is fine. */
export function partNameProblem(name: string): string | undefined {
  if (!name) return 'Enter a name.';
  if (/[\\?#]/.test(name)) return 'A part name cannot contain \\, ? or #.';
  if (/^\/|\/$|\/\//.test(name))
    return 'A part name cannot start or end with “/” or contain empty segments.';
  if (name.split('/').some((seg) => seg === '.' || seg === '..'))
    return 'A part name cannot contain “.” or “..” segments.';
  if (/[\u0000-\u001f]/.test(name)) return 'A part name cannot contain control characters.';
  return undefined;
}

/** The `Target` value (relative to the source part's directory) that points at `target`. */
export function relativeTarget(sourcePart: string, target: string): string {
  const fromDir = sourcePart.includes('/')
    ? sourcePart.slice(0, sourcePart.lastIndexOf('/')).split('/')
    : [];
  const to = target.split('/');
  let i = 0;
  while (i < fromDir.length && i < to.length - 1 && fromDir[i] === to[i]) i++;
  return [...Array<string>(fromDir.length - i).fill('..'), ...to.slice(i)].join('/');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseRelationships(xml: string, source: string, relsPart: string): Relationship[] {
  const r = tryParseXml(xml);
  if (!r.doc) return [];
  const out: Relationship[] = [];
  for (const el of r.doc.root.elements) {
    if (el.local !== 'Relationship') continue;
    const get = (n: string): string =>
      decodeEntities(el.attrs.find((a) => a.name === n)?.value ?? '');
    const external = get('TargetMode').toLowerCase() === 'external';
    const target = get('Target');
    // Fragment-only targets (`#'Sheet1'!A1`, written by Excel for in-document hyperlinks) and
    // absolute URIs (`mailto:`, `https:`) do not refer to a part, even without TargetMode="External".
    const notAPart = external || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target);
    out.push({
      id: get('Id'),
      type: get('Type'),
      target,
      external,
      source,
      relsPart,
      resolved: notAPart ? undefined : resolveTarget(source, target),
    });
  }
  return out;
}

export function shortRelType(type: string): string {
  const i = type.lastIndexOf('/');
  return i === -1 ? type : type.slice(i + 1);
}

// ---------------------------------------------------------------------------------------------

export type PackageFamily = 'word' | 'excel' | 'powerpoint' | 'visio' | 'odf' | 'unknown';

export interface PackageType {
  family: PackageFamily;
  /** Typical extension, when it can be told from the content type. */
  extension?: string;
  label: string;
}

const MAIN_TYPES: Array<[string, PackageType]> = [
  [
    'wordprocessingml.document.main+xml',
    { family: 'word', extension: 'docx', label: 'Word document' },
  ],
  [
    'wordprocessingml.document.macroEnabled.main+xml',
    { family: 'word', extension: 'docm', label: 'Word macro-enabled document' },
  ],
  [
    'wordprocessingml.template.main+xml',
    { family: 'word', extension: 'dotx', label: 'Word template' },
  ],
  [
    'wordprocessingml.template.macroEnabledTemplate.main+xml',
    { family: 'word', extension: 'dotm', label: 'Word macro-enabled template' },
  ],
  ['spreadsheetml.sheet.main+xml', { family: 'excel', extension: 'xlsx', label: 'Excel workbook' }],
  [
    'spreadsheetml.sheet.macroEnabled.main+xml',
    { family: 'excel', extension: 'xlsm', label: 'Excel macro-enabled workbook' },
  ],
  [
    'spreadsheetml.template.main+xml',
    { family: 'excel', extension: 'xltx', label: 'Excel template' },
  ],
  [
    'spreadsheetml.template.macroEnabledTemplate.main+xml',
    { family: 'excel', extension: 'xltm', label: 'Excel macro-enabled template' },
  ],
  [
    'presentationml.presentation.main+xml',
    { family: 'powerpoint', extension: 'pptx', label: 'PowerPoint presentation' },
  ],
  [
    'presentationml.slideshow.main+xml',
    { family: 'powerpoint', extension: 'ppsx', label: 'PowerPoint slide show' },
  ],
  [
    'presentationml.template.main+xml',
    { family: 'powerpoint', extension: 'potx', label: 'PowerPoint template' },
  ],
  [
    'presentation.macroEnabled.main+xml',
    { family: 'powerpoint', extension: 'pptm', label: 'PowerPoint macro-enabled presentation' },
  ],
  ['visio.drawing.main+xml', { family: 'visio', extension: 'vsdx', label: 'Visio drawing' }],
];

const ODF_TYPES: Record<string, PackageType> = {
  'application/vnd.oasis.opendocument.text': {
    family: 'odf',
    extension: 'odt',
    label: 'OpenDocument text',
  },
  'application/vnd.oasis.opendocument.spreadsheet': {
    family: 'odf',
    extension: 'ods',
    label: 'OpenDocument spreadsheet',
  },
  'application/vnd.oasis.opendocument.presentation': {
    family: 'odf',
    extension: 'odp',
    label: 'OpenDocument presentation',
  },
  'application/vnd.oasis.opendocument.graphics': {
    family: 'odf',
    extension: 'odg',
    label: 'OpenDocument drawing',
  },
};

export interface PackageAnalysis {
  structureVersion: number;
  contentTypes: ContentTypes;
  type: PackageType;
  /** Main document part (target of the `officeDocument` relationship). */
  mainPart?: string;
  /** Relationships by owning part (`''` = package). */
  relationships: Map<string, Relationship[]>;
  /** Internal relationships by resolved target part. */
  incoming: Map<string, Relationship[]>;
  /** All `.rels` parts that could be parsed. */
  relsParts: string[];
}

export function analyzePackage(src: PartSource, structureVersion = 0): PackageAnalysis {
  const names = src.names();
  const nameSet = new Set(names);

  let contentTypes: ContentTypes = { defaults: new Map(), overrides: new Map() };
  if (nameSet.has(CONTENT_TYPES_PART))
    contentTypes = parseContentTypes(src.getText(CONTENT_TYPES_PART).text);

  const relationships = new Map<string, Relationship[]>();
  const incoming = new Map<string, Relationship[]>();
  const relsParts: string[] = [];
  for (const n of names) {
    if (!n.endsWith('.rels')) continue;
    const source = sourceOfRels(n);
    if (source === undefined) continue;
    relsParts.push(n);
    const rels = parseRelationships(src.getText(n).text, source, n);
    relationships.set(source, rels);
    for (const r of rels) {
      if (r.resolved === undefined) continue;
      const list = incoming.get(r.resolved) ?? [];
      list.push(r);
      incoming.set(r.resolved, list);
    }
  }

  const mainRel = relationships
    .get('')
    ?.find((r) => r.type.endsWith('/officeDocument') || r.type.endsWith('/document'));
  const mainPart =
    mainRel?.resolved && nameSet.has(mainRel.resolved) ? mainRel.resolved : undefined;

  let type: PackageType = { family: 'unknown', label: 'ZIP package' };
  const mainCt = mainPart ? contentTypeOf(contentTypes, mainPart) : undefined;
  if (mainCt) {
    const hit = MAIN_TYPES.find(([suffix]) => mainCt.endsWith(suffix));
    if (hit) type = hit[1];
    else type = { family: 'unknown', label: 'Open Packaging Conventions package' };
  } else if (nameSet.has('mimetype')) {
    const mime = src.getText('mimetype').text.trim();
    type = ODF_TYPES[mime] ?? { family: 'odf', label: 'OpenDocument package' };
  } else if (nameSet.has(CONTENT_TYPES_PART)) {
    type = { family: 'unknown', label: 'Open Packaging Conventions package' };
  }

  return {
    structureVersion,
    contentTypes,
    type,
    mainPart,
    relationships,
    incoming,
    relsParts,
  };
}
