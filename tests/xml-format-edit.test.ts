import { describe, expect, it } from 'vitest';
import { formatXml, minifyXml } from '@core/xml/format';
import {
  applyEdits,
  checkFragment,
  deleteElement,
  duplicateElement,
  insertFragment,
  moveElement,
  removeAttribute,
  setAttribute,
  setElementText,
} from '@core/xml/edit';
import { parseXml, textContent, type XmlDocument } from '@core/xml/parser';

const textsOf = (src: string): string[] => {
  const doc = parseXml(src);
  const out: string[] = [];
  const walk = (el: XmlDocument['root']): void => {
    if (!el.elements.length) out.push(textContent(doc, el));
    el.elements.forEach(walk);
  };
  walk(doc.root);
  return out;
};

const MINIFIED =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<w:document xmlns:w="urn:w"><w:body>' +
  '<w:p><w:r><w:t xml:space="preserve"> spaced  text </w:t></w:r></w:p>' +
  '<w:p><w:r><w:t> </w:t></w:r><w:r><w:t>a &amp; b</w:t></w:r></w:p>' +
  '<w:p/>' +
  '</w:body></w:document>';

describe('formatXml', () => {
  it('indents structural elements and keeps text-bearing elements on one line', () => {
    expect(formatXml(MINIFIED)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="urn:w">',
        '  <w:body>',
        '    <w:p>',
        '      <w:r>',
        '        <w:t xml:space="preserve"> spaced  text </w:t>',
        '      </w:r>',
        '    </w:p>',
        '    <w:p>',
        '      <w:r>',
        '        <w:t> </w:t>',
        '      </w:r>',
        '      <w:r>',
        '        <w:t>a &amp; b</w:t>',
        '      </w:r>',
        '    </w:p>',
        '    <w:p/>',
        '  </w:body>',
        '</w:document>',
      ].join('\n'),
    );
  });

  it('never changes any text content', () => {
    expect(textsOf(formatXml(MINIFIED))).toEqual(textsOf(MINIFIED));
  });

  it('is idempotent and inverted by minify', () => {
    const once = formatXml(MINIFIED);
    expect(formatXml(once)).toBe(once);
    expect(minifyXml(once)).toBe(minifyXml(MINIFIED));
    expect(minifyXml(MINIFIED).replace(/\r?\n/, '')).toBe(MINIFIED.replace(/\r?\n/, ''));
  });

  it('leaves mixed content untouched', () => {
    const mixed = '<p>Hello <b>bold</b> and <i>italic</i> world</p>';
    expect(formatXml(mixed)).toBe(mixed);
    const spaceBetween = '<p><b>a</b> <i>b</i></p>';
    expect(formatXml(spaceBetween)).toBe(spaceBetween);
  });

  it('respects xml:space="preserve" on elements with children', () => {
    const src = '<a xml:space="preserve"><b>1</b><c>2</c></a>';
    expect(formatXml(src)).toBe(src);
  });

  it('keeps comments, processing instructions and the prolog', () => {
    const src =
      '<?xml version="1.0"?>\n<!-- head --><a><!-- c --><b/><?pi data?></a>\n<!-- tail -->';
    const out = formatXml(src);
    expect(out).toBe(
      '<?xml version="1.0"?>\n<!-- head -->\n<a>\n  <!-- c -->\n  <b/>\n  <?pi data?>\n</a>\n<!-- tail -->',
    );
  });

  it('can emit attributes in canonical order for comparison', () => {
    const out = formatXml('<a z="1" xmlns:q="u" b="2" xmlns="d"><c y="1" x="2"/></a>', {
      sortAttributes: true,
    });
    expect(out).toBe('<a xmlns="d" xmlns:q="u" b="2" z="1">\n  <c x="2" y="1"/>\n</a>');
  });

  it('throws on malformed input', () => {
    expect(() => formatXml('<a><b></a>')).toThrow();
  });
});

