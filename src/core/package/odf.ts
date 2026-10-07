/**
 * OpenDocument (ODF) packages: `.odt`, `.ods`, `.odp`, …
 *
 * ODF is ZIP + XML like OOXML, but it is organised differently: there are no relationships or content
 * types. Instead
 *  - `mimetype`               identifies the document type; it must be the FIRST entry and STORED
 *  - `META-INF/manifest.xml`  lists every part with its media type
 *  - `meta.xml`               holds the document properties (title, author, keywords, statistics, …)
 *  - `content.xml`            the document itself
 */
import type { PartSource } from './model';
import { extensionOf } from './kinds';
import type { Problem } from './validate';
import { insertFragment, setAttribute, applyEdits } from '../xml/edit';
import {
  child,
  childrenNamed,
  elementPath,
  escapeAttr,
  getAttrLocal,
  lookupNamespace,
  textContent,
  tryParseXml,
  type XmlDocument,
  type XmlElement,
} from '../xml/parser';

export const ODF_MIMETYPE_PART = 'mimetype';
export const ODF_MANIFEST_PART = 'META-INF/manifest.xml';
export const ODF_META_PART = 'meta.xml';
export const ODF_CONTENT_PART = 'content.xml';
const MANIFEST_NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';

/** A part's text, or `undefined` if it cannot be read (corrupt data); the package check says so. */
function tryText(src: PartSource, name: string): string | undefined {
  try {
    return src.getText(name).text;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

export interface ManifestEntry {
  /** Part name, or a folder name ending in `/`. */
  fullPath: string;
  mediaType: string;
  /** The entry has `manifest:encryption-data` (password protected). */
  encrypted: boolean;
  isDirectory: boolean;
  /** Element path of the entry inside the manifest. */
  path: number[];
}

export interface Manifest {
  /** Media type of the package itself (the `/` entry). */
  rootMediaType?: string;
  entries: ManifestEntry[];
  doc: XmlDocument;
}

export function parseManifest(text: string): Manifest | undefined {
  const doc = tryParseXml(text).doc;
  if (!doc || doc.root.local !== 'manifest') return undefined;
  const entries: ManifestEntry[] = [];
  let rootMediaType: string | undefined;
  for (const el of doc.root.elements) {
    if (el.local !== 'file-entry') continue;
    const fullPath = getAttrLocal(el, 'full-path') ?? '';
    const mediaType = getAttrLocal(el, 'media-type') ?? '';
    if (fullPath === '/') {
      rootMediaType = mediaType;
      continue;
    }
    entries.push({
      fullPath,
      mediaType,
      encrypted: !!child(el, 'encryption-data'),
      isDirectory: fullPath.endsWith('/'),
      path: elementPath(el),
    });
  }
  return { rootMediaType, entries, doc };
}

/** The parsed manifest; `undefined` if it is absent, unreadable or not a manifest. */
export function readManifest(src: PartSource): Manifest | undefined {
  const text = src.has(ODF_MANIFEST_PART) ? tryText(src, ODF_MANIFEST_PART) : undefined;
  return text === undefined ? undefined : parseManifest(text);
}

const MEDIA_TYPES: Record<string, string> = {
  xml: 'text/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  txt: 'text/plain',
  rdf: 'application/rdf+xml',
};

export function guessMediaType(name: string): string {
  return MEDIA_TYPES[extensionOf(name)] ?? 'application/octet-stream';
}

/** The manifest with an entry for `fullPath` added (unchanged if it already has one). */
export function manifestWithEntry(
  text: string,
  fullPath: string,
  mediaType = guessMediaType(fullPath),
): string | undefined {
  const m = parseManifest(text);
  if (!m) return undefined;
  if (m.entries.some((e) => e.fullPath === fullPath)) return text;
  const root = m.doc.root;
  // Elements take the root's prefix (none when the manifest namespace is the default one), but
  // attributes always need a prefix bound to the manifest namespace — declare one if there is none.
  const element = root.prefix ? `${root.prefix}:file-entry` : 'file-entry';
  const bound = manifestAttributePrefix(root);
  const prefix = bound ?? freePrefix(root);
  const declaration = bound === undefined ? ` xmlns:${prefix}="${MANIFEST_NS}"` : '';
  const fragment =
    `<${element}${declaration} ${prefix}:full-path="${escapeAttr(fullPath)}" ` +
    `${prefix}:media-type="${escapeAttr(mediaType)}"/>`;
  return applyEdits(text, [insertFragment(m.doc, root, 'lastChild', fragment)]);
}

/** A prefix that is bound to the manifest namespace where new entries are inserted. */
function manifestAttributePrefix(root: XmlElement): string | undefined {
  const declared = root.attrs
    .filter((a) => a.name.startsWith('xmlns:') && a.value === MANIFEST_NS)
    .map((a) => a.name.slice('xmlns:'.length));
  return declared.includes(root.prefix) ? root.prefix : declared[0];
}

/** `manifest`, or a variation of it that is not bound to some other namespace. */
function freePrefix(root: XmlElement): string {
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? 'manifest' : `manifest${i}`;
    if (lookupNamespace(root, candidate) === undefined) return candidate;
  }
}

/** The manifest with the entry `from` renamed to `to` (unchanged if there is no such entry). */
export function manifestWithRenamedEntry(
  text: string,
  from: string,
  to: string,
): string | undefined {
  const m = parseManifest(text);
  if (!m) return undefined;
  const entry = m.doc.root.elements.find(
    (el) => el.local === 'file-entry' && getAttrLocal(el, 'full-path') === from,
  );
  if (!entry) return text;
  const attr = entry.attrs.find((a) => a.name.endsWith('full-path'))!;
  return applyEdits(text, [setAttribute(m.doc, entry, attr.name, to)]);
}

// ---------------------------------------------------------------------------------------------
// Document properties (meta.xml)
// ---------------------------------------------------------------------------------------------

export interface OdfUserDefined {
  name: string;
  value: string;
  /** `text`, `number`, `date`, `time` or `yes/no`. */
  type: string;
  /** Element path of the property inside `meta.xml`. */
  path: number[];
}

export interface OdfMeta {
  part: string;
  title?: string;
  subject?: string;
  description?: string;
  /** Last editor (`dc:creator`). */
  creator?: string;
  initialCreator?: string;
  created?: string;
  modified?: string;
  generator?: string;
  language?: string;
  editingCycles?: string;
  /** ISO 8601 duration, e.g. `PT01H03M17S`. */
  editingDuration?: string;
  keywords: string[];
  /** `meta:document-statistic` attributes by local name (`page-count`, `word-count`, …). */
  statistics: Record<string, string>;
  userDefined: OdfUserDefined[];
}

const USER_TYPES: Record<string, string> = {
  float: 'number',
  date: 'date',
  time: 'time',
  boolean: 'yes/no',
  string: 'text',
};

export function readOdfMeta(src: PartSource): OdfMeta | undefined {
  const metaText = src.has(ODF_META_PART) ? tryText(src, ODF_META_PART) : undefined;
  if (metaText === undefined) return undefined;
  const doc = tryParseXml(metaText).doc;
  const meta = doc && child(doc.root, 'meta');
  if (!doc || !meta) return undefined;

  const text = (local: string): string | undefined => {
    const el = child(meta, local);
    const v = el ? textContent(doc, el).trim() : '';
    return v || undefined;
  };

  const keywords: string[] = [];
  for (const k of childrenNamed(meta, 'keyword')) {
    const v = textContent(doc, k).trim();
    if (v && !keywords.includes(v)) keywords.push(v);
  }

  const statistics: Record<string, string> = {};
  const stat = child(meta, 'document-statistic');
  if (stat) for (const a of stat.attrs) statistics[a.name.slice(a.name.indexOf(':') + 1)] = a.value;

  const userDefined: OdfUserDefined[] = [];
  for (const el of childrenNamed(meta, 'user-defined')) {
    const type = getAttrLocal(el, 'value-type') ?? 'string';
    userDefined.push({
      name: getAttrLocal(el, 'name') ?? '',
      value: textContent(doc, el).trim(),
      type: USER_TYPES[type] ?? type,
      path: elementPath(el),
    });
  }

  return {
    part: ODF_META_PART,
    title: text('title'),
    subject: text('subject'),
    description: text('description'),
    creator: text('creator'),
    initialCreator: text('initial-creator'),
    created: text('creation-date'),
    modified: text('date'),
    generator: text('generator'),
    language: text('language'),
    editingCycles: text('editing-cycles'),
    editingDuration: text('editing-duration'),
    keywords,
    statistics,
    userDefined,
  };
}

/** `PT01H03M17S` → `1 h 3 min 17 s`. Unparseable values are returned unchanged. */
export function humanDuration(iso: string): string {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?)?$/.exec(iso.trim());
  if (!m) return iso;
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((v) => Number(v ?? 0));
  const parts = [d && `${d} d`, h && `${h} h`, min && `${min} min`, s && `${s} s`].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 s';
}

