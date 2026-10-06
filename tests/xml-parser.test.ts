import { describe, expect, it } from 'vitest';
import {
  XmlParseError,
  decodeEntities,
  elementAtOffset,
  elementAtPath,
  elementPath,
  escapeAttr,
  lookupNamespace,
  parseXml,
  resolveSimpleXPath,
  textContent,
  tryParseXml,
  xpathOf,
} from '@core/xml/parser';

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="urn:w" xmlns="urn:default">
  <w:body>
    <w:p w:rsid='1'><w:r><w:t xml:space="preserve"> a &amp; b </w:t></w:r></w:p>
    <w:p/>
    <!-- note -->
    <w:p><![CDATA[<raw>]]></w:p>
  </w:body>
</w:document>`;

describe('parseXml', () => {
  it('records exact source ranges', () => {
    const doc = parseXml(DOC);
    const body = doc.root.elements[0];
    const p1 = body.elements[0];
    expect(doc.source.slice(p1.start, p1.end)).toBe(
      `<w:p w:rsid='1'><w:r><w:t xml:space="preserve"> a &amp; b </w:t></w:r></w:p>`,
    );
    expect(doc.source.slice(p1.start, p1.startTagEnd)).toBe(`<w:p w:rsid='1'>`);
    expect(doc.source.slice(p1.closeStart, p1.end)).toBe('</w:p>');
    const attr = p1.attrs[0];
    expect(doc.source.slice(attr.start, attr.end)).toBe(`w:rsid='1'`);
    expect(doc.source.slice(attr.valueStart, attr.valueEnd)).toBe('1');
    const selfClosing = body.elements[1];
    expect(selfClosing.selfClosing).toBe(true);
    expect(selfClosing.closeStart).toBe(-1);
    expect(doc.source.slice(selfClosing.start, selfClosing.end)).toBe('<w:p/>');
  });

  it('reads the declaration, names, prefixes and namespaces', () => {
    const doc = parseXml(DOC);
    expect(doc.declaration).toMatchObject({ version: '1.0', encoding: 'UTF-8', standalone: 'yes' });
    expect(doc.root.prefix).toBe('w');
    expect(doc.root.local).toBe('document');
    const t = doc.root.elements[0].elements[0].elements[0].elements[0];
    expect(lookupNamespace(t, 'w')).toBe('urn:w');
    expect(lookupNamespace(t, '')).toBe('urn:default');
    expect(lookupNamespace(t, 'nope')).toBeUndefined();
  });

  it('decodes entities in text and attributes', () => {
    const doc = parseXml(DOC);
    const t = doc.root.elements[0].elements[0].elements[0].elements[0];
    expect(textContent(doc, t)).toBe(' a & b ');
    expect(decodeEntities('&lt;&#65;&#x42;&gt;&quot;&apos;')).toBe('<AB>"\'');
    expect(parseXml('<a v="&lt;&amp;"/>').root.attrs[0].value).toBe('<&');
  });

  it('handles CDATA, comments and processing instructions', () => {
    const doc = parseXml(DOC);
    const p3 = doc.root.elements[0].elements[2];
    expect(p3.children[0].type).toBe('cdata');
    expect(textContent(doc, p3)).toBe('<raw>');
    const body = doc.root.elements[0];
    expect(body.children.some((c) => c.type === 'comment')).toBe(true);
    expect(parseXml('<a><?pi x?></a>').root.children[0].type).toBe('pi');
  });

  it('tolerates a BOM, DOCTYPE and surrounding comments', () => {
    const doc = parseXml(
      '﻿<?xml version="1.0"?>\n<!-- c --><!DOCTYPE a [<!ENTITY x "y">]>\n<a/>\n<!-- end -->',
    );
    expect(doc.root.name).toBe('a');
  });

  it.each([
    ['<a><b></a>', /Mismatched end tag/, 1, 7],
    ['<a>', /Unclosed element <a>/, 1, 1],
    ['<a/><b/>', /Only one root/, 1, 5],
    ['<a x="1" x="2"/>', /Duplicate attribute/, 1, 10],
    ['<a x=1/>', /must be quoted/, 1, 6],
    ['<a>&nbsp;</a>', /entity/, 1, 4],
    ['<a>text</a>trailing', /outside of the root/, 1, 12],
    ['text<a/>', /outside of the root/, 1, 1],
    ['<a x="<"/>', /not allowed in attribute/, 1, 7],
    ['<a><!-- never closed </a>', /Unterminated comment/, 1, 4],
    ['<a>\n\n  <b></c></a>', /Mismatched end tag/, 3, 6],
    ['', /no root element/, 1, 1],
  ])('reports well-formedness error for %j', (src, message, line, column) => {
    try {
      parseXml(src);
      throw new Error('expected a parse error');
    } catch (e) {
      expect(e).toBeInstanceOf(XmlParseError);
      const err = e as XmlParseError;
      expect(err.message).toMatch(message);
      expect([err.line, err.column]).toEqual([line, column]);
    }
  });

  it('tryParseXml does not throw', () => {
    expect(tryParseXml('<a>').error).toBeInstanceOf(XmlParseError);
    expect(tryParseXml('<a/>').doc?.root.name).toBe('a');
  });

  it('parses large documents quickly', () => {
    const rows = Array.from(
      { length: 100_000 },
      (_, i) => `<row r="${i}"><c r="A${i}"><v>${i}</v></c></row>`,
    ).join('');
    const src = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
    const t0 = performance.now();
    const doc = parseXml(src);
    expect(doc.root.elements[0].elements).toHaveLength(100_000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('paths', () => {
  const doc = parseXml('<r><a/><b><c/><c><d/></c></b><a/></r>');
  const d = doc.root.elements[1].elements[1].elements[0];

  it('computes index paths and resolves them back', () => {
    expect(elementPath(d)).toEqual([1, 1, 0]);
    expect(elementAtPath(doc, [1, 1, 0])).toBe(d);
    expect(elementAtPath(doc, [9])).toBeUndefined();
    expect(elementPath(doc.root)).toEqual([]);
  });

  it('builds and resolves xpaths', () => {
    expect(xpathOf(d)).toBe('/r/b/c[2]/d');
    expect(xpathOf(doc.root.elements[2])).toBe('/r/a[2]');
    expect(resolveSimpleXPath(doc, '/r/b/c[2]/d')).toBe(d);
    expect(resolveSimpleXPath(doc, '/r/zzz')).toBeUndefined();
  });

  it('finds the element at an offset', () => {
    const at = doc.source.indexOf('<d/>') + 1;
    expect(elementAtOffset(doc, at)).toBe(d);
    expect(elementAtOffset(doc, doc.source.indexOf('<b>') + 1)?.name).toBe('b');
  });
});

describe('escapeAttr', () => {
  it('escapes quotes, markup and control whitespace', () => {
    expect(escapeAttr(`a"b<c&d\n`)).toBe('a&quot;b&lt;c&amp;d&#10;');
  });
});
