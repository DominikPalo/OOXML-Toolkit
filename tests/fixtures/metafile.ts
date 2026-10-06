/** Builders for tiny Windows metafiles (EMF and WMF) used to test the SVG conversion. */

class Writer {
  private chunks: number[] = [];
  get length(): number {
    return this.chunks.length;
  }
  u8(v: number): this {
    this.chunks.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v: number): this {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** A COLORREF (0x00BBGGRR). */
export const rgb = (r: number, g: number, b: number): number => (b << 16) | (g << 8) | r;

export interface EmfOptions {
  /** Device pixels covered by the drawing (inclusive bounds). */
  size?: number;
}

/** Builds an EMF from record bodies: `[type, ...payload words]`. EOF and the header are added. */
export function buildEmf(records: [number, ...number[]][], { size = 100 }: EmfOptions = {}) {
  const body = new Writer();
  for (const [type, ...words] of [...records, [14, 0, 16, 20] as [number, ...number[]]]) {
    body.u32(type).u32(8 + words.length * 4);
    for (const w of words) body.u32(w);
  }
  const header = new Writer()
    .u32(1) // EMR_HEADER
    .u32(108)
    .u32(0) // rclBounds
    .u32(0)
    .u32(size - 1)
    .u32(size - 1)
    .u32(0) // rclFrame, 0.01 mm
    .u32(0)
    .u32(size * 26)
    .u32(size * 26)
    .u32(0x464d4520) // " EMF"
    .u32(0x10000)
    .u32(108 + body.length)
    .u32(records.length + 2)
    .u16(8) // handles
    .u16(0)
    .u32(0) // description
    .u32(0)
    .u32(0) // palette entries
    .u32(1024) // device, pixels
    .u32(768)
    .u32(320) // device, mm
    .u32(240)
    .u32(0) // pixel format
    .u32(0)
    .u32(0) // OpenGL
    .u32(320000) // device, µm
    .u32(240000);
  return Uint8Array.from([...header.bytes(), ...body.bytes()]);
}

const pack16 = (x: number, y: number): number => ((y & 0xffff) << 16) | (x & 0xffff);

/** EMR_CREATEPEN + EMR_SELECTOBJECT: a solid pen of the given width and color. */
export const emfPen = (handle: number, width: number, color: number): [number, ...number[]][] => [
  [38, handle, 0, width, 0, color],
  [37, handle],
];

/** EMR_CREATEBRUSHINDIRECT + EMR_SELECTOBJECT: a solid brush. */
export const emfBrush = (handle: number, color: number): [number, ...number[]][] => [
  [39, handle, 0, color, 0],
  [37, handle],
];

/** EMR_POLYGON16 with a (loose) bounds rectangle. */
export function emfPolygon16(points: [number, number][]): [number, ...number[]] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [
    86,
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
    points.length,
    ...points.map(([x, y]) => pack16(x, y)),
  ];
}

/** A minimal placeable WMF: a window of `size` units with one red line across it. */
export function buildWmf(size = 100): Uint8Array {
  const rec = (fn: number, ...params: number[]): number[] => {
    const w = new Writer().u32(3 + params.length).u16(fn);
    for (const p of params) w.u16(p);
    return [...w.bytes()];
  };
  const records = [
    ...rec(0x020c, size, size), // SetWindowExt (y, x)
    ...rec(0x020b, 0, 0), // SetWindowOrg
    ...rec(0x02fa, 0, 2, 0, 0x00ff, 0x0000), // CreatePenIndirect: solid, width 2, red
    ...rec(0x012d, 0), // SelectObject
    ...rec(0x0214, 0, 0), // MoveTo (y, x)
    ...rec(0x0213, size, size), // LineTo (y, x)
    ...rec(0x0000), // EOF
  ];
  const placeable = new Writer()
    .u32(0x9ac6cdd7)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(size)
    .u16(size)
    .u16(1440)
    .u32(0);
  const pb = placeable.bytes();
  let checksum = 0;
  for (let i = 0; i < 20; i += 2) checksum ^= pb[i] | (pb[i + 1] << 8);
  const meta = new Writer()
    .u16(1) // memory metafile
    .u16(9)
    .u16(0x300)
    .u32((18 + records.length) / 2)
    .u16(1)
    .u32(5)
    .u16(0);
  return Uint8Array.from([...pb, checksum & 0xffff, checksum >>> 8, ...meta.bytes(), ...records]);
}
