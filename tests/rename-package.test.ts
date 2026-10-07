import { describe, expect, it } from 'vitest';
import { buildDocx, zipFiles } from './fixtures/builders';
import { PackageModel } from '../src/core/package/model';
import { renamePackagePart } from '../src/core/package/rename';
import { analyzePackage, contentTypeOf, relsPartFor } from '../src/core/package/opc';
import { validatePackage } from '../src/core/package/validate';

describe('renaming package parts', () => {
  it.each(['word/renamed.xml', 'other/document with spaces.xml'])(
    'preserves incoming and outgoing relationships when renaming to %s',
    async (next) => {
      const model = PackageModel.open(buildDocx());
      const part = 'word/document.xml';
      const original = model.getBytes(part);
      const rels = model.getText(relsPartFor(part)).text;
      const originalType = contentTypeOf(analyzePackage(model).contentTypes, part);
      renamePackagePart(model, part, next);
      expect(model.has(part)).toBe(false);
      expect(model.has(relsPartFor(part))).toBe(false);
      expect(model.getBytes(next)).toEqual(original);
      const analysis = analyzePackage(model);
      expect(analysis.mainPart).toBe(next);
      expect(contentTypeOf(analysis.contentTypes, next)).toBe(originalType);
      expect(analysis.relationships.get(next)?.map((r) => r.resolved)).toEqual([
        'word/styles.xml',
        'word/media/image1.png',
        undefined,
      ]);
      expect(analysis.relationships.get(next)?.[2].target).toBe('https://example.com/');
      expect((await validatePackage(model)).filter((p) => p.severity === 'error')).toEqual([]);
      const saved = PackageModel.open(model.serialize());
      expect(analyzePackage(saved).mainPart).toBe(next);
      model.undo();
      expect(model.has(next)).toBe(false);
      expect(model.getText(relsPartFor(part)).text).toBe(rels);
      expect(model.isDirty()).toBe(false);
      model.redo();
      expect(analyzePackage(model).mainPart).toBe(next);
    },
  );

  it('preserves fragments, absolute targets and self references', () => {
    const model = PackageModel.open(buildDocx());
    const own = 'word/_rels/document.xml.rels';
    model.setText(
      own,
      model
        .getText(own)
        .text.replace('Target="styles.xml"', 'Target="/word/styles.xml#style"')
        .replace(
          '</Relationships>',
          '<Relationship Id="self" Type="urn:self" Target="document.xml#anchor"/></Relationships>',
        ),
    );
    model.setText(
      '_rels/.rels',
      model.getText('_rels/.rels').text.replace('word/document.xml"', 'word/document.xml#main"'),
    );
    renamePackagePart(model, 'word/document.xml', 'other/renamed.xml');
    const analysis = analyzePackage(model);
    const outgoing = analysis.relationships.get('other/renamed.xml')!;
    expect(outgoing[0].target).toBe('/word/styles.xml#style');
    expect(outgoing.find((r) => r.id === 'self')).toMatchObject({
      target: 'renamed.xml#anchor',
      resolved: 'other/renamed.xml',
    });
    expect(analysis.relationships.get('')?.[0].target).toBe('other/renamed.xml#main');
  });

  it('rejects a conflicting companion relationship file before changing anything', () => {
    const model = PackageModel.open(buildDocx());
    model.addPart('word/_rels/renamed.xml.rels', '<Relationships/>');
    const version = model.version;
    expect(() => renamePackagePart(model, 'word/document.xml', 'word/renamed.xml')).toThrow(
      'already exists',
    );
    expect(model.version).toBe(version);
    expect(model.has('word/document.xml')).toBe(true);
    expect(model.has('word/renamed.xml')).toBe(false);
  });

  it.each([299, 300])('undoes the whole rename at %i existing history entries', (count) => {
    const model = PackageModel.open(buildDocx());
    for (let i = 0; i < count; i++)
      model.setText('history.txt', String(i), { coalesceKey: undefined });
    renamePackagePart(model, 'word/document.xml', 'other/renamed.xml');
    model.undo();
    expect(model.has('other/renamed.xml')).toBe(false);
    expect(model.has('other/_rels/renamed.xml.rels')).toBe(false);
    expect(analyzePackage(model).mainPart).toBe('word/document.xml');
    expect(analyzePackage(model).relationships.get('word/document.xml')).toHaveLength(3);
  });

  it('keeps updating the manifest when renaming an ODF part', () => {
    const model = PackageModel.open(
      zipFiles({
        mimetype: 'application/vnd.oasis.opendocument.text',
        'content.xml': '<document/>',
        'META-INF/manifest.xml':
          '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
      }),
    );
    renamePackagePart(model, 'content.xml', 'renamed.xml');
    expect(model.getText('META-INF/manifest.xml').text).toContain(
      'manifest:full-path="renamed.xml"',
    );
    model.undo();
    expect(model.isDirty()).toBe(false);
  });
});