describe('element edits', () => {
  const SRC = [
    '<root>',
    '  <item id="1" name=\'one\'>a</item>',
    '  <item id="2"/>',
    '  <group>',
    '    <leaf/>',
    '  </group>',
    '</root>',
  ].join('\n');
  const apply = (edit: ReturnType<typeof setAttribute> | undefined): string =>
    applyEdits(SRC, [edit!]);
  const doc = parseXml(SRC);
  const [item1, item2, group] = doc.root.elements;

  it('replaces an attribute value, keeping quote style and escaping', () => {
    expect(apply(setAttribute(doc, item1, 'id', 'x"y'))).toContain(
      '<item id="x&quot;y" name=\'one\'>',
    );
    expect(apply(setAttribute(doc, item1, 'name', `it's`))).toContain(`name='it&apos;s'`);
  });

  it('adds and removes attributes', () => {
    expect(apply(setAttribute(doc, item2, 'new', 'v'))).toContain('<item id="2" new="v"/>');
    expect(apply(setAttribute(doc, group, 'k', '1'))).toContain('<group k="1">');
    expect(apply(removeAttribute(doc, item1, 'id'))).toContain(`<item name='one'>a</item>`);
  });

  it('sets element text, also on self-closing elements', () => {
    expect(apply(setElementText(doc, item1, 'a < b'))).toContain(
      '<item id="1" name=\'one\'>a &lt; b</item>',
    );
    expect(apply(setElementText(doc, item2, 'hi'))).toContain('<item id="2">hi</item>');
  });

  it('deletes whole lines', () => {
    const out = apply(deleteElement(doc, item2));
    expect(out).toBe(SRC.replace('  <item id="2"/>\n', ''));
    expect(parseXml(out).root.elements).toHaveLength(2);
  });

  it('deletes inline elements without touching surrounding text', () => {
    const d = parseXml('<p>a<b>x</b>c</p>');
    expect(applyEdits(d.source, [deleteElement(d, d.root.elements[0])])).toBe('<p>ac</p>');
  });

  it('duplicates with matching indentation', () => {
    const out = apply(duplicateElement(doc, group));
    expect(out).toContain('  </group>\n  <group>\n    <leaf/>\n  </group>\n</root>');
    expect(parseXml(out).root.elements).toHaveLength(4);
  });

  it('moves elements up and down', () => {
    const down = apply(moveElement(doc, item1, 1));
    expect(parseXml(down).root.elements.map((e) => e.attrs[0]?.value)).toEqual([
      '2',
      '1',
      undefined,
    ]);
    const up = apply(moveElement(doc, group, -1));
    expect(parseXml(up).root.elements.map((e) => e.name)).toEqual(['item', 'group', 'item']);
    expect(moveElement(doc, item1, -1)).toBeUndefined();
    expect(moveElement(doc, group, 1)).toBeUndefined();
  });

  it('inserts fragments in every position', () => {
    const frag = '<new a="1"/>';
    expect(apply(insertFragment(doc, group, 'after', frag))).toContain(
      '  </group>\n  <new a="1"/>\n</root>',
    );
    expect(apply(insertFragment(doc, group, 'before', frag))).toContain(
      '  <new a="1"/>\n  <group>',
    );
    expect(apply(insertFragment(doc, group, 'lastChild', frag))).toContain(
      '    <leaf/>\n    <new a="1"/>\n  </group>',
    );
    expect(apply(insertFragment(doc, group, 'firstChild', frag))).toContain(
      '  <group>\n    <new a="1"/>\n    <leaf/>',
    );
    expect(apply(insertFragment(doc, item2, 'lastChild', frag))).toContain(
      '<item id="2">\n    <new a="1"/>\n  </item>',
    );
    for (const pos of ['after', 'before', 'lastChild', 'firstChild'] as const) {
      expect(() => parseXml(apply(insertFragment(doc, group, pos, frag)))).not.toThrow();
    }
  });

  it('validates fragments', () => {
    expect(checkFragment('<a/>').ok).toBe(true);
    expect(checkFragment('  <a><b/></a> ').ok).toBe(true);
    expect(checkFragment('<a/><b/>').ok).toBe(false);
    expect(checkFragment('just text').ok).toBe(false);
    expect(checkFragment('<a>').ok).toBe(false);
  });

  it('applies several edits at once', () => {
    const out = applyEdits(SRC, [
      setAttribute(doc, item1, 'id', '10'),
      setAttribute(doc, item2, 'id', '20'),
    ]);
    expect(out).toContain('id="10"');
    expect(out).toContain('id="20"');
  });
});
