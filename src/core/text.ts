/** Text decoding/encoding that remembers how a part was stored so it can be written back unchanged. */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1';

export interface TextFormat {
  encoding: TextEncodingName;
  /** Whether a byte-order mark was present. */
  bom: boolean;
}

export interface DecodedText extends TextFormat {
  text: string;
}

export const DEFAULT_TEXT_FORMAT: TextFormat = { encoding: 'utf-8', bom: false };

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();

export function decodeText(bytes: Uint8Array): DecodedText {
  const n = bytes.length;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: utf8Strict.decode(bytes.subarray(3)), encoding: 'utf-8', bom: true };
  }
  if (n >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le',
      bom: true,
    };
  }
  if (n >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be',
      bom: true,
    };
  }
  // UTF-16 without BOM: "<\0?\0" or "\0<\0?"
  if (n >= 4 && bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] !== 0 && bytes[3] === 0) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le', bom: false };
  }
  if (n >= 4 && bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0 && bytes[3] !== 0) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be', bom: false };
  }
  try {
    return { text: utf8Strict.decode(bytes), encoding: 'utf-8', bom: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'latin1', bom: false };
  }
}

export function encodeText(text: string, format: TextFormat = DEFAULT_TEXT_FORMAT): Uint8Array {
  switch (format.encoding) {
    case 'utf-16le':
    case 'utf-16be': {
      const le = format.encoding === 'utf-16le';
      const off = format.bom ? 2 : 0;
      const out = new Uint8Array(off + text.length * 2);
      const view = new DataView(out.buffer);
      if (format.bom) view.setUint16(0, 0xfeff, le);
      for (let i = 0; i < text.length; i++) view.setUint16(off + i * 2, text.charCodeAt(i), le);
      return out;
    }
    case 'latin1': {
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out[i] = c < 256 ? c : 0x3f;
      }
      return out;
    }
    default: {
      const body = utf8Encoder.encode(text);
      if (!format.bom) return body;
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(body, 3);
      return out;
    }
  }
}

export function byteLength(text: string, format: TextFormat = DEFAULT_TEXT_FORMAT): number {
  return encodeText(text, format).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}
