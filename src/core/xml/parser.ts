/**
 * A small, strict, offset-preserving XML parser.
 *
 * Unlike DOMParser it keeps the exact source range of every node. That lets us
 *  - highlight an element in the source editor,
 *  - apply element-level edits as precise text splices (the rest of the document stays
 *    byte-for-byte identical, including formatting, quoting and entity usage),
 *  - report well-formedness errors with line/column.
 *
 * It does not validate against a DTD/schema and does not expand custom entities.
 */

export interface XmlAttr {
  /** Qualified name, e.g. `xml:space`. */
  name: string;
  /** Entity-decoded value. */
  value: string;
  /** Offset of the first character of the attribute name. */
  start: number;
  /** Offset just past the closing quote. */
  end: number;
  /** Offset of the first value character (just past the opening quote). */
  valueStart: number;
  /** Offset of the closing quote. */
  valueEnd: number;
}

export interface XmlElement {
  type: 'element';
  /** Qualified name, e.g. `w:p`. */
  name: string;
  prefix: string;
  local: string;
  attrs: XmlAttr[];
  /** All child nodes in document order (elements, text, comments, CDATA, PIs). */
  children: XmlNode[];
  /** Only the element children, in order. */
  elements: XmlElement[];
  parent: XmlElement | null;
  /** Index within `parent.elements` (0 for the root). */
  index: number;
  /** Offset of `<`. */
  start: number;
  /** Offset just past the element name in the start tag. */
  nameEnd: number;
  /** Offset just past `>` of the start tag. */
  startTagEnd: number;
  /** Offset of `</` of the end tag, or -1 for self-closing elements. */
  closeStart: number;
  /** Offset just past the element (past `>` of the end tag, or `/>`). */
  end: number;
  selfClosing: boolean;
}

export interface XmlLeaf {
  type: 'text' | 'cdata' | 'comment' | 'pi';
  start: number;
  end: number;
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | XmlLeaf;

export interface XmlDeclaration {
  version?: string;
  encoding?: string;
  standalone?: string;
  start: number;
  end: number;
}

export interface XmlDocument {
  source: string;
  root: XmlElement;
  declaration?: XmlDeclaration;
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'XmlParseError';
  }
  /** Message without the position suffix. */
  get reason(): string {
    return this.message.replace(/ \(line \d+, column \d+\)$/, '');
  }
}

export function lineColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, source.length);
  for (let i = source.indexOf('\n'); i !== -1 && i < end; i = source.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, column: end - last };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/;

export function decodeEntities(raw: string): string {
  if (raw.indexOf('&') === -1) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[body] ?? m;
  });
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

function isNameChar(c: number): boolean {
  return (
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    (c >= 48 && c <= 57) || // 0-9
    c === 95 || // _
    c === 58 || // :
    c === 45 || // -
    c === 46 || // .
    c >= 0x80
  );
}

function isNameStart(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 58 || c >= 0x80;
}

function isWs(c: number): boolean {
  return c === 32 || c === 10 || c === 9 || c === 13;
}

export function isWhitespaceOnly(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (!isWs(s.charCodeAt(i))) return false;
  return true;
}

