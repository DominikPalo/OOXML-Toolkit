import { describe, expect, it } from 'vitest';
import { PackageModel } from '@core/package/model';
import { buildReport, comparePackages, normalizedText } from '@core/compare/compare';
import { fuzzyFilter, searchPackage } from '@core/search';
import { buildDocx, buildPptx, buildXlsx } from './fixtures/builders';

describe('comparePackages', () => {
  it('reports identical packages as unchanged', async () => {
    const r = await comparePackages(PackageModel.open(buildDocx()), PackageModel.open(buildDocx()));
    expect(r.counts.unchanged).toBe(r.parts.length);
    expect(r.counts.modified + r.counts.added + r.counts.removed).toBe(0);
  });

  it('finds modified parts between two documents', async () => {
    const r = await comparePackages(
      PackageModel.open(buildDocx({ heading: 'One', title: 'T1' })),
      PackageModel.open(buildDocx({ heading: 'Two', title: 'T1' })),
    );
    expect(r.parts.filter((p) => p.status === 'modified').map((p) => p.name)).toEqual([
      'word/document.xml',
    ]);
  });

  it('finds added and removed parts (pptx with different slide counts)', async () => {
    const two = PackageModel.open(buildPptx());
    const three = PackageModel.open(
      buildPptx({
        slides: [
          { title: 'a', body: 'b' },
          { title: 'c', body: 'd' },
          { title: 'e', body: 'f' },
        ],
      }),
    );
    const r = await comparePackages(two, three);
    expect(r.parts.filter((p) => p.status === 'added').map((p) => p.name)).toEqual(
      expect.arrayContaining(['ppt/slides/slide3.xml', 'ppt/slides/_rels/slide3.xml.rels']),
    );
    const back = await comparePackages(three, two);
    expect(back.parts.filter((p) => p.status === 'removed').map((p) => p.name)).toContain(
      'ppt/slides/slide3.xml',
    );
  });

  it('classifies whitespace-only XML differences as formatting', async () => {
    const a = PackageModel.open(buildXlsx());
    const b = PackageModel.open(buildXlsx());
    b.setText(
      'xl/workbook.xml',
      a.getText('xl/workbook.xml').text.replace('<sheets>', '<sheets>\n    '),
    );
    expect(
      (await comparePackages(a, b)).parts.find((p) => p.name === 'xl/workbook.xml')!.status,
    ).toBe('formatting');
    expect(
      (await comparePackages(a, b, { detectFormatting: false })).parts.find(
        (p) => p.name === 'xl/workbook.xml',
      )!.status,
    ).toBe('modified');
  });

  it('can ignore attribute order', async () => {
    const a = PackageModel.open(buildXlsx());
    const b = PackageModel.open(buildXlsx());
    b.setText(
      'xl/workbook.xml',
      a
        .getText('xl/workbook.xml')
        .text.replace('name="Fruit" sheetId="1"', 'sheetId="1" name="Fruit"'),
    );
    const status = async (sort: boolean) =>
      (await comparePackages(a, b, { sortAttributes: sort })).parts.find(
        (p) => p.name === 'xl/workbook.xml',
      )!.status;
    expect(await status(false)).toBe('modified');
    expect(await status(true)).toBe('formatting');
  });

  it('compares unsaved edits against the original view', async () => {
    const m = PackageModel.open(buildXlsx());
    m.setText(
      'xl/worksheets/sheet1.xml',
      m.getText('xl/worksheets/sheet1.xml').text.replace('<v>42</v>', '<v>43</v>'),
    );
    m.addPart('new.txt', 'x');
    const r = await comparePackages(m.originalView(), m);
    expect(r.parts.filter((p) => p.status !== 'unchanged').map((p) => [p.name, p.status])).toEqual([
      ['xl/worksheets/sheet1.xml', 'modified'],
      ['new.txt', 'added'],
    ]);
  });

  it('normalises XML for diffing and builds a report', async () => {
    const m = PackageModel.open(buildXlsx());
    expect(normalizedText(m, 'xl/workbook.xml').split('\n').length).toBeGreaterThan(3);
    const r = await comparePackages(
      PackageModel.open(buildXlsx({ b2: 1 })),
      PackageModel.open(buildXlsx({ b2: 2 })),
    );
    const md = buildReport('a.xlsx', 'b.xlsx', r);
    expect(md).toContain('## Modified (1)');
    expect(md).toContain('`xl/worksheets/sheet1.xml`');
  });
});

describe('searchPackage', () => {
  const m = PackageModel.open(buildDocx());

  it('finds text across parts with line and column', async () => {
    const r = await searchPackage(m, { query: 'Hello, OOXML' });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ part: 'word/document.xml', line: 2, length: 12 });
    expect(r.hits[0].preview.slice(r.hits[0].previewStart, r.hits[0].previewStart + 12)).toBe(
      'Hello, OOXML',
    );
  });

  it('supports case sensitivity, whole words and regular expressions', async () => {
    expect((await searchPackage(m, { query: 'hello, ooxml' })).hits).toHaveLength(1);
    expect(
      (await searchPackage(m, { query: 'hello, ooxml', caseSensitive: true })).hits,
    ).toHaveLength(0);
    expect((await searchPackage(m, { query: 'end', wholeWord: true })).hits.length).toBe(1);
    expect((await searchPackage(m, { query: 'w:t[^>]*>A\\d', regex: true })).hits.length).toBe(2);
  });

  it('reports invalid regular expressions instead of throwing', async () => {
    expect((await searchPackage(m, { query: '(', regex: true })).error).toBeTruthy();
  });

  it('does not search binary parts', async () => {
    const r = await searchPackage(m, { query: 'PNG' });
    expect(r.hits.filter((h) => h.part.endsWith('.png'))).toEqual([]);
  });
});

describe('fuzzyFilter', () => {
  const names = [
    'word/document.xml',
    'word/styles.xml',
    'word/_rels/document.xml.rels',
    'docProps/core.xml',
    'ppt/slides/slide1.xml',
  ];
  it('ranks file-name matches first and drops non-matches', () => {
    expect(fuzzyFilter('doc', names)[0]).toBe('word/document.xml');
    expect(fuzzyFilter('sld1', names)).toEqual(['ppt/slides/slide1.xml']);
    expect(fuzzyFilter('zzz', names)).toEqual([]);
    expect(fuzzyFilter('', names)).toHaveLength(5);
  });
});
