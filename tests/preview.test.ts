import { describe, expect, it } from 'vitest';
import { PackageModel } from '@core/package/model';
import { columnName, listSheets, parseCellRef, readSheet } from '@core/preview/xlsx';
import { readDocument, readDocumentText } from '@core/preview/docx';
import { listSlides, readSlide, readSlideSize } from '@core/preview/pptx';
import { buildDocx, buildPptx, buildXlsx, zipFiles } from './fixtures/builders';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('xlsx preview', () => {
  it('converts column names and cell references', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(parseCellRef('B3')).toEqual({ col: 1, row: 3 });
    expect(parseCellRef('$AA$10')).toEqual({ col: 26, row: 10 });
    expect(parseCellRef('nope')).toBeUndefined();
  });

  it('lists sheets in workbook order with their state', () => {
    const m = PackageModel.open(buildXlsx());
    expect(listSheets(m)).toEqual([
      { name: 'Fruit', part: 'xl/worksheets/sheet1.xml', state: 'visible' },
    ]);
  });

  it('reads shared strings, numbers and formulas', () => {
    const grid = readSheet(PackageModel.open(buildXlsx()), 'xl/worksheets/sheet1.xml');
    expect(grid.rows.map((r) => r.cells.map((c) => c.value))).toEqual([
      ['Name', 'Quantity'],
      ['Apples', '42'],
      ['Pears', '17.5'],
      ['Total', '59.5'],
    ]);
    const total = grid.rows[3].cells[1];
    expect(total).toMatchObject({ ref: 'B4', formula: 'SUM(B2:B3)', type: 'number' });
    expect(grid.columnCount).toBe(2);
    expect(grid.dimension).toBe('A1:B4');
  });

  it('handles inline strings, booleans, errors, rich text, missing refs, merges and truncation', () => {
    const files = {
      '[Content_Types].xml': `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
      '_rels/.rels': `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `${DECL}<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Gone" sheetId="3" r:id="rId9"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      'xl/sharedStrings.xml': `${DECL}<sst xmlns="${S}"><si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si></sst>`,
      'xl/worksheets/sheet1.xml':
        `${DECL}<worksheet xmlns="${S}"><dimension ref="A1:C50"/><sheetData>` +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>inline</t></is></c><c r="C1" t="b"><v>1</v></c></row>' +
        '<row r="2"><c t="e"><v>#DIV/0!</v></c><c><v>5</v></c><c r="E2"/></row>' +
        '<row r="3"><c r="A3" t="str"><f>A1&amp;"!"</f><v>Rich text!</v></c></row>' +
        '<row r="50"><c r="A50"><v>last</v></c></row>' +
        '</sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>',
      'xl/worksheets/sheet2.xml': `${DECL}<worksheet xmlns="${S}"><sheetData/></worksheet>`,
    };
    const m = PackageModel.open(zipFiles(files));
    expect(listSheets(m)).toEqual([
      { name: 'Data', part: 'xl/worksheets/sheet1.xml', state: 'visible' },
      { name: 'Hidden', part: 'xl/worksheets/sheet2.xml', state: 'hidden' },
    ]);
    const g = readSheet(m, 'xl/worksheets/sheet1.xml');
    expect(g.rows[0].cells).toMatchObject([
      { ref: 'A1', value: 'Rich text', type: 'string' },
      { ref: 'B1', value: 'inline', type: 'string' },
      { ref: 'C1', value: 'TRUE', type: 'boolean' },
    ]);
    // Cells without `r` are positioned by order; E2 is an empty styled cell.
    expect(g.rows[1].cells).toMatchObject([
      { ref: 'A2', value: '#DIV/0!', type: 'error' },
      { ref: 'B2', value: '5', type: 'number' },
      { ref: 'E2', type: 'empty' },
    ]);
    expect(g.rows[2].cells[0]).toMatchObject({
      value: 'Rich text!',
      formula: 'A1&"!"',
      type: 'string',
    });
    expect(g.mergedCells).toEqual(['A1:C1']);
    expect(g.rowCount).toBe(50);

    const limited = readSheet(m, 'xl/worksheets/sheet1.xml', { maxRows: 2, maxCols: 2 });
    expect(limited.truncated).toBe(true);
    expect(limited.rows).toHaveLength(2);
    expect(limited.columnCount).toBe(2);
    expect(limited.rowCount).toBe(50);
  });

  it('returns an empty grid for missing or malformed parts', () => {
    const m = PackageModel.open(buildXlsx());
    expect(readSheet(m, 'xl/worksheets/nope.xml').rows).toEqual([]);
    m.setText('xl/worksheets/sheet1.xml', '<broken');
    expect(readSheet(m, 'xl/worksheets/sheet1.xml').rows).toEqual([]);
  });

  it('is fast on large sheets and stops building rows at the limit', () => {
    const rows = Array.from(
      { length: 50_000 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join('');
    const m = PackageModel.open(
      zipFiles({ 'big.xml': `<worksheet xmlns="${S}"><sheetData>${rows}</sheetData></worksheet>` }),
    );
    const t0 = performance.now();
    const g = readSheet(m, 'big.xml', { maxRows: 100 });
    expect(g.rows).toHaveLength(100);
    expect(g.rowCount).toBe(50_000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('docx preview', () => {
  it('extracts headings, paragraphs and tables', () => {
    const { blocks, truncated } = readDocument(PackageModel.open(buildDocx()), 'word/document.xml');
    expect(truncated).toBe(false);
    expect(blocks[0]).toMatchObject({
      type: 'paragraph',
      text: 'Hello, OOXML',
      style: 'Heading1',
      headingLevel: 1,
    });
    expect(blocks[2]).toMatchObject({
      type: 'paragraph',
      text: 'A second paragraph, with leading and trailing spaces preserved. ',
    });
    expect(blocks[4]).toEqual({
      type: 'table',
      rows: [
        ['A1', 'B1'],
        ['A2', 'B2'],
      ],
    });
  });

  const doc = (body: string): PackageModel =>
    PackageModel.open(
      zipFiles({
        'd.xml': `${DECL}<w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}</w:body></w:document>`,
      }),
    );

  it('handles tabs, breaks, hyperlinks, tracked changes, fields, drawings and lists', () => {
    const m = doc(
      '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:noBreakHyphen/></w:r></w:p>' +
        '<w:p><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink><w:ins><w:r><w:t> added</w:t></w:r></w:ins><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' +
        '<w:p><w:r><w:instrText>PAGE</w:instrText></w:r><w:fldSimple><w:r><w:t>7</w:t></w:r></w:fldSimple><w:r><mc:AlternateContent><mc:Choice><w:drawing><w:t>nope</w:t></w:drawing></mc:Choice><mc:Fallback><w:t>nope2</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>T</w:t></w:r></w:p>' +
        '<w:p/>',
    );
    const { blocks } = readDocument(m, 'd.xml');
    expect(blocks.map((b) => (b.type === 'paragraph' ? b.text : ''))).toEqual([
      'a\tb\nc-',
      'link added',
      '7',
      'item',
      'T',
      '',
    ]);
    expect(blocks[3]).toMatchObject({ list: true, style: 'ListParagraph' });
    expect(blocks[4]).toMatchObject({ style: 'Title', headingLevel: undefined });
  });

  it('flattens nested tables, reads content controls and truncates', () => {
    const m = doc(
      '<w:sdt><w:sdtPr><w:alias w:val="x"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>in sdt</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>outer</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>last</w:t></w:r></w:p>',
    );
    const { blocks } = readDocument(m, 'd.xml');
    expect(blocks[0]).toMatchObject({ text: 'in sdt' });
    expect(blocks[1]).toEqual({ type: 'table', rows: [['outer\ninner']] });
    const cut = readDocument(m, 'd.xml', { maxBlocks: 2 });
    expect(cut.truncated).toBe(true);
    expect(cut.blocks).toHaveLength(2);
    expect(readDocumentText(m, 'd.xml')).toBe('in sdt\nouter\ninner\nlast');
  });

  it('copes with missing parts', () => {
    expect(readDocument(PackageModel.open(buildDocx()), 'word/none.xml')).toEqual({
      blocks: [],
      truncated: false,
    });
  });
});

describe('pptx preview', () => {
  it('lists slides with titles and reads their text', () => {
    const m = PackageModel.open(buildPptx());
    expect(listSlides(m)).toEqual([
      { part: 'ppt/slides/slide1.xml', index: 1, title: 'Welcome' },
      { part: 'ppt/slides/slide2.xml', index: 2, title: 'Agenda' },
    ]);
    expect(readSlideSize(m)).toEqual({ width: 9144000, height: 6858000 });
    const slide = readSlide(m, 'ppt/slides/slide1.xml');
    expect(slide.shapes.map((s) => [s.name, s.kind, s.placeholder, s.paragraphs])).toEqual([
      ['Title 1', 'text', 'title', ['Welcome']],
      ['Content 2', 'text', undefined, ['First slide body text']],
    ]);
    expect(slide.shapes[0]).toMatchObject({ x: 685800, y: 457200, cx: 7772400, cy: 1143000 });
  });

  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const REL = (id: string, type: string, target: string): string =>
    `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
  const rels = (...items: string[]): string =>
    `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
  const tree = (body: string): string =>
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld>`;
  const ns = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;

  const crafted = (): PackageModel =>
    PackageModel.open(
      zipFiles({
        '[Content_Types].xml': `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
        '_rels/.rels': rels(REL('r1', 'officeDocument', 'ppt/presentation.xml')),
        // Slide order is deliberately not the file-name order.
        'ppt/presentation.xml': `${DECL}<p:presentation ${ns}><p:sldIdLst><p:sldId id="300" r:id="rB"/><p:sldId id="301" r:id="rA"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
        'ppt/_rels/presentation.xml.rels': rels(
          REL('rA', 'slide', 'slides/slide1.xml'),
          REL('rB', 'slide', 'slides/slide2.xml'),
        ),
        'ppt/slides/slide1.xml': `${DECL}<p:sld ${ns}>${tree(
          // title placeholder without own xfrm → inherits from the layout
          '<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="4400"/><a:t>Inherited</a:t></a:r></a:p></p:txBody></p:sp>' +
            // group scaled 2x with child offset
            '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="2000" cy="2000"/><a:chOff x="100" y="100"/><a:chExt cx="1000" cy="1000"/></a:xfrm></p:grpSpPr>' +
            '<p:sp><p:nvSpPr><p:cNvPr id="4" name="InGroup"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="5400000"><a:off x="200" y="300"/><a:ext cx="100" cy="50"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>a</a:t></a:r><a:br/><a:r><a:t>b</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>' +
            '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rImg"/></p:blipFill><p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr></p:pic>' +
            '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5" y="6"/><a:ext cx="7" cy="8"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>c1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>c2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>',
        )}</p:sld>`,
        'ppt/slides/_rels/slide1.xml.rels': rels(
          REL('rL', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
          REL('rImg', 'image', '../media/pic.png'),
          REL('rN', 'notesSlide', '../notesSlides/notesSlide1.xml'),
        ),
        'ppt/slides/slide2.xml': `${DECL}<p:sld ${ns}>${tree('<p:sp><p:nvSpPr><p:cNvPr id="2" name="Only"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Second file, first slide</a:t></a:r></a:p></p:txBody></p:sp>')}</p:sld>`,
        'ppt/slideLayouts/slideLayout1.xml': `${DECL}<p:sldLayout ${ns}>${tree('<p:sp><p:nvSpPr><p:cNvPr id="2" name="LT"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="111" y="222"/><a:ext cx="333" cy="444"/></a:xfrm></p:spPr></p:sp>')}</p:sldLayout>`,
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels(
          REL('rM', 'slideMaster', '../slideMasters/slideMaster1.xml'),
        ),
        'ppt/slideMasters/slideMaster1.xml': `${DECL}<p:sldMaster ${ns}>${tree('')}</p:sldMaster>`,
        'ppt/notesSlides/notesSlide1.xml': `${DECL}<p:notes ${ns}>${tree('<p:sp><p:nvSpPr><p:cNvPr id="2" name="N"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Speaker notes</a:t></a:r></a:p></p:txBody></p:sp>')}</p:notes>`,
        'ppt/media/pic.png': new Uint8Array([1, 2, 3]),
      }),
    );

  it('follows sldIdLst order rather than file names and reads the slide size', () => {
    const m = crafted();
    expect(listSlides(m).map((s) => [s.index, s.part, s.title])).toEqual([
      [1, 'ppt/slides/slide2.xml', 'Second file, first slide'],
      [2, 'ppt/slides/slide1.xml', 'Inherited'],
    ]);
    expect(readSlideSize(m)).toEqual({ width: 12192000, height: 6858000 });
  });

  it('inherits placeholder geometry, applies group transforms, and reads pictures, tables and notes', () => {
    const slide = readSlide(crafted(), 'ppt/slides/slide1.xml');
    const [title, inGroup, pic, table] = slide.shapes;
    expect(title).toMatchObject({
      placeholder: 'ctrTitle',
      x: 111,
      y: 222,
      cx: 333,
      cy: 444,
      fontSizePt: 44,
      paragraphs: ['Inherited'],
    });
    // group maps child space (100..1100) onto (1000..3000): scale 2, so x = 1000 + (200-100)*2
    expect(inGroup).toMatchObject({
      name: 'InGroup',
      x: 1200,
      y: 2400,
      cx: 200,
      cy: 100,
      rotation: 90,
      paragraphs: ['a\nb'],
    });
    expect(pic).toMatchObject({
      kind: 'picture',
      imagePart: 'ppt/media/pic.png',
      x: 1,
      y: 2,
      cx: 3,
      cy: 4,
    });
    expect(table).toMatchObject({ kind: 'table', paragraphs: ['c1 | c2'], x: 5, y: 6 });
    expect(slide.notes).toBe('Speaker notes');
  });

  it('never throws on missing or broken parts', () => {
    const m = crafted();
    expect(readSlide(m, 'ppt/slides/missing.xml').shapes).toEqual([]);
    m.setText('ppt/slides/slide1.xml', '<p:sld');
    expect(readSlide(m, 'ppt/slides/slide1.xml').shapes).toEqual([]);
    expect(listSlides(PackageModel.open(buildDocx()))).toEqual([]);
    expect(readSlideSize(PackageModel.open(buildDocx()))).toEqual({
      width: 9144000,
      height: 6858000,
    });
  });
});
