/** Classification of package parts: how they should be displayed and what can be done with them. */
import { looksLikeZip } from '../zip/zip';

export type PartKind = 'xml' | 'rels' | 'image' | 'text' | 'package' | 'binary';

const XML_EXT = new Set([
  'xml',
  'rels',
  'vml',
  'xsd',
  'xsl',
  'xslt',
  'rdf',
  'config',
  'dgm',
  'mml',
  'fodt',
  'fods',
  'fodp',
]);
const TEXT_EXT = new Set([
  'txt',
  'csv',
  'tsv',
  'json',
  'css',
  'js',
  'html',
  'htm',
  'md',
  'ini',
  'log',
  'yaml',
  'yml',
]);
const IMAGE_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'emf',
  'wmf',
]);
const PACKAGE_EXT = new Set([
  'docx',
  'docm',
  'xlsx',
  'xlsm',
  'pptx',
  'pptm',
  'dotx',
  'xltx',
  'potx',
  'zip',
  'vsdx',
]);

/** Image formats Chromium can render in an <img>. */
const NATIVE_PREVIEWABLE = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico']);
/** Windows metafiles: previewed by converting them to SVG first (`core/preview/metafile`). */
const METAFILE = new Set(['emf', 'wmf']);

export function extensionOf(name: string): string {
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  return dot > slash ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

export function partKind(name: string, contentType?: string, head?: Uint8Array): PartKind {
  const ext = extensionOf(name);
  if (ext === 'rels') return 'rels';
  if (ext === 'svg') return 'image';
  if (XML_EXT.has(ext)) return 'xml';
  if (
    contentType &&
    (contentType.endsWith('+xml') ||
      contentType === 'application/xml' ||
      contentType === 'text/xml')
  ) {
    return 'xml';
  }
  if (IMAGE_EXT.has(ext) || contentType?.startsWith('image/')) return 'image';
  if (PACKAGE_EXT.has(ext) || contentType?.endsWith('officedocument.package')) return 'package';
  if (TEXT_EXT.has(ext) || contentType?.startsWith('text/')) return 'text';
  if (head) {
    if (looksLikeZip(head)) return 'package';
    if (looksLikeText(head)) return 'text';
  }
  return 'binary';
}

/** Images the app can show: natively in an <img>, or after converting a metafile to SVG. */
export function isPreviewableImage(name: string): boolean {
  const ext = extensionOf(name);
  return NATIVE_PREVIEWABLE.has(ext) || METAFILE.has(ext);
}

/** EMF / WMF: needs `metafileToSvg` before an <img> can show it. */
export function isMetafile(name: string): boolean {
  return METAFILE.has(extensionOf(name));
}

export function imageMime(name: string): string {
  switch (extensionOf(name)) {
    case 'svg':
      return 'image/svg+xml';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'ico':
      return 'image/x-icon';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'emf':
      return 'image/emf';
    case 'wmf':
      return 'image/wmf';
    default:
      return `image/${extensionOf(name) || 'png'}`;
  }
}

/** Heuristic: mostly printable, no NULs in the first few KB. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  if (n === 0) return true;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return odd / n < 0.02;
}

/** Extension → content type, for parts added by the user. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  xml: 'application/xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
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
  bin: 'application/vnd.openxmlformats-officedocument.oleObject',
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
  vml: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
};

export function guessContentType(name: string): string {
  return CONTENT_TYPE_BY_EXT[extensionOf(name)] ?? 'application/octet-stream';
}
