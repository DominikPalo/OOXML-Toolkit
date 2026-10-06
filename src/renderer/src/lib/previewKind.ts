import { extensionOf, isPreviewableImage, type PartKind } from '@core/package/kinds';
import type { DetailTab } from '../store/types';

export type PreviewKind = 'sheet' | 'doc' | 'slide';

export function previewKindOf(contentType: string | undefined): PreviewKind | undefined {
  if (!contentType) return undefined;
  if (contentType.endsWith('spreadsheetml.worksheet+xml')) return 'sheet';
  if (
    /wordprocessingml\.(document|template)(\.macroEnabled(Template)?)?\.main\+xml$/.test(
      contentType,
    )
  )
    return 'doc';
  if (contentType.endsWith('presentationml.slide+xml')) return 'slide';
  return undefined;
}

/** Detail tabs that make sense for the selection, in display order. */
export function tabsFor(opts: {
  kind: PartKind | undefined;
  part: string | undefined;
  hasElement: boolean;
  preview: PreviewKind | undefined;
}): DetailTab[] {
  const { kind, part, hasElement, preview } = opts;
  if (!part || !kind) return [];
  if (hasElement) return ['source', 'inspector'];
  switch (kind) {
    case 'xml':
      return [...(preview ? (['preview'] as const) : []), 'source', 'relationships', 'info'];
    case 'rels':
      return ['table', 'source', 'info'];
    case 'image':
      return [
        ...(isPreviewableImage(part) ? (['preview'] as const) : []),
        ...(extensionOf(part) === 'svg' ? (['source'] as const) : []),
        'hex',
        'info',
      ];
    case 'text':
      return ['source', 'hex', 'info'];
    case 'package':
      return ['info', 'hex'];
    default:
      return ['hex', 'info'];
  }
}