export interface OdfOverviewRows {
  properties: Array<[string, string]>;
  application: Array<[string, string]>;
}

const STAT_LABELS: Array<[string, string]> = [
  ['object-count', 'Objects'],
  ['table-count', 'Tables'],
  ['image-count', 'Images'],
  ['paragraph-count', 'Paragraphs'],
  ['word-count', 'Words'],
  ['character-count', 'Characters'],
  ['cell-count', 'Cells'],
];

/** The rows shown under "Document properties" / "Application" on the overview of an ODF package. */
export function odfOverviewRows(meta: OdfMeta, extension?: string): OdfOverviewRows {
  const properties: Array<[string, string]> = [];
  const add = (label: string, value: string | undefined): void => {
    if (value) properties.push([label, value]);
  };
  add('Title', meta.title);
  add('Subject', meta.subject);
  add('Author', meta.initialCreator ?? meta.creator);
  if (meta.initialCreator && meta.creator && meta.creator !== meta.initialCreator)
    add('Last modified by', meta.creator);
  add('Keywords', meta.keywords.join(', '));
  add('Comments', meta.description);
  add('Created', meta.created);
  add('Modified', meta.modified);
  add('Language', meta.language);
  add('Editing cycles', meta.editingCycles);
  add('Editing time', meta.editingDuration ? humanDuration(meta.editingDuration) : undefined);

  const application: Array<[string, string]> = [];
  if (meta.generator) application.push(['Application', meta.generator]);
  const pages = meta.statistics['page-count'];
  if (pages)
    application.push([
      extension === 'odp' || extension === 'otp'
        ? 'Slides'
        : extension === 'ods' || extension === 'ots'
          ? 'Sheets'
          : 'Pages',
      pages,
    ]);
  for (const [key, label] of STAT_LABELS) {
    const v = meta.statistics[key];
    if (v && v !== '0') application.push([label, v]);
  }
  return { properties, application };
}

