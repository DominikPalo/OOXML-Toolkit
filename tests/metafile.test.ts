import { describe, expect, it } from 'vitest';
import { imageMime, isMetafile, isPreviewableImage, partKind } from '@core/package/kinds';
import { metafileToSvg } from '@core/preview/metafile';
import { buildEmf, buildWmf, emfBrush, emfPen, emfPolygon16, rgb } from './fixtures/metafile';

describe('metafile classification', () => {
  it('treats EMF and WMF as previewable images that need conversion', () => {
    for (const name of ['ppt/media/image1.emf', 'word/media/A.WMF']) {
      expect(partKind(name)).toBe('image');
      expect(isPreviewableImage(name)).toBe(true);
      expect(isMetafile(name)).toBe(true);
    }
    expect(isMetafile('ppt/media/image1.png')).toBe(false);
    expect(isPreviewableImage('ppt/media/image1.png')).toBe(true);
    expect(isPreviewableImage('x/y.tiff')).toBe(false);
    expect(imageMime('a.emf')).toBe('image/emf');
  });
});

describe('metafileToSvg', () => {
  it('draws an EMF polygon and a stroked line as SVG', async () => {
    const emf = buildEmf([
      ...emfBrush(1, rgb(255, 0, 0)),
      emfPolygon16([
        [10, 10],
        [60, 10],
        [60, 60],
      ]),
      ...emfPen(2, 3, rgb(0, 0, 255)),
      [27, 0, 99], // MOVETOEX
      [54, 99, 0], // LINETO
    ]);
    const svg = await metafileToSvg(emf);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg!.toLowerCase()).toMatch(/#ff0000|rgb\(255,\s*0,\s*0\)/);
    expect(svg!.toLowerCase()).toMatch(/#0000ff|rgb\(0,\s*0,\s*255\)/);
    expect(svg).toContain('<path');
  });

  it('draws a placeable WMF', async () => {
    const svg = await metafileToSvg(buildWmf());
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('returns undefined for data that is not a metafile', async () => {
    expect(await metafileToSvg(new Uint8Array())).toBeUndefined();
    expect(await metafileToSvg(new TextEncoder().encode('not a metafile at all'))).toBeUndefined();
  });

  it('survives a truncated drawing', async () => {
    const emf = buildEmf([
      emfPolygon16([
        [1, 1],
        [50, 1],
        [50, 50],
      ]),
      [54, 10, 10],
    ]);
    // Cut in the middle of the last record: must not throw, whatever it returns.
    const cut = emf.subarray(0, emf.length - 30);
    await expect(metafileToSvg(cut)).resolves.toSatisfy(
      (v: string | undefined) => v === undefined || v.startsWith('<svg'),
    );
  });

  it('handles drawings with far more shapes than fit in a spread call', async () => {
    // Regression: emf-converter spread every top-level element into push(), which overflows the
    // call stack past ~120k elements (a real 25 MB CAD export has 410k). Fixed upstream in 4.11.3.
    const records: [number, ...number[]][] = [...emfBrush(1, rgb(10, 20, 30))];
    for (let i = 0; i < 150_000; i++) {
      const x = i % 400;
      const y = Math.floor(i / 400) % 400;
      records.push(
        emfPolygon16([
          [x, y],
          [x + 2, y],
          [x + 2, y + 2 + (i % 3)],
        ]),
      );
      if (i % 5 === 0) records.push(...emfBrush(2 + (i % 7), rgb(i % 256, 50, 100)));
    }
    const svg = await metafileToSvg(buildEmf(records, { size: 400 }));
    expect(svg).toMatch(/^<svg /);
    expect((svg!.match(/<path/g) ?? []).length).toBeGreaterThan(1000);
  }, 120_000);
});
