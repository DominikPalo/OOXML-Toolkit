import { describe, expect, it } from 'vitest';
import { PackageModel } from '@core/package/model';
import { analyzePackage, contentTypeOf } from '@core/package/opc';
import {
  checkOdfPackage,
  humanDuration,
  manifestWithEntry,
  manifestWithRenamedEntry,
  odfOverviewRows,
  parseManifest,
  readOdfMeta,
} from '@core/package/odf';
import { partKind } from '@core/package/kinds';
import { lookupNamespace, tryParseXml } from '@core/xml/parser';
import { validatePackage } from '@core/package/validate';
import { ZipArchive, writeZip, type ZipWriteItem } from '@core/zip/zip';
import { buildDocx, buildOdp, zipFiles } from './fixtures/builders';

const MIME = 'application/vnd.oasis.opendocument.presentation';
const codes = (m: PackageModel): string[] => checkOdfPackage(m).map((p) => p.code);

describe('ODF detection', () => {
  it('recognises an ODP and uses content.xml as the main part', () => {
    const a = analyzePackage(PackageModel.open(buildOdp()));
    expect(a.type).toMatchObject({
      family: 'odf',
      extension: 'odp',
      label: 'OpenDocument presentation',
    });
    expect(a.mainPart).toBe('content.xml');
    expect(a.relationships.size).toBe(0);
  });

  it.each([
    ['presentation-template', 'otp', 'OpenDocument presentation template'],
    ['text', 'odt', 'OpenDocument text'],
    ['spreadsheet-template', 'ots', 'OpenDocument spreadsheet template'],
    ['text-master', 'odm', 'OpenDocument master document'],
    ['chart', 'odc', 'OpenDocument chart'],
  ])('knows the %s media type', (suffix, ext, label) => {
    const m = PackageModel.open(
      zipFiles({ mimetype: `application/vnd.oasis.opendocument.${suffix}`, 'content.xml': '<a/>' }),
    );
    expect(analyzePackage(m).type).toMatchObject({ family: 'odf', extension: ext, label });
  });

  it('still treats a package with a manifest but no mimetype as ODF', () => {
    const m = PackageModel.open(
      zipFiles({
        'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:x"/>',
        'content.xml': '<a/>',
      }),
    );
    expect(analyzePackage(m).type).toMatchObject({ family: 'odf', label: 'OpenDocument package' });
  });

  it('does not misclassify OOXML', () => {
    expect(analyzePackage(PackageModel.open(buildDocx())).type.family).toBe('word');
  });

  it('shows mimetype as text', () => {
    expect(partKind('mimetype')).toBe('text');
    expect(partKind('META-INF/manifest.xml')).toBe('xml');
    expect(partKind('Pictures/image1.png')).toBe('image');
  });
});

describe('media types', () => {
  it('come from the manifest, since ODF has no [Content_Types].xml', () => {
    const m = PackageModel.open(buildOdp());
    const types = analyzePackage(m).contentTypes;
    expect(contentTypeOf(types, 'content.xml')).toBe('text/xml');
    expect(contentTypeOf(types, 'Pictures/image1.png')).toBe('image/png');
    // the two bookkeeping entries are not listed in a manifest, yet are not "untyped"
    expect(contentTypeOf(types, 'mimetype')).toBe('text/plain');
    expect(contentTypeOf(types, 'META-INF/manifest.xml')).toBe('text/xml');
    expect(contentTypeOf(types, 'Pictures/other.png')).toBeUndefined();
  });

  it('follow edits of the manifest', () => {
    const m = PackageModel.open(buildOdp());
    const before = m.structureVersion;
    m.setText('Pictures/other.png', 'x');
    m.setText(
      'META-INF/manifest.xml',
      manifestWithEntry(m.getText('META-INF/manifest.xml').text, 'Pictures/other.png')!,
    );
    expect(m.structureVersion).toBeGreaterThan(before);
    expect(contentTypeOf(analyzePackage(m).contentTypes, 'Pictures/other.png')).toBe('image/png');
  });
});

