import { describe, expect, it } from 'vitest';
import { PackageModel } from '@core/package/model';
import { analyzePackage } from '@core/package/opc';
import { tabsFor } from '../src/renderer/src/lib/previewKind';
import { buildRows } from '../src/renderer/src/lib/treeModel';
import type { DocTab } from '../src/renderer/src/store/types';
import { buildDocx, buildOdp } from './fixtures/builders';

/** The tree only reads a few fields of the tab. */
function relationshipRows(model: PackageModel, expanded: Record<string, true> = {}) {
  const tab = {
    model,
    name: 'test',
    treeMode: 'relationships',
    expanded: { root: true, ...expanded },
    childLimits: {},
  } as unknown as DocTab;
  return buildRows(tab, analyzePackage(model));
}

describe('the Relations tree of an ODF package is the manifest', () => {
  it('lists mimetype, the manifest and every listed part with its media type', () => {
    const rows = relationshipRows(PackageModel.open(buildOdp()));
    expect(rows.map((r) => r.label)).toEqual([
      'test',
      'mimetype',
      'META-INF/manifest.xml',
      'content.xml',
      'styles.xml',
      'meta.xml',
      'settings.xml',
      'Pictures/image1.png',
      'Thumbnails/thumbnail.png',
    ]);
    const png = rows.find((r) => r.label === 'Pictures/image1.png')!;
    expect(png).toMatchObject({
      kind: 'rel',
      part: 'Pictures/image1.png',
      partKind: 'image',
      missing: false,
    });
    expect(png.hint?.text).toBe('image/png');
    expect(rows.find((r) => r.label === 'mimetype')).toMatchObject({
      kind: 'part',
      partKind: 'text',
    });
  });

  it('marks a listed part that is gone and opens the manifest for it', () => {
    const m = PackageModel.open(buildOdp());
    m.removePart('Pictures/image1.png');
    const row = relationshipRows(m).find((r) => r.label === 'Pictures/image1.png')!;
    expect(row).toMatchObject({ missing: true, part: 'META-INF/manifest.xml' });
  });

  it('groups parts the manifest does not list', () => {
    const m = PackageModel.open(buildOdp());
    m.addPart('Extra/notes.xml', '<n/>');
    const collapsed = relationshipRows(m);
    expect(collapsed.at(-1)).toMatchObject({
      kind: 'group',
      label: 'Not in manifest (1)',
      expanded: false,
    });
    const open = relationshipRows(m, { orphans: true });
    expect(open.at(-1)).toMatchObject({ kind: 'part', part: 'Extra/notes.xml', depth: 2 });
  });

  it('shows encryption in the hint', () => {
    const m = PackageModel.open(buildOdp());
    m.setText(
      'META-INF/manifest.xml',
      m
        .getText('META-INF/manifest.xml')
        .text.replace(
          '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
          '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data/></manifest:file-entry>',
        ),
    );
    expect(relationshipRows(m).find((r) => r.label === 'content.xml')!.hint?.text).toBe(
      'text/xml · encrypted',
    );
  });

  it('leaves the OOXML relationship view alone', () => {
    const rows = relationshipRows(PackageModel.open(buildDocx()), { 'p:word/document.xml': true });
    expect(rows.map((r) => r.label)).toContain('[Content_Types].xml');
    expect(rows.find((r) => r.kind === 'rel')).toMatchObject({ label: 'document.xml' });
  });
});

describe('detail tabs of an XML part', () => {
  const opts = { kind: 'xml', part: 'content.xml', hasElement: false, preview: undefined } as const;

  it('offer relationships for OOXML only', () => {
    expect(tabsFor(opts)).toEqual(['source', 'relationships', 'info']);
    expect(tabsFor({ ...opts, odf: true })).toEqual(['source', 'info']);
  });
});
