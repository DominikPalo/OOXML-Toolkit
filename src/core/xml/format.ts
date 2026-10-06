/**
 * Whitespace-safe XML pretty printer / minifier.
 *
 * The formatter only ever changes *ignorable* whitespace: the whitespace between the child
 * elements of an element that has no text of its own. Elements with text content (e.g. `<w:t>`,
 * `<a:t>`, `<v>`), mixed content, CDATA, or `xml:space="preserve"` are emitted verbatim.
 * Entities, quoting, attribute order and namespace prefixes are never touched (unless
 * `sortAttributes` is requested, which is meant for comparison only).
 */
import { XmlDocument, XmlElement, XmlNode, isWhitespaceOnly, parseXml } from './parser';

export interface FormatOptions {
  /** Indent unit. Default: two spaces. */
  indent?: string;
  /** Emit attributes in a canonical order (namespace declarations first, then alphabetical). */
  sortAttributes?: boolean;
}

/** Elements whose children can be re-indented without changing meaning. */
function isBlock(doc: XmlDocument, el: XmlElement): boolean {
  let structural = false;
  for (const c of el.children) {
    if (c.type === 'text') {
      const raw = doc.source.slice(c.start, c.end);
      // Non-blank text, or blank text without a line break (e.g. a lone space), is significant.
      if (!isWhitespaceOnly(raw) || raw.indexOf('\n') === -1) return false;
    } else if (c.type === 'cdata') {
      return false;
    } else {
      structural = true;
    }
  }
  if (!structural) return false;
  const space = el.attrs.find((a) => a.name === 'xml:space');
  return !(space && space.value === 'preserve');
}

function attrRank(name: string): [number, string] {
  if (name === 'xmlns') return [0, ''];
  if (name.startsWith('xmlns:')) return [1, name];
  return [2, name];
}

function startTag(doc: XmlDocument, el: XmlElement, sort: boolean): string {
  if (!sort || el.attrs.length < 2) return doc.source.slice(el.start, el.startTagEnd);
  const attrs = [...el.attrs].sort((a, b) => {
    const [ra, na] = attrRank(a.name);
    const [rb, nb] = attrRank(b.name);
    return ra - rb || (na < nb ? -1 : na > nb ? 1 : 0);
  });
  const body = attrs.map((a) => ' ' + doc.source.slice(a.start, a.end)).join('');
  return `<${el.name}${body}${el.selfClosing ? '/>' : '>'}`;
}

function raw(doc: XmlDocument, el: XmlElement, sort: boolean): string {
  if (!sort) return doc.source.slice(el.start, el.end);
  if (el.selfClosing) return startTag(doc, el, true);
  let out = startTag(doc, el, true);
  for (const c of el.children) {
    out += c.type === 'element' ? raw(doc, c, true) : doc.source.slice(c.start, c.end);
  }
  return out + doc.source.slice(el.closeStart, el.end);
}

export function formatXml(source: string, options: FormatOptions = {}): string {
  return formatDocument(parseXml(source), options);
}

export function formatDocument(doc: XmlDocument, options: FormatOptions = {}): string {
  const unit = options.indent ?? '  ';
  const sort = !!options.sortAttributes;
  const out: string[] = [];

  const emit = (node: XmlNode, depth: number): void => {
    const pad = unit.repeat(depth);
    if (node.type !== 'element') {
      if (node.type === 'comment' || node.type === 'pi')
        out.push(pad + doc.source.slice(node.start, node.end));
      return;
    }
    if (node.selfClosing || !isBlock(doc, node)) {
      out.push(pad + raw(doc, node, sort));
      return;
    }
    out.push(pad + startTag(doc, node, sort));
    for (const c of node.children) emit(c, depth + 1);
    out.push(pad + doc.source.slice(node.closeStart, node.end));
  };

  const lead = doc.source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (doc.declaration) out.push(doc.source.slice(doc.declaration.start, doc.declaration.end));
  const prologStart = doc.declaration ? doc.declaration.end : lead;
  const prolog = doc.source.slice(prologStart, doc.root.start).trim();
  if (prolog) out.push(prolog);
  emit(doc.root, 0);
  const epilog = doc.source.slice(doc.root.end).trim();
  if (epilog) out.push(epilog);
  return out.join('\n');
}

/** Remove ignorable inter-element whitespace (the inverse of {@link formatXml}). */
export function minifyXml(source: string): string {
  const doc = parseXml(source);
  const cuts: Array<[number, number]> = [];

  const walk = (el: XmlElement): void => {
    if (isBlock(doc, el)) {
      for (const c of el.children) if (c.type === 'text') cuts.push([c.start, c.end]);
    }
    for (const c of el.elements) walk(c);
  };
  walk(doc.root);
  cuts.sort((x, y) => x[0] - y[0]);

  const lead = doc.source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const head = doc.declaration
    ? doc.source.slice(doc.declaration.start, doc.declaration.end) + '\n'
    : '';
  const prolog = doc.source
    .slice(doc.declaration ? doc.declaration.end : lead, doc.root.start)
    .trim();
  let body = '';
  let pos = doc.root.start;
  for (const [a, b] of cuts) {
    body += doc.source.slice(pos, a);
    pos = b;
  }
  body += doc.source.slice(pos, doc.root.end);
  const epilog = doc.source.slice(doc.root.end).trim();
  return head + (prolog ? prolog + '\n' : '') + body + (epilog ? '\n' + epilog : '');
}