describe('manifest', () => {
  it('lists parts, folders, the package media type and encryption', () => {
    const text =
      '<manifest:manifest xmlns:manifest="urn:x">' +
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/>` +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '<manifest:file-entry manifest:full-path="Pictures/" manifest:media-type=""/>' +
      '<manifest:file-entry manifest:full-path="secret.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1"/></manifest:file-entry>' +
      '</manifest:manifest>';
    const m = parseManifest(text)!;
    expect(m.rootMediaType).toBe(MIME);
    expect(m.entries.map((e) => [e.fullPath, e.mediaType, e.isDirectory, e.encrypted])).toEqual([
      ['content.xml', 'text/xml', false, false],
      ['Pictures/', '', true, false],
      ['secret.xml', 'text/xml', false, true],
    ]);
    expect(parseManifest('<other/>')).toBeUndefined();
    expect(parseManifest('<broken')).toBeUndefined();
  });

  it('adds an entry at the end, keeping the rest of the file untouched', () => {
    const model = PackageModel.open(buildOdp());
    const before = model.getText('META-INF/manifest.xml').text;
    const after = manifestWithEntry(before, 'Pictures/new "logo".svg')!;
    const parsed = parseManifest(after)!;
    expect(parsed.entries.at(-1)).toMatchObject({
      fullPath: 'Pictures/new "logo".svg',
      mediaType: 'image/svg+xml',
    });
    expect(after.startsWith(before.slice(0, before.lastIndexOf('</manifest:manifest>')))).toBe(
      true,
    );
    // adding the same path again changes nothing
    expect(manifestWithEntry(after, 'Pictures/new "logo".svg')).toBe(after);
    expect(manifestWithEntry('<broken', 'x')).toBeUndefined();
  });

  it('renames an entry', () => {
    const before = PackageModel.open(buildOdp()).getText('META-INF/manifest.xml').text;
    const after = manifestWithRenamedEntry(before, 'Pictures/image1.png', 'Pictures/logo.png')!;
    const paths = parseManifest(after)!.entries.map((e) => e.fullPath);
    expect(paths).toContain('Pictures/logo.png');
    expect(paths).not.toContain('Pictures/image1.png');
    expect(manifestWithRenamedEntry(before, 'nope.xml', 'x.xml')).toBe(before);
  });
});

describe('adding a manifest entry keeps the file well-formed and namespaced', () => {
  const NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
  const added = (xml: string): string => manifestWithEntry(xml, 'Pictures/new.png')!;

  /** Namespace of the attributes of the entry that was added. */
  function attributeNamespaces(xml: string): (string | undefined)[] {
    const doc = tryParseXml(xml).doc;
    expect(doc, 'the result must be well-formed').toBeDefined();
    const entry = doc!.root.elements.find((e) =>
      e.attrs.some((a) => a.value === 'Pictures/new.png'),
    );
    expect(entry).toBeDefined();
    return entry!.attrs
      .filter((a) => !a.name.startsWith('xmlns'))
      .map((a) => lookupNamespace(entry!, a.name.slice(0, a.name.indexOf(':'))));
  }

  it('with the usual manifest: prefix', () => {
    const out = added(
      `<manifest:manifest xmlns:manifest="${NS}" manifest:version="1.2">` +
        '<manifest:file-entry manifest:full-path="/" manifest:media-type="x"/></manifest:manifest>',
    );
    expect(out).toContain('<manifest:file-entry manifest:full-path="Pictures/new.png"');
    expect(attributeNamespaces(out)).toEqual([NS, NS]);
  });

  it('when the manifest namespace is the default one and another prefix is bound to it', () => {
    const out = added(
      `<manifest xmlns="${NS}" xmlns:m="${NS}" m:version="1.2">` +
        '<file-entry m:full-path="/" m:media-type="x"/></manifest>',
    );
    expect(out).toContain('<file-entry m:full-path="Pictures/new.png"');
    expect(out).not.toContain('xmlns:manifest=');
    expect(attributeNamespaces(out)).toEqual([NS, NS]);
  });

  it('when the manifest namespace is only the default one: declares a prefix for the attributes', () => {
    const out = added(`<manifest xmlns="${NS}"><file-entry/></manifest>`);
    expect(out).toContain(`<file-entry xmlns:manifest="${NS}" manifest:full-path=`);
    expect(attributeNamespaces(out)).toEqual([NS, NS]);
  });

  it('does not reuse a prefix that is bound to something else', () => {
    const out = added(`<manifest xmlns="${NS}" xmlns:manifest="urn:other"/>`);
    expect(out).toContain(`xmlns:manifest1="${NS}" manifest1:full-path=`);
    expect(attributeNamespaces(out)).toEqual([NS, NS]);
  });
});

describe('meta.xml', () => {
  const model = (): PackageModel =>
    PackageModel.open(
      buildOdp({
        keywords: ['kickoff', 'quarterly review', 'kickoff'],
        userDefined: [
          { name: 'Project', value: 'Atlas' },
          { name: 'Budget', value: '1200.5', type: 'float' },
          { name: 'Approved', value: 'true', type: 'boolean' },
        ],
      }),
    );

  it('reads the properties', () => {
    const meta = readOdfMeta(model())!;
    expect(meta).toMatchObject({
      title: 'Sample presentation',
      subject: 'Quarterly review',
      creator: 'Sample Editor',
      initialCreator: 'OOXML Toolkit',
      created: '2024-01-15T10:30:00.123456789',
      modified: '2024-03-02T08:15:42.5',
      language: 'en-US',
      editingCycles: '3',
      editingDuration: 'PT01H03M17S',
    });
    expect(meta.generator).toMatch(/^LibreOffice\//);
    expect(meta.keywords).toEqual(['kickoff', 'quarterly review']);
    expect(meta.statistics).toEqual({ 'page-count': '2', 'object-count': '6' });
    expect(meta.userDefined.map((u) => [u.name, u.value, u.type])).toEqual([
      ['Project', 'Atlas', 'text'],
      ['Budget', '1200.5', 'number'],
      ['Approved', 'true', 'yes/no'],
    ]);
  });

  it('turns them into overview rows', () => {
    const rows = odfOverviewRows(readOdfMeta(model())!, 'odp');
    expect(rows.properties).toEqual([
      ['Title', 'Sample presentation'],
      ['Subject', 'Quarterly review'],
      ['Author', 'OOXML Toolkit'],
      ['Last modified by', 'Sample Editor'],
      ['Keywords', 'kickoff, quarterly review'],
      ['Created', '2024-01-15T10:30:00.123456789'],
      ['Modified', '2024-03-02T08:15:42.5'],
      ['Language', 'en-US'],
      ['Editing cycles', '3'],
      ['Editing time', '1 h 3 min 17 s'],
    ]);
    expect(rows.application.map(([k, v]) => `${k}=${v.slice(0, 11)}`)).toEqual([
      'Application=LibreOffice',
      'Slides=2',
      'Objects=6',
    ]);
    expect(odfOverviewRows(readOdfMeta(model())!, 'odt').application[1]).toEqual(['Pages', '2']);
  });

  it('has nothing to read without meta.xml', () => {
    expect(readOdfMeta(PackageModel.open(zipFiles({ mimetype: MIME })))).toBeUndefined();
  });

  it.each([
    ['PT01H03M17S', '1 h 3 min 17 s'],
    ['PT0H03M17S', '3 min 17 s'],
    ['PT45S', '45 s'],
    ['P1DT2H', '1 d 2 h'],
    ['PT00H00M00S', '0 s'],
    ['not a duration', 'not a duration'],
  ])('formats duration %s', (iso, text) => expect(humanDuration(iso)).toBe(text));
});

describe('ODF package check', () => {
  it('finds nothing wrong with a well-formed package', async () => {
    const m = PackageModel.open(buildOdp());
    expect(checkOdfPackage(m)).toEqual([]);
    expect((await validatePackage(m)).filter((p) => p.severity !== 'info')).toEqual([]);
  });

  it('requires mimetype, manifest and content', () => {
    expect(
      codes(
        PackageModel.open(
          zipFiles({
            'content.xml': '<a/>',
            'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:x"/>',
          }),
        ),
      ),
    ).toContain('odf-no-mimetype');
    expect(codes(PackageModel.open(zipFiles({ mimetype: MIME, 'content.xml': '<a/>' })))).toContain(
      'odf-no-manifest',
    );
    expect(
      codes(
        PackageModel.open(
          zipFiles({
            mimetype: MIME,
            'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:x"/>',
          }),
        ),
      ),
    ).toContain('odf-no-content');
  });

  it('requires mimetype to be the first entry', () => {
    const files = zipFiles({
      'content.xml': '<a/>',
      mimetype: MIME,
      'META-INF/manifest.xml': '<manifest:manifest xmlns:manifest="urn:x"/>',
    });
    const p = checkOdfPackage(PackageModel.open(files)).find(
      (x) => x.code === 'odf-mimetype-order',
    )!;
    expect(p.message).toContain('entry 2');
  });

  it('requires mimetype to be stored, and flags whitespace and a mismatch with the manifest', () => {
    const padded = MIME + ' '.repeat(400); // compressible, so the entry really gets deflated
    const zip = writeZip([
      { kind: 'data', name: 'mimetype', data: new TextEncoder().encode(padded), method: 8 },
      { kind: 'data', name: 'content.xml', data: new TextEncoder().encode('<a/>') },
      {
        kind: 'data',
        name: 'META-INF/manifest.xml',
        data: new TextEncoder().encode(
          '<manifest:manifest xmlns:manifest="urn:x"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
        ),
      },
    ]);
    const c = codes(PackageModel.open(zip));
    expect(c).toContain('odf-mimetype-compressed');
    expect(c).toContain('odf-mimetype-whitespace');
    expect(c).toContain('odf-mimetype-mismatch');
  });

  it('compares the manifest with the parts', () => {
    const m = PackageModel.open(buildOdp());
    m.removePart('Pictures/image1.png'); // still listed
    m.addPart('Extra/data.bin', new Uint8Array([1])); // not listed
    const problems = checkOdfPackage(m);
    expect(problems.find((p) => p.code === 'odf-manifest-missing-part')!.message).toContain(
      'Pictures/image1.png',
    );
    expect(problems.find((p) => p.code === 'odf-not-in-manifest')).toMatchObject({
      severity: 'warning',
      part: 'Extra/data.bin',
    });
  });

  it('notes encrypted entries', () => {
    const m = PackageModel.open(buildOdp());
    m.setText(
      'META-INF/manifest.xml',
      m
        .getText('META-INF/manifest.xml')
        .text.replace(
          'manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
          'manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data/></manifest:file-entry>',
        )
        .replace(
          '<manifest:file-entry manifest:full-path="content.xml"',
          '<manifest:file-entry manifest:full-path="content.xml"',
        ),
    );
    expect(checkOdfPackage(m).find((p) => p.code === 'odf-encrypted')).toMatchObject({
      severity: 'info',
      part: 'content.xml',
    });
  });
});

describe('saving ODF', () => {
  it('keeps mimetype first and stored, also after it was edited', () => {
    const m = PackageModel.open(buildOdp());
    expect(ZipArchive.open(m.serialize()).entries[0]).toMatchObject({
      name: 'mimetype',
      method: 0,
    });
    m.setText('mimetype', MIME + '\n');
    m.setText('content.xml', m.getText('content.xml').text.replace('Welcome', 'Hello'));
    const entries = ZipArchive.open(m.serialize()).entries;
    expect(entries[0]).toMatchObject({ name: 'mimetype', method: 0 });
    expect(checkOdfPackage(PackageModel.open(m.serialize())).map((p) => p.code)).toEqual([
      'odf-mimetype-whitespace',
    ]);
  });

  it('a package freshly written by the fixtures has a stored, first mimetype', () => {
    expect(ZipArchive.open(buildOdp()).entries[0]).toMatchObject({ name: 'mimetype', method: 0 });
  });
});

describe('ODF package check on damaged packages', () => {
  const enc = new TextEncoder();
  const MANIFEST = 'META-INF/manifest.xml';

  type DataItem = Extract<ZipWriteItem, { kind: 'data' }>;

  /** The fixture's entries, with `change` applied to each. */
  function repack(change: (item: DataItem) => DataItem | undefined): Uint8Array {
    const zip = ZipArchive.open(buildOdp());
    const items: DataItem[] = [];
    for (const e of zip.entries) {
      const item: DataItem = { kind: 'data', name: e.name, data: zip.read(e) };
      const changed = change(item);
      if (changed) items.push(changed);
    }
    return writeZip(items);
  }

  it('reports a manifest that is XML but not a manifest', () => {
    const m = PackageModel.open(
      repack((i) => (i.name === MANIFEST ? { ...i, data: enc.encode('<other/>') } : i)),
    );
    expect(checkOdfPackage(m).find((p) => p.code === 'odf-manifest-invalid')).toMatchObject({
      severity: 'error',
      part: MANIFEST,
      message: expect.stringContaining('<other>'),
    });
    expect(codes(m)).not.toContain('odf-no-manifest');
  });

  it('leaves a manifest that is not well-formed to the XML check', () => {
    const m = PackageModel.open(
      repack((i) => (i.name === MANIFEST ? { ...i, data: enc.encode('<manifest') } : i)),
    );
    expect(codes(m)).not.toContain('odf-manifest-invalid');
  });

  it('requires mimetype to precede directory entries too', () => {
    const items: ZipWriteItem[] = [
      { kind: 'data', name: 'META-INF/', data: new Uint8Array() },
      ...ZipArchive.open(buildOdp()).entries.map((e): ZipWriteItem => ({
        kind: 'data',
        name: e.name,
        data: ZipArchive.open(buildOdp()).read(e),
      })),
    ];
    const m = PackageModel.open(writeZip(items));
    // part names alone would put mimetype first; the archive does not
    expect(m.names()[0]).toBe('mimetype');
    expect(checkOdfPackage(m).find((p) => p.code === 'odf-mimetype-order')).toMatchObject({
      message: expect.stringContaining('entry 2'),
    });
  });

  it('takes the order from what will be written, after edits', () => {
    const m = PackageModel.open(repack((i) => (i.name === 'mimetype' ? undefined : i)));
    expect(codes(m)).toContain('odf-no-mimetype');
    m.addPart('mimetype', enc.encode(MIME)); // appended: it would be written last
    expect(m.entryOrder().at(-1)).toBe('mimetype');
    expect(codes(m)).toContain('odf-mimetype-order');
    expect(codes(m)).not.toContain('odf-no-mimetype');
  });

  it('keeps mimetype in place when it is removed and put back', () => {
    const m = PackageModel.open(buildOdp());
    m.removePart('mimetype');
    m.addPart('mimetype', enc.encode(MIME));
    expect(m.entryOrder()[0]).toBe('mimetype');
    expect(codes(m)).not.toContain('odf-mimetype-order');
    expect(ZipArchive.open(m.serialize()).entries[0].name).toBe('mimetype');
  });

  /** Flip a byte of the payload of `name`, which is stored uncompressed so that only its CRC fails. */
  function corrupt(name: string): Uint8Array {
    const data = repack((i) => (i.name === name ? { ...i, method: 0 } : i));
    const entry = ZipArchive.open(data).get(name)!;
    expect(entry.method).toBe(0);
    const nameLength = new TextEncoder().encode(name).length;
    data[entry.localOffset + 30 + nameLength] ^= 0xff; // 30-byte local header, then the name
    return data;
  }

  it('still analyses and checks a package whose mimetype is corrupt', () => {
    const m = PackageModel.open(corrupt('mimetype'));
    expect(() => analyzePackage(m)).not.toThrow();
    expect(analyzePackage(m).type.family).toBe('odf');
    expect(checkOdfPackage(m).find((p) => p.code === 'unreadable')).toMatchObject({
      part: 'mimetype',
    });
  });

  it.each([MANIFEST, 'meta.xml'])('can still be opened when %s is corrupt', async (name) => {
    const m = PackageModel.open(corrupt(name));
    expect(() => m.getText(name)).toThrow(/CRC/);
    // every reader the UI uses on opening must survive it
    expect(() => analyzePackage(m)).not.toThrow();
    expect(analyzePackage(m).type.family).toBe('odf');
    expect(readOdfMeta(m) === undefined).toBe(name === 'meta.xml');
    expect(() => checkOdfPackage(m)).not.toThrow();
    // ... and the package check names the damaged part instead of failing
    const problems = await validatePackage(m);
    expect(problems.find((p) => p.code === 'unreadable')).toMatchObject({ part: name });
    if (name === MANIFEST)
      expect(analyzePackage(m).contentTypes.overrides.has('content.xml')).toBe(false);
  });
});
