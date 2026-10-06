import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { PackageModel } from '@core/package/model';
import {
  analyzePackage,
  contentTypeOf,
  encodePartUri,
  parseRelationships,
  partNameProblem,
  relativeTarget,
  relsPartFor,
  resolveTarget,
  sourceOfRels,
} from '@core/package/opc';
import { buildFolderTree } from '@core/package/tree';
import { partKind } from '@core/package/kinds';
import { validatePackage } from '@core/package/validate';
import { ZipArchive } from '@core/zip/zip';
import { encodeText } from '@core/text';
import { buildDocx, buildPptx, buildXlsx, zipFiles } from './fixtures/builders';

const dec = new TextDecoder();

describe('opc helpers', () => {
  it('maps parts to their relationship parts and back', () => {
    expect(relsPartFor('')).toBe('_rels/.rels');
    expect(relsPartFor('word/document.xml')).toBe('word/_rels/document.xml.rels');
    expect(relsPartFor('a.xml')).toBe('_rels/a.xml.rels');
    expect(sourceOfRels('_rels/.rels')).toBe('');
    expect(sourceOfRels('word/_rels/document.xml.rels')).toBe('word/document.xml');
    expect(sourceOfRels('x.xml')).toBeUndefined();
  });

  it('resolves relationship targets', () => {
    expect(resolveTarget('word/document.xml', 'media/a.png')).toBe('word/media/a.png');
    expect(resolveTarget('ppt/slides/slide1.xml', '../slideLayouts/l.xml')).toBe(
      'ppt/slideLayouts/l.xml',
    );
    expect(resolveTarget('word/document.xml', '/docProps/core.xml')).toBe('docProps/core.xml');
    expect(resolveTarget('', 'word/document.xml')).toBe('word/document.xml');
    expect(resolveTarget('xl/workbook.xml', 'my%20sheet.xml')).toBe('xl/my sheet.xml');
    expect(resolveTarget('a/b.xml', 'c.xml#frag')).toBe('a/c.xml');
  });
});