export function parseXml(source: string): XmlDocument {
  const n = source.length;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  function fail(message: string, at: number): never {
    const { line, column } = lineColumn(source, at);
    throw new XmlParseError(message, at, line, column);
  }

  let declaration: XmlDeclaration | undefined;
  if (source.startsWith('<?xml', i) && isWs(source.charCodeAt(i + 5))) {
    const close = source.indexOf('?>', i);
    if (close === -1) fail('Unterminated XML declaration', i);
    const body = source.slice(i + 5, close);
    declaration = { start: i, end: close + 2 };
    for (const m of body.matchAll(/([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      (declaration as unknown as Record<string, string>)[m[1]] = m[2] ?? m[3];
    }
    i = close + 2;
  }

  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const addChild = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    node.parent = parent ?? null;
    if (parent) parent.children.push(node);
  };

  while (i < n) {
    if (source.charCodeAt(i) !== 60 /* < */) {
      // Character data up to the next markup.
      let j = source.indexOf('<', i);
      if (j === -1) j = n;
      const raw = source.slice(i, j);
      if (stack.length === 0) {
        if (!isWhitespaceOnly(raw)) fail('Text content outside of the root element', i);
      } else {
        if (raw.indexOf('&') !== -1) {
          const m = BAD_ENTITY.exec(raw);
          if (m) fail('Invalid or undefined entity reference', i + m.index);
        }
        if (raw.indexOf(']]>') !== -1)
          fail('"]]>" is not allowed in character data', i + raw.indexOf(']]>'));
        addChild({ type: 'text', start: i, end: j, parent: null });
      }
      i = j;
      continue;
    }

    const next = source.charCodeAt(i + 1);

    if (next === 47 /* / */) {
      // End tag
      let j = i + 2;
      const nameStart = j;
      while (j < n && isNameChar(source.charCodeAt(j))) j++;
      const name = source.slice(nameStart, j);
      while (j < n && isWs(source.charCodeAt(j))) j++;
      if (source.charCodeAt(j) !== 62) fail('Malformed end tag', i);
      const top = stack[stack.length - 1];
      if (!top) fail(`Unexpected end tag </${name}>`, i);
      if (top.name !== name)
        fail(`Mismatched end tag: expected </${top.name}> but found </${name}>`, i);
      top.closeStart = i;
      top.end = j + 1;
      stack.pop();
      i = j + 1;
      continue;
    }

    if (next === 33 /* ! */) {
      if (source.startsWith('<!--', i)) {
        const close = source.indexOf('-->', i + 4);
        if (close === -1) fail('Unterminated comment', i);
        if (stack.length) addChild({ type: 'comment', start: i, end: close + 3, parent: null });
        i = close + 3;
      } else if (source.startsWith('<![CDATA[', i)) {
        if (!stack.length) fail('CDATA section outside of the root element', i);
        const close = source.indexOf(']]>', i + 9);
        if (close === -1) fail('Unterminated CDATA section', i);
        addChild({ type: 'cdata', start: i, end: close + 3, parent: null });
        i = close + 3;
      } else if (source.startsWith('<!DOCTYPE', i)) {
        if (root || stack.length) fail('Unexpected DOCTYPE declaration', i);
        // Skip, honouring an optional internal subset in [...].
        let depth = 0;
        let j = i + 9;
        for (; j < n; j++) {
          const c = source.charCodeAt(j);
          if (c === 91) depth++;
          else if (c === 93) depth--;
          else if (c === 62 && depth <= 0) break;
        }
        if (j >= n) fail('Unterminated DOCTYPE declaration', i);
        i = j + 1;
      } else {
        fail('Unexpected markup declaration', i);
      }
      continue;
    }

    if (next === 63 /* ? */) {
      const close = source.indexOf('?>', i + 2);
      if (close === -1) fail('Unterminated processing instruction', i);
      if (/^<\?xml[\s?]/i.test(source.slice(i, i + 6)))
        fail('XML declaration is only allowed at the start of the document', i);
      if (stack.length) addChild({ type: 'pi', start: i, end: close + 2, parent: null });
      i = close + 2;
      continue;
    }

    // Start tag
    if (!isNameStart(next)) fail('Invalid character after "<"', i);
    if (stack.length === 0 && root) fail('Only one root element is allowed', i);

    let j = i + 1;
    while (j < n && isNameChar(source.charCodeAt(j))) j++;
    const name = source.slice(i + 1, j);
    const colon = name.indexOf(':');
    const el: XmlElement = {
      type: 'element',
      name,
      prefix: colon === -1 ? '' : name.slice(0, colon),
      local: colon === -1 ? name : name.slice(colon + 1),
      attrs: [],
      children: [],
      elements: [],
      parent: null,
      index: 0,
      start: i,
      nameEnd: j,
      startTagEnd: 0,
      closeStart: -1,
      end: 0,
      selfClosing: false,
    };

    for (;;) {
      const before = j;
      while (j < n && isWs(source.charCodeAt(j))) j++;
      if (j >= n) fail(`Unterminated start tag <${name}>`, i);
      const c = source.charCodeAt(j);
      if (c === 62 /* > */) {
        j++;
        break;
      }
      if (c === 47 /* / */) {
        if (source.charCodeAt(j + 1) !== 62) fail('Expected ">" after "/"', j);
        el.selfClosing = true;
        j += 2;
        break;
      }
      if (j === before) fail('Whitespace required between attributes', j);
      if (!isNameStart(c)) fail('Invalid attribute name', j);
      const aStart = j;
      while (j < n && isNameChar(source.charCodeAt(j))) j++;
      const aName = source.slice(aStart, j);
      while (j < n && isWs(source.charCodeAt(j))) j++;
      if (source.charCodeAt(j) !== 61 /* = */) fail(`Attribute "${aName}" has no value`, aStart);
      j++;
      while (j < n && isWs(source.charCodeAt(j))) j++;
      const q = source.charCodeAt(j);
      if (q !== 34 && q !== 39) fail(`Attribute "${aName}" value must be quoted`, j);
      const vStart = j + 1;
      const vEnd = source.indexOf(q === 34 ? '"' : "'", vStart);
      if (vEnd === -1) fail(`Unterminated value for attribute "${aName}"`, j);
      const rawValue = source.slice(vStart, vEnd);
      if (rawValue.indexOf('<') !== -1)
        fail('"<" is not allowed in attribute values', vStart + rawValue.indexOf('<'));
      if (rawValue.indexOf('&') !== -1) {
        const m = BAD_ENTITY.exec(rawValue);
        if (m) fail('Invalid or undefined entity reference', vStart + m.index);
      }
      for (const prev of el.attrs)
        if (prev.name === aName) fail(`Duplicate attribute "${aName}"`, aStart);
      el.attrs.push({
        name: aName,
        value: decodeEntities(rawValue),
        start: aStart,
        end: vEnd + 1,
        valueStart: vStart,
        valueEnd: vEnd,
      });
      j = vEnd + 1;
    }

    el.startTagEnd = j;
    const parent = stack[stack.length - 1] ?? null;
    el.parent = parent;
    if (parent) {
      el.index = parent.elements.length;
      parent.elements.push(el);
      parent.children.push(el);
    } else {
      root = el;
    }
    if (el.selfClosing) el.end = j;
    else stack.push(el);
    i = j;
  }

  if (stack.length) {
    const open = stack[stack.length - 1];
    fail(`Unclosed element <${open.name}>`, open.start);
  }
  if (!root) fail('The document has no root element', 0);
  return { source, root: root as XmlElement, declaration };
}

/** Parse without throwing. */
export function tryParseXml(
  source: string,
): { doc: XmlDocument; error?: undefined } | { doc?: undefined; error: XmlParseError } {
  try {
    return { doc: parseXml(source) };
  } catch (e) {
    if (e instanceof XmlParseError) return { error: e };
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------------------------

/** Index path from the root to the element, e.g. `[0, 3, 1]` (root itself is `[]`). */
export function elementPath(el: XmlElement): number[] {
  const path: number[] = [];
  for (let e: XmlElement | null = el; e && e.parent; e = e.parent) path.push(e.index);
  return path.reverse();
}

export function elementAtPath(doc: XmlDocument, path: readonly number[]): XmlElement | undefined {
  let el: XmlElement | undefined = doc.root;
  for (const i of path) {
    el = el.elements[i];
    if (!el) return undefined;
  }
  return el;
}

/** Human-readable XPath using qualified names, e.g. `/w:document/w:body/w:p[3]`. */
export function xpathOf(el: XmlElement): string {
  const parts: string[] = [];
  for (let e: XmlElement | null = el; e; e = e.parent) {
    let seg = e.name;
    if (e.parent) {
      let same = 0;
      let pos = 0;
      for (const sib of e.parent.elements) {
        if (sib.name === e.name) {
          same++;
          if (sib === e) pos = same;
        }
      }
      if (same > 1) seg += `[${pos}]`;
    }
    parts.push(seg);
  }
  return '/' + parts.reverse().join('/');
}

/** Resolve a path produced by {@link xpathOf}. */
export function resolveSimpleXPath(doc: XmlDocument, xpath: string): XmlElement | undefined {
  const segs = xpath.split('/').filter(Boolean);
  if (!segs.length) return undefined;
  const parse = (s: string): [string, number] => {
    const m = /^(.*?)(?:\[(\d+)\])?$/.exec(s)!;
    return [m[1], m[2] ? parseInt(m[2], 10) : 1];
  };
  const [rootName] = parse(segs[0]);
  if (doc.root.name !== rootName) return undefined;
  let el = doc.root;
  for (const seg of segs.slice(1)) {
    const [name, pos] = parse(seg);
    let seen = 0;
    let found: XmlElement | undefined;
    for (const c of el.elements) {
      if (c.name === name && ++seen === pos) {
        found = c;
        break;
      }
    }
    if (!found) return undefined;
    el = found;
  }
  return el;
}

/** Deepest element whose range contains `offset`. */
export function elementAtOffset(doc: XmlDocument, offset: number): XmlElement | undefined {
  let el = doc.root;
  if (offset < el.start || offset > el.end) return undefined;
  for (;;) {
    // Binary search for the child containing the offset.
    let lo = 0;
    let hi = el.elements.length - 1;
    let hit: XmlElement | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = el.elements[mid];
      if (offset < c.start) hi = mid - 1;
      else if (offset >= c.end) lo = mid + 1;
      else {
        hit = c;
        break;
      }
    }
    if (!hit) return el;
    el = hit;
  }
}

/** Resolve a namespace prefix ('' = default namespace) in the scope of `el`. */
export function lookupNamespace(el: XmlElement, prefix: string): string | undefined {
  const attr = prefix ? `xmlns:${prefix}` : 'xmlns';
  if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace';
  for (let e: XmlElement | null = el; e; e = e.parent) {
    const a = e.attrs.find((x) => x.name === attr);
    if (a) return a.value;
  }
  return undefined;
}

export function getAttr(el: XmlElement, name: string): string | undefined {
  for (const a of el.attrs) if (a.name === name) return a.value;
  return undefined;
}

/** Local-name attribute lookup (ignores the prefix): `attrLocal(el, 'val')` matches `w:val`. */
export function getAttrLocal(el: XmlElement, local: string): string | undefined {
  for (const a of el.attrs) {
    const c = a.name.lastIndexOf(':');
    if ((c === -1 ? a.name : a.name.slice(c + 1)) === local) return a.value;
  }
  return undefined;
}

/** Decoded text content of an element (all descendant text and CDATA). */
export function textContent(doc: XmlDocument, el: XmlElement): string {
  let out = '';
  const walk = (e: XmlElement): void => {
    for (const c of e.children) {
      if (c.type === 'element') walk(c);
      else if (c.type === 'text') out += decodeEntities(doc.source.slice(c.start, c.end));
      else if (c.type === 'cdata') out += doc.source.slice(c.start + 9, c.end - 3);
    }
  };
  walk(el);
  return out;
}

/** First child element with the given qualified or local name. */
export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.elements.find((c) => c.name === name || c.local === name);
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.elements.filter((c) => c.name === name || c.local === name);
}
