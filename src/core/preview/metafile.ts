/**
 * Windows metafiles (EMF, EMF+ and WMF) → SVG. Chromium cannot decode them in an <img>, so image
 * parts of these types are replayed into SVG markup first. Read-only; never throws.
 */
import { convertMetafileToSvg } from 'emf-converter';

/** Replay limit per metafile. A CAD floor plan is ~430k records; this only stops pathological files. */
const MAX_RECORDS = 1_000_000;

/** SVG markup for an EMF/WMF file, or undefined when it is not a valid metafile or cannot be drawn. */
export async function metafileToSvg(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const svg = await convertMetafileToSvg(copy as ArrayBuffer, { maxRecords: MAX_RECORDS });
    return svg || undefined;
  } catch {
    return undefined;
  }
}
