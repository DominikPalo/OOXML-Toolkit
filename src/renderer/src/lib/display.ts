/**
 * The text a part is *shown* as. Search hits, editor reveals and highlights must all agree on it,
 * so everything goes through here. With pretty-printing on, XML parts are shown re-indented
 * (the model itself is only changed when the user edits).
 */
import type { PartSource } from '@core/package/model';
import { baseName, extensionOf } from '@core/package/kinds';
import { formatXml } from '@core/xml/format';
import type { DecodedText } from '@core/text';

const XML_LIKE = new Set([
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
]);

export const isXmlName = (name: string, contentType?: string): boolean =>
  XML_LIKE.has(extensionOf(name)) ||
  !!contentType?.endsWith('+xml') ||
  baseName(name) === '[Content_Types].xml';

const cache = new Map<string, { raw: string; pretty: string }>();

export function prettyText(key: string, raw: string): string {
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.pretty;
  let pretty: string;
  try {
    pretty = formatXml(raw);
  } catch {
    pretty = raw;
  }
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  cache.set(key, { raw, pretty });
  return pretty;
}

export function displayText(
  src: PartSource,
  part: string,
  pretty: boolean,
  contentType?: string,
): string {
  const raw = src.getText(part).text;
  return pretty && isXmlName(part, contentType) ? prettyText(part, raw) : raw;
}

/** A `PartSource` whose text is the displayed (pretty-printed) text, for search. */
export function prettySource(
  src: PartSource,
  contentTypeOf: (name: string) => string | undefined,
): PartSource {
  return {
    label: src.label,
    names: () => src.names(),
    has: (n) => src.has(n),
    size: (n) => src.size(n),
    knownCrc: (n) => src.knownCrc(n),
    getBytes: (n) => src.getBytes(n),
    getText: (n): DecodedText => {
      const t = src.getText(n);
      return isXmlName(n, contentTypeOf(n)) ? { ...t, text: prettyText(n, t.text) } : t;
    },
  };
}