describe('package analysis', () => {
  it.each([
    ['docx', buildDocx(), 'word', 'word/document.xml'],
    ['xlsx', buildXlsx(), 'excel', 'xl/workbook.xml'],
    ['pptx', buildPptx(), 'powerpoint', 'ppt/presentation.xml'],
  ])('detects %s packages', (ext, data, family, main) => {
    const model = PackageModel.open(data);
    const a = analyzePackage(model);
    expect(a.type.family).toBe(family);
    expect(a.type.extension).toBe(ext);
    expect(a.mainPart).toBe(main);
    expect(contentTypeOf(a.contentTypes, main)).toContain('.main+xml');
  });

  it('builds incoming and outgoing relationship indexes', () => {
    const a = analyzePackage(PackageModel.open(buildDocx()));
    const out = a.relationships.get('word/document.xml')!;
    expect(out.map((r) => r.id)).toEqual(['rId1', 'rId2', 'rId3']);
    expect(out[2].external).toBe(true);
    expect(out[2].resolved).toBeUndefined();
    expect(a.incoming.get('word/media/image1.png')![0].source).toBe('word/document.xml');
    expect(contentTypeOf(a.contentTypes, 'word/media/image1.png')).toBe('image/png');
  });

  it('computes relative targets that resolve back to the same part', () => {
    const cases: Array<[string, string, string]> = [
      ['word/document.xml', 'word/media/a.png', 'media/a.png'],
      ['ppt/slides/slide1.xml', 'ppt/slideLayouts/l.xml', '../slideLayouts/l.xml'],
      ['', 'word/document.xml', 'word/document.xml'],
      ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml', '../sharedStrings.xml'],
      ['a/b/c.xml', 'a/b/c2.xml', 'c2.xml'],
    ];
    for (const [source, target, expected] of cases) {
      expect(relativeTarget(source, target)).toBe(expected);
      expect(resolveTarget(source, expected)).toBe(target);
    }
  });

  it('percent-encodes part URIs so they resolve back to the original name', () => {
    for (const name of ['word/media/my logo (1).png', 'xl/ünï/data#1.xml', "a/b'c*d!.xml"]) {
      const encoded = encodePartUri(name);
      expect(encoded).not.toMatch(/[ ()'*!#]/);
      expect(resolveTarget('word/document.xml', '/' + encoded)).toBe(name);
    }
    expect(encodePartUri('word/media/a b.png')).toBe('word/media/a%20b.png');
  });

  it('rejects unusable part names', () => {
    expect(partNameProblem('word/media/a.png')).toBeUndefined();
    for (const bad of [
      '',
      '/abs.xml',
      'a//b.xml',
      'a/../b.xml',
      'a\\b.xml',
      'a?b.xml',
      'a#b.xml',
      'dir/',
      './x.xml',
    ]) {
      expect(partNameProblem(bad), JSON.stringify(bad)).toBeTruthy();
    }
  });

  it('does not treat fragment-only or URI targets as parts (as written by Excel for in-document links)', () => {
    const xml =
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="x/hyperlink" Target="#'Sales Data'!A1"/>` +
      '<Relationship Id="rId2" Type="x/hyperlink" Target="mailto:a@b.c"/>' +
      '<Relationship Id="rId3" Type="x/image" Target="../media/a.png"/></Relationships>';
    const rels = parseRelationships(
      xml,
      'xl/drawings/drawing1.xml',
      'xl/drawings/_rels/drawing1.xml.rels',
    );
    expect(rels.map((r) => r.resolved)).toEqual([undefined, undefined, 'xl/media/a.png']);
  });

  it('classifies parts', () => {
    expect(partKind('word/document.xml')).toBe('xml');
    expect(partKind('word/_rels/document.xml.rels')).toBe('rels');
    expect(partKind('word/media/a.png')).toBe('image');
    expect(partKind('word/media/a.svg')).toBe('image');
    expect(partKind('word/embeddings/book.xlsx')).toBe('package');
    expect(partKind('x.bin', undefined, Uint8Array.of(0x50, 0x4b, 3, 4))).toBe('package');
    expect(partKind('x.bin', undefined, Uint8Array.of(0, 1, 2, 3))).toBe('binary');
    expect(partKind('x.unknown', undefined, new TextEncoder().encode('plain text here'))).toBe(
      'text',
    );
  });

  it('builds a sorted folder tree', () => {
    const t = buildFolderTree([
      'word/document.xml',
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/media/a.png',
      'z.txt',
    ]);
    expect(t.parts).toEqual(['[Content_Types].xml', 'z.txt']);
    expect(t.folders.map((f) => f.name)).toEqual(['_rels', 'docProps', 'word']);
    expect(t.folders[2].folders[0].path).toBe('word/media/');
    expect(t.folders[2].parts).toEqual(['word/document.xml']);
  });
});

describe('PackageModel', () => {
  it('lists parts and reads text and bytes', () => {
    const m = PackageModel.open(buildDocx());
    expect(m.names()).toContain('word/document.xml');
    expect(m.getText('word/document.xml').text).toContain('Hello, OOXML');
    expect(m.getBytes('word/media/image1.png').length).toBeGreaterThan(20);
    expect(m.isDirty()).toBe(false);
  });

  it('tracks edits, status and dirtiness', () => {
    const m = PackageModel.open(buildDocx());
    m.setText('word/document.xml', '<w:document xmlns:w="urn:w"/>');
    expect(m.status('word/document.xml')).toBe('modified');
    expect(m.isDirty()).toBe(true);
    m.addPart('word/new.xml', '<n/>');
    expect(m.status('word/new.xml')).toBe('added');
    m.removePart('word/styles.xml');
    expect(m.status('word/styles.xml')).toBe('deleted');
    expect(m.has('word/styles.xml')).toBe(false);
    expect(m.names()).not.toContain('word/styles.xml');
    expect(m.names()).toContain('word/new.xml');
  });

  it('undoes and redoes, returning to a clean state', () => {
    const m = PackageModel.open(buildDocx());
    const orig = m.getText('word/document.xml').text;
    m.setText('word/document.xml', orig + '<!--x-->');
    m.removePart('word/styles.xml');
    m.addPart('a.txt', 'a');
    expect(m.undoLabel).toBe('Add a.txt');
    m.undo();
    m.undo();
    expect(m.has('word/styles.xml')).toBe(true);
    expect(m.has('a.txt')).toBe(false);
    m.undo();
    expect(m.getText('word/document.xml').text).toBe(orig);
    expect(m.isDirty()).toBe(false);
    expect(m.canUndo).toBe(false);
    m.redo();
    expect(m.getText('word/document.xml').text).toBe(orig + '<!--x-->');
    expect(m.isDirty()).toBe(true);
  });

  it('is not dirty when an edit is reverted by hand', () => {
    const m = PackageModel.open(buildDocx());
    const orig = m.getText('word/document.xml').text;
    m.setText('word/document.xml', orig + ' ');
    m.setText('word/document.xml', orig);
    expect(m.isDirty()).toBe(false);
  });

  it('coalesces rapid edits of the same part into one undo step', () => {
    const m = PackageModel.open(buildDocx());
    const orig = m.getText('word/document.xml').text;
    for (const ch of 'abc')
      m.setText('word/document.xml', m.getText('word/document.xml').text + ch);
    m.undo();
    expect(m.getText('word/document.xml').text).toBe(orig);
    expect(m.canUndo).toBe(false);
  });

  it('groups a rename into one undo step', () => {
    const m = PackageModel.open(buildDocx());
    const bytes = m.getBytes('word/media/image1.png');
    m.renamePart('word/media/image1.png', 'word/media/renamed.png');
    expect(m.has('word/media/image1.png')).toBe(false);
    expect(m.getBytes('word/media/renamed.png')).toEqual(bytes);
    m.undo();
    expect(m.has('word/media/image1.png')).toBe(true);
    expect(m.has('word/media/renamed.png')).toBe(false);
    expect(m.isDirty()).toBe(false);
  });

  it('preserves text encoding and BOM of edited parts', () => {
    const utf16 = encodeText('<a>é</a>', { encoding: 'utf-16le', bom: true });
    const m = PackageModel.open(
      zipFiles({
        'u16.xml': utf16,
        'u8.xml': Uint8Array.of(0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e),
      }),
    );
    expect(m.getText('u16.xml')).toMatchObject({
      text: '<a>é</a>',
      encoding: 'utf-16le',
      bom: true,
    });
    m.setText('u16.xml', '<a>ü</a>');
    m.setText('u8.xml', '<b/>');
    expect([...m.getBytes('u16.xml').subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect([...m.getBytes('u8.xml').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('serialises: untouched parts are byte-identical, edits are applied, output is a valid zip', () => {
    const source = buildXlsx();
    const m = PackageModel.open(source);
    m.setText(
      'xl/worksheets/sheet1.xml',
      m.getText('xl/worksheets/sheet1.xml').text.replace('<v>42</v>', '<v>43</v>'),
    );
    m.addPart('extra.txt', 'hello');
    m.removePart('docProps/app.xml');
    const out = m.serialize();

    const files = unzipSync(out);
    expect(dec.decode(files['xl/worksheets/sheet1.xml'])).toContain('<v>43</v>');
    expect(dec.decode(files['extra.txt'])).toBe('hello');
    expect(files['docProps/app.xml']).toBeUndefined();

    const before = ZipArchive.open(source);
    const after = ZipArchive.open(out);
    for (const name of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/sharedStrings.xml',
    ]) {
      expect(after.raw(after.get(name)!)).toEqual(before.raw(before.get(name)!));
    }
    expect(after.entries.map((e) => e.name)).toEqual([
      ...before.entries.map((e) => e.name).filter((n) => n !== 'docProps/app.xml'),
      'extra.txt',
    ]);
  });

  it('a no-op save reproduces identical entries', () => {
    const source = buildPptx();
    const m = PackageModel.open(source);
    const out = ZipArchive.open(m.serialize());
    const orig = ZipArchive.open(source);
    expect(out.entries.map((e) => [e.name, e.crc32, e.size])).toEqual(
      orig.entries.map((e) => [e.name, e.crc32, e.size]),
    );
  });

  it('rebases after save and keeps undo working', () => {
    const m = PackageModel.open(buildDocx());
    const orig = m.getText('word/document.xml').text;
    m.setText('word/document.xml', orig + '<!--1-->');
    m.rebase(m.serialize());
    expect(m.isDirty()).toBe(false);
    expect(m.getText('word/document.xml').text).toBe(orig + '<!--1-->');
    m.undo();
    expect(m.getText('word/document.xml').text).toBe(orig);
    expect(m.isDirty()).toBe(true);
    m.redo();
    expect(m.isDirty()).toBe(false);
  });

  it('caches parsed XML until the text changes', () => {
    const m = PackageModel.open(buildDocx());
    const a = m.getXml('word/document.xml');
    expect(m.getXml('word/document.xml')).toBe(a);
    m.setText('word/document.xml', '<broken>');
    expect(m.getXml('word/document.xml').error).toBeDefined();
  });

  it('exposes an untouched view of the original', () => {
    const m = PackageModel.open(buildDocx());
    const orig = m.getText('word/document.xml').text;
    m.setText('word/document.xml', 'changed');
    const view = m.originalView();
    expect(view.getText('word/document.xml').text).toBe(orig);
    expect(view.names()).toEqual(expect.arrayContaining(['word/document.xml', 'word/styles.xml']));
  });

  it('notifies subscribers', () => {
    const m = PackageModel.open(buildDocx());
    let calls = 0;
    const off = m.subscribe(() => calls++);
    m.setText('word/document.xml', 'x');
    expect(calls).toBe(1);
    off();
    m.setText('word/document.xml', 'y');
    expect(calls).toBe(1);
  });
});

describe('validatePackage', () => {
  it('finds no errors in generated documents', async () => {
    for (const data of [buildDocx(), buildXlsx(), buildPptx()]) {
      const problems = await validatePackage(PackageModel.open(data));
      expect(problems.filter((p) => p.severity !== 'info')).toEqual([]);
    }
  });

  it('reports malformed XML with a position', async () => {
    const m = PackageModel.open(buildDocx());
    m.setText('word/styles.xml', '<a>\n<b></a>');
    const p = (await validatePackage(m)).find((x) => x.code === 'malformed-xml')!;
    expect(p).toMatchObject({ severity: 'error', part: 'word/styles.xml', line: 2 });
  });

  it('reports dangling relationships, missing content types, orphans', async () => {
    const m = PackageModel.open(buildDocx());
    m.removePart('word/media/image1.png');
    m.addPart('word/unknown.weird', 'x');
    m.addPart('word/orphan.xml', '<o/>');
    const problems = await validatePackage(m);
    const codes = problems.map((p) => p.code);
    expect(codes).toContain('dangling-rel');
    expect(problems.find((p) => p.code === 'dangling-rel')!.message).toContain(
      'word/media/image1.png',
    );
    expect(problems.find((p) => p.code === 'no-content-type')!.part).toBe('word/unknown.weird');
    expect(problems.filter((p) => p.code === 'orphan').map((p) => p.part)).toEqual(
      expect.arrayContaining(['word/orphan.xml']),
    );
  });

  it('flags a package without content types', async () => {
    const m = PackageModel.open(zipFiles({ '_rels/.rels': '<Relationships/>' }));
    const codes = (await validatePackage(m)).map((p) => p.code);
    expect(codes).toContain('no-content-types');
  });
});
