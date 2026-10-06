import { useEffect, useState } from 'react';
import { imageMime, isMetafile } from '@core/package/kinds';
import { metafileToSvg } from '@core/preview/metafile';

/** Converted metafiles by their bytes: part bytes are cached by the model, so re-selecting is free. */
const svgCache = new WeakMap<Uint8Array, Promise<string | undefined>>();

/** Object URL for an image an <img> can decode itself (anything but EMF/WMF). */
export function nativeImageUrl(name: string, bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(name) }));
}

/**
 * Object URL an <img> can show for an image part; EMF/WMF are converted to SVG first.
 * Undefined when the image cannot be shown. The caller revokes the URL.
 */
export async function imageUrl(name: string, bytes: Uint8Array): Promise<string | undefined> {
  if (!isMetafile(name)) return nativeImageUrl(name, bytes);
  let svg = svgCache.get(bytes);
  if (!svg) svg = svgCache.set(bytes, metafileToSvg(bytes)).get(bytes)!;
  const markup = await svg;
  return markup ? URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' })) : undefined;
}

export type ImageState = 'loading' | 'ready' | 'failed';

/** `imageUrl` as a hook: follows `name`/`bytes`, revokes superseded URLs, ignores stale results. */
export function useImageUrl(
  name: string,
  bytes: Uint8Array | undefined,
): { url: string | undefined; state: ImageState } {
  const [result, setResult] = useState<{ url?: string; state: ImageState }>({ state: 'loading' });
  useEffect(() => {
    if (!bytes) return setResult({ state: 'failed' });
    let live = true;
    let made: string | undefined;
    setResult({ state: 'loading' });
    imageUrl(name, bytes)
      .then((url) => {
        if (!live) return url && URL.revokeObjectURL(url);
        made = url;
        setResult(url ? { url, state: 'ready' } : { state: 'failed' });
      })
      .catch(() => live && setResult({ state: 'failed' }));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [name, bytes]);
  return { url: result.url, state: result.state };
}
