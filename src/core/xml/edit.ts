/**
 * Element-level edits expressed as text splices on the original source.
 * Everything outside the spliced range stays byte-for-byte identical.
 */
import {
  XmlAttr,
  XmlDocument,
  XmlElement,
  escapeAttr,
  escapeText,
  isWhitespaceOnly,
  tryParseXml,
} from './parser';

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export function applyEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from);
  let out = source;
  for (const e of sorted) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** Indentation of the line the element starts on, or `null` when something precedes it on that line. */
function lineIndent(source: string, offset: number): string | null {
  let i = offset;
  while (i > 0 && (source[i - 1] === ' ' || source[i - 1] === '\t')) i--;
  if (i === 0 || source[i - 1] === '\n') return source.slice(i, offset);
  return null;
}

function eolBefore(source: string, offset: number): string {
  return source[offset - 1] === '\n' && source[offset - 2] === '\r' ? '\r\n' : '\n';
}

export function setAttribute(
  doc: XmlDocument,
  el: XmlElement,
  name: string,
  value: string,
): TextEdit {
  const existing = el.attrs.find((a) => a.name === name);
  if (existing) {
    // Keep the original quote character.
    const quote = doc.source[existing.valueStart - 1];
    const escaped =
      quote === "'"
        ? escapeAttr(value)
            .replace(/&quot;/g, '"')
            .replace(/'/g, '&apos;')
        : escapeAttr(value);
    return { from: existing.valueStart, to: existing.valueEnd, insert: escaped };
  }
  const last = el.attrs[el.attrs.length - 1];
  const at = last ? last.end : el.nameEnd;
  return { from: at, to: at, insert: ` ${name}="${escapeAttr(value)}"` };
}

export function renameAttribute(
  el: XmlElement,
  oldName: string,
  newName: string,
): TextEdit | undefined {
  const a = el.attrs.find((x) => x.name === oldName);
  return a ? { from: a.start, to: a.start + oldName.length, insert: newName } : undefined;
}

export function removeAttribute(
  doc: XmlDocument,
  el: XmlElement,
  attr: XmlAttr | string,
): TextEdit | undefined {
  const a = typeof attr === 'string' ? el.attrs.find((x) => x.name === attr) : attr;
  if (!a) return undefined;
  let from = a.start;
  while (from > 0 && /\s/.test(doc.source[from - 1])) from--;
  return { from, to: a.end, insert: '' };
}

/** Replace the content of an element with plain text. Child elements are discarded. */
export function setElementText(doc: XmlDocument, el: XmlElement, text: string): TextEdit {
  const escaped = escapeText(text);
  if (el.selfClosing) {
    const open = doc.source.slice(el.start, el.end - 2).replace(/\s+$/, '');
    return { from: el.start, to: el.end, insert: `${open}>${escaped}</${el.name}>` };
  }
  return { from: el.startTagEnd, to: el.closeStart, insert: escaped };
}

export function deleteElement(doc: XmlDocument, el: XmlElement): TextEdit {
  const s = doc.source;
  let from = el.start;
  let to = el.end;
  const indent = lineIndent(s, from);
  if (indent !== null) {
    // Remove the whole line(s) when the element is alone on them.
    let after = to;
    while (s[after] === ' ' || s[after] === '\t') after++;
    if (s[after] === '\r' && s[after + 1] === '\n') after += 2;
    else if (s[after] === '\n') after += 1;
    else if (after >= s.length) after = s.length;
    else return { from, to, insert: '' };
    from -= indent.length;
    to = after;
  }
  return { from, to, insert: '' };
}

export function duplicateElement(doc: XmlDocument, el: XmlElement): TextEdit {
  const s = doc.source;
  const indent = lineIndent(s, el.start);
  const copy = s.slice(el.start, el.end);
  const sep = indent !== null ? eolBefore(s, el.start - indent.length) + indent : '';
  return { from: el.end, to: el.end, insert: sep + copy };
}

/** Swap the element with its previous (`-1`) or next (`+1`) sibling. */
export function moveElement(
  doc: XmlDocument,
  el: XmlElement,
  direction: -1 | 1,
): TextEdit | undefined {
  const sibling = el.parent?.elements[el.index + direction];
  if (!sibling) return undefined;
  const [first, second] = direction < 0 ? [sibling, el] : [el, sibling];
  const a = doc.source.slice(first.start, first.end);
  const between = doc.source.slice(first.end, second.start);
  const b = doc.source.slice(second.start, second.end);
  return { from: first.start, to: second.end, insert: b + between + a };
}

export type InsertPosition = 'firstChild' | 'lastChild' | 'before' | 'after';

export interface FragmentCheck {
  ok: boolean;
  error?: string;
}

/** A fragment must be exactly one element (surrounding whitespace/comments are fine). */
export function checkFragment(fragment: string): FragmentCheck {
  const r = tryParseXml(`<root>${fragment}</root>`);
  if (r.error) return { ok: false, error: r.error.reason };
  const kids = r.doc.root.children;
  const elements = kids.filter((c) => c.type === 'element');
  if (elements.length !== 1) return { ok: false, error: 'Exactly one root element is required.' };
  const stray = kids.some(
    (c) => c.type === 'text' && !isWhitespaceOnly(r.doc.source.slice(c.start, c.end)),
  );
  return stray ? { ok: false, error: 'Unexpected text next to the element.' } : { ok: true };
}

export function insertFragment(
  doc: XmlDocument,
  target: XmlElement,
  position: InsertPosition,
  fragment: string,
): TextEdit {
  const s = doc.source;
  const frag = fragment.trim();
  if (position === 'before' || position === 'after') {
    const indent = lineIndent(s, target.start);
    if (position === 'after') {
      const sep = indent !== null ? eolBefore(s, target.start - indent.length) + indent : '';
      return { from: target.end, to: target.end, insert: sep + frag };
    }
    const sep = indent !== null ? eolBefore(s, target.start - indent.length) + indent : '';
    return { from: target.start, to: target.start, insert: frag + sep };
  }

  const parentIndent = lineIndent(s, target.start);
  const eol = parentIndent !== null ? eolBefore(s, target.start - parentIndent.length) : '\n';
  const childIndent = parentIndent !== null ? parentIndent + guessIndentUnit(doc, target) : '';

  if (target.selfClosing) {
    const open = s.slice(target.start, target.end - 2).replace(/\s+$/, '');
    const body = parentIndent !== null ? eol + childIndent + frag + eol + parentIndent : frag;
    return { from: target.start, to: target.end, insert: `${open}>${body}</${target.name}>` };
  }

  if (position === 'firstChild') {
    const first = target.children[0];
    if (
      first &&
      first.type === 'text' &&
      isWhitespaceOnly(s.slice(first.start, first.end)) &&
      parentIndent !== null
    ) {
      return { from: target.startTagEnd, to: target.startTagEnd, insert: eol + childIndent + frag };
    }
    return { from: target.startTagEnd, to: target.startTagEnd, insert: frag };
  }

  // lastChild: put it before the trailing whitespace that precedes the closing tag, if any.
  const last = target.children[target.children.length - 1];
  if (
    last &&
    last.type === 'text' &&
    isWhitespaceOnly(s.slice(last.start, last.end)) &&
    parentIndent !== null
  ) {
    return { from: last.start, to: last.start, insert: eol + childIndent + frag };
  }
  return { from: target.closeStart, to: target.closeStart, insert: frag };
}

function guessIndentUnit(doc: XmlDocument, el: XmlElement): string {
  const own = lineIndent(doc.source, el.start) ?? '';
  const firstChild = el.elements[0];
  if (firstChild) {
    const ci = lineIndent(doc.source, firstChild.start);
    if (ci !== null && ci.startsWith(own) && ci.length > own.length) return ci.slice(own.length);
  }
  return '  ';
}