// ---------------------------------------------------------------------------------------------
// Package check
// ---------------------------------------------------------------------------------------------

interface ModelLike extends PartSource {
  entryInfo?(name: string): { method: number } | undefined;
  /** All entries including directories, in the order they are written. */
  entryOrder?(): string[];
}

/** Rules specific to ODF packages. */
export function checkOdfPackage(model: ModelLike): Problem[] {
  const problems: Problem[] = [];
  const names = model.names();
  const nameSet = new Set(names);
  const manifest = readManifest(model);

  // --- mimetype ---------------------------------------------------------------------------
  if (!nameSet.has(ODF_MIMETYPE_PART)) {
    problems.push({
      severity: 'error',
      code: 'odf-no-mimetype',
      message: 'The package has no "mimetype" entry, which identifies the document type.',
    });
  } else {
    // Directory entries count: `mimetype` has to precede them as well.
    const position = (model.entryOrder?.() ?? names).indexOf(ODF_MIMETYPE_PART) + 1;
    if (position !== 1) {
      problems.push({
        severity: 'error',
        code: 'odf-mimetype-order',
        message: `"mimetype" must be the first entry of the package (it is entry ${position}); tools such as \`file\` cannot recognise the document otherwise.`,
        part: ODF_MIMETYPE_PART,
      });
    }
    const info = model.entryInfo?.(ODF_MIMETYPE_PART);
    if (info && info.method !== 0) {
      problems.push({
        severity: 'error',
        code: 'odf-mimetype-compressed',
        message: '"mimetype" must be stored without compression, but it is compressed.',
        part: ODF_MIMETYPE_PART,
      });
    }
    let mime = '';
    try {
      mime = model.getText(ODF_MIMETYPE_PART).text;
    } catch (e) {
      problems.push({
        severity: 'error',
        code: 'unreadable',
        message: `Cannot read part: ${(e as Error).message}`,
        part: ODF_MIMETYPE_PART,
      });
    }
    if (mime !== mime.trim()) {
      problems.push({
        severity: 'warning',
        code: 'odf-mimetype-whitespace',
        message:
          '"mimetype" has leading or trailing whitespace (a line break counts); it should contain only the media type.',
        part: ODF_MIMETYPE_PART,
      });
    }
    if (manifest?.rootMediaType && manifest.rootMediaType !== mime.trim()) {
      problems.push({
        severity: 'warning',
        code: 'odf-mimetype-mismatch',
        message: `"mimetype" says ${mime.trim() || '(empty)'} but the manifest declares ${manifest.rootMediaType}.`,
        part: ODF_MANIFEST_PART,
      });
    }
  }

  // --- manifest ---------------------------------------------------------------------------
  if (!nameSet.has(ODF_MANIFEST_PART)) {
    problems.push({
      severity: 'error',
      code: 'odf-no-manifest',
      message: `The package has no ${ODF_MANIFEST_PART}, the list of its parts.`,
    });
  } else if (!manifest) {
    // Unreadable or not well-formed manifests are reported with the other XML parts; this is the
    // case of well-formed XML that is not a manifest.
    const text = tryText(model, ODF_MANIFEST_PART);
    const root = text === undefined ? undefined : tryParseXml(text).doc?.root;
    if (root) {
      problems.push({
        severity: 'error',
        code: 'odf-manifest-invalid',
        message: `${ODF_MANIFEST_PART} is not an ODF manifest: its root element is <${root.name}>, not <manifest:manifest>.`,
        part: ODF_MANIFEST_PART,
      });
    }
  } else {
    const listed = new Set<string>();
    for (const e of manifest.entries) {
      if (e.isDirectory) continue;
      listed.add(e.fullPath);
      if (!nameSet.has(e.fullPath)) {
        problems.push({
          severity: 'error',
          code: 'odf-manifest-missing-part',
          message: `The manifest lists "${e.fullPath}", which is not in the package.`,
          part: ODF_MANIFEST_PART,
        });
      }
      if (e.encrypted) {
        problems.push({
          severity: 'info',
          code: 'odf-encrypted',
          message: `"${e.fullPath}" is encrypted (password protected); its content cannot be shown.`,
          part: nameSet.has(e.fullPath) ? e.fullPath : ODF_MANIFEST_PART,
        });
      }
    }
    for (const n of names) {
      if (n === ODF_MIMETYPE_PART || n.startsWith('META-INF/') || listed.has(n)) continue;
      problems.push({
        severity: 'warning',
        code: 'odf-not-in-manifest',
        message: `"${n}" is not listed in ${ODF_MANIFEST_PART}; Office programs may ignore it.`,
        part: n,
      });
    }
  }

  if (!nameSet.has(ODF_CONTENT_PART)) {
    problems.push({
      severity: 'warning',
      code: 'odf-no-content',
      message: 'The package has no content.xml, which holds the document itself.',
    });
  }
  return problems;
}

/** What the package check looks for, worded for the kind of package. */
export function packageCheckSummary(family: string): string {
  return family === 'odf'
    ? 'Looks for malformed XML, a missing or compressed mimetype entry, and parts that do not match META-INF/manifest.xml.'
    : 'Looks for malformed XML, dangling relationships, missing content types and unreferenced parts.';
}
