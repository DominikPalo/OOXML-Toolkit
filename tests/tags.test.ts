import { describe, expect, it } from 'vitest';
import { PackageModel } from '@core/package/model';
import { readDocumentTags, splitList } from '@core/package/tags';
import { elementAtPath } from '@core/xml/parser';
import { buildDocx, buildPptx, buildXlsx } from './fixtures/builders';

describe('splitList', () => {
  it('splits at ; , and line breaks, trims, drops empties and duplicates', () => {
    expect(splitList(' contract; legal,2026 ;;\n contract ,')).toEqual([
      'contract',
      'legal',
      '2026',
    ]);
    expect(splitList('')).toEqual([]);
    expect(splitList('single tag with spaces')).toEqual(['single tag with spaces']);
  });
});

describe('readDocumentTags', () => {
  it('finds nothing in a package without tags', () => {
    for (const data of [buildDocx(), buildXlsx(), buildPptx()]) {
      const t = readDocumentTags(PackageModel.open(data));
      expect(t).toMatchObject({
        keywords: [],
        categories: [],
        customProperties: [],
        presentationTags: [],
        documentVariables: [],
        total: 0,
      });
    }
  });

  it('reads keywords and categories and points at their XML', () => {
    const m = PackageModel.open(
      buildDocx({ keywords: 'contract; legal, 2026;contract', category: 'Finance' }),
    );
    const t = readDocumentTags(m);
    expect(t.keywords).toEqual(['contract', 'legal', '2026']);
    expect(t.categories).toEqual(['Finance']);
    const { doc } = m.getXml(t.keywordsSource!.part);
    expect(elementAtPath(doc!, t.keywordsSource!.path)?.name).toBe('cp:keywords');
    expect(t.total).toBe(4);
  });

  it('reads custom properties with friendly types and escapes', () => {
    const m = PackageModel.open(
      buildDocx({
        customProperties: [
          { name: 'Project', value: 'Atlas & Co' },
          { name: 'Revision', kind: 'i4', value: '7' },
          { name: 'Reviewed', kind: 'bool', value: 'true' },
          { name: 'Ratio', kind: 'r8', value: '0.75' },
          { name: 'Due', kind: 'filetime', value: '2026-10-06T10:00:00Z' },
        ],
      }),
    );
    const t = readDocumentTags(m);
    expect(t.customProperties.map((p) => [p.name, p.value, p.type])).toEqual([
      ['Project', 'Atlas & Co', 'text'],
      ['Revision', '7', 'number'],
      ['Reviewed', 'true', 'yes/no'],
      ['Ratio', '0.75', 'number'],
      ['Due', '2026-10-06T10:00:00Z', 'date'],
    ]);
    const first = t.customProperties[0];
    expect(first.part).toBe('docProps/custom.xml');
    expect(elementAtPath(m.getXml(first.part).doc!, first.path)?.name).toBe('property');
  });

  it('reads Word document variables', () => {
    const m = PackageModel.open(
      buildDocx({ documentVariables: { Customer: 'ACME & Co', Project: 'X' } }),
    );
    const t = readDocumentTags(m);
    expect(t.documentVariables.map((v) => [v.name, v.value])).toEqual([
      ['Customer', 'ACME & Co'],
      ['Project', 'X'],
    ]);
    expect(t.documentVariables[0].part).toBe('word/settings.xml');
  });

  it('reads PowerPoint tags with presentation and slide scopes', () => {
    const m = PackageModel.open(
      buildPptx({
        slides: [
          { title: 'A', body: '' },
          { title: 'B', body: '' },
          { title: 'C', body: '' },
        ],
        tags: {
          presentation: { SLIDO_SESSION: 'abc', SLIDO_VERSION: '2' },
          slides: [{ POLL: 'p-1' }, undefined, { POLL: 'p-3', TYPE: 'quiz' }],
        },
      }),
    );
    const t = readDocumentTags(m);
    expect(t.presentationTags.map((x) => [x.scope, x.name, x.value])).toEqual([
      ['Presentation', 'SLIDO_SESSION', 'abc'],
      ['Presentation', 'SLIDO_VERSION', '2'],
      ['Slide 1', 'POLL', 'p-1'],
      ['Slide 3', 'POLL', 'p-3'],
      ['Slide 3', 'TYPE', 'quiz'],
    ]);
    const tag = t.presentationTags[4];
    const el = elementAtPath(m.getXml(tag.part).doc!, tag.path)!;
    expect([el.name, el.attrs.find((a) => a.name === 'name')?.value]).toEqual(['p:tag', 'TYPE']);
  });

  it('numbers slides by presentation order, not by file name', () => {
    const m = PackageModel.open(
      buildPptx({
        slides: [
          { title: 'A', body: '' },
          { title: 'B', body: '' },
        ],
        tags: { slides: [{ WHO: 'file-slide1' }, { WHO: 'file-slide2' }] },
      }),
    );
    // Swap the two slide ids in presentation.xml: slide2.xml is now the first slide.
    const pres = m.getText('ppt/presentation.xml').text;
    m.setText(
      'ppt/presentation.xml',
      pres.replace(
        '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>',
        '<p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/>',
      ),
    );
    expect(readDocumentTags(m).presentationTags.map((x) => [x.scope, x.value])).toEqual([
      ['Slide 1', 'file-slide2'],
      ['Slide 2', 'file-slide1'],
    ]);
  });

  it('labels tags on masters and layouts and ignores unreadable parts', () => {
    const m = PackageModel.open(buildPptx({ tags: { presentation: { P: '1' } } }));
    const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    m.addPart(
      'ppt/tags/tag9.xml',
      `<p:tagLst xmlns:p="${P}"><p:tag name="M" val="master"/></p:tagLst>`,
    );
    m.addPart('ppt/tags/tag10.xml', '<p:tagLst'); // malformed
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tags';
    const rels = m.getText('ppt/slideMasters/_rels/slideMaster1.xml.rels').text;
    m.setText(
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      rels.replace(
        '</Relationships>',
        `<Relationship Id="rId9" Type="${REL}" Target="../tags/tag9.xml"/><Relationship Id="rId10" Type="${REL}" Target="../tags/tag10.xml"/><Relationship Id="rId11" Type="${REL}" Target="../tags/missing.xml"/></Relationships>`,
      ),
    );
    const t = readDocumentTags(m);
    expect(t.presentationTags.map((x) => [x.scope, x.name])).toEqual([
      ['Presentation', 'P'],
      ['Slide master', 'M'],
    ]);
  });

  it('survives malformed metadata parts', () => {
    const m = PackageModel.open(
      buildDocx({
        keywords: 'a',
        customProperties: [{ name: 'x', value: 'y' }],
        documentVariables: { k: 'v' },
      }),
    );
    m.setText('docProps/core.xml', '<broken');
    m.setText('docProps/custom.xml', '<broken');
    m.setText('word/settings.xml', '<broken');
    expect(readDocumentTags(m)).toMatchObject({
      keywords: [],
      customProperties: [],
      documentVariables: [],
      total: 0,
    });
  });
});
