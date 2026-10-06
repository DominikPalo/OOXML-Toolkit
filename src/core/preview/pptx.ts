/** Read-only extraction of slide content: shapes with geometry and text. Never throws on odd input. */
import type { PartSource } from '../package/model';
import { analyzePackage, type PackageAnalysis } from '../package/opc';
import {
  child,
  childrenNamed,
  getAttr,
  textContent,
  tryParseXml,
  type XmlDocument,
  type XmlElement,
} from '../xml/parser';

export interface SlideRef {
  part: string;
  /** 1-based. */
  index: number;
  title: string;
}

export interface SlideSize {
  width: number;
  height: number;
}

export interface SlideShape {
  kind: 'text' | 'picture' | 'table' | 'chart' | 'group' | 'other';
  name: string;
  /** EMU, absolute on the slide. */
  x: number;
  y: number;
  cx: number;
  cy: number;
  paragraphs: string[];
  /** Placeholder type (`title`, `body`, …) or `ph` when it has none. */
  placeholder?: string;
  imagePart?: string;
  fontSizePt?: number;
  /** Degrees. */
  rotation?: number;
}

export interface SlideData {
  size: SlideSize;
  shapes: SlideShape[];
  notes?: string;
}

const DEFAULT_SIZE: SlideSize = { width: 9144000, height: 6858000 };

const parse = (src: PartSource, part: string | undefined): XmlDocument | undefined =>
  part && src.has(part) ? tryParseXml(src.getText(part).text).doc : undefined;

const relAttr = (el: XmlElement, local: string): string | undefined =>
  el.attrs.find((a) => a.name.endsWith(`:${local}`))?.value;
const num = (v: string | undefined): number => (v === undefined ? 0 : Number(v) || 0);

function presentationPart(analysis: PackageAnalysis): string | undefined {
  return analysis.mainPart;
}

export function readSlideSize(src: PartSource): SlideSize {
  const main = presentationPart(analyzePackage(src));
  const doc = parse(src, main);
  const sz = doc && child(doc.root, 'sldSz');
  if (!sz) return DEFAULT_SIZE;
  return {
    width: num(getAttr(sz, 'cx')) || DEFAULT_SIZE.width,
    height: num(getAttr(sz, 'cy')) || DEFAULT_SIZE.height,
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

interface Xfrm {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot: number;
  chX: number;
  chY: number;
  chCx: number;
  chCy: number;
}

function readXfrm(el: XmlElement | undefined): Xfrm | undefined {
  if (!el) return undefined;
  const off = child(el, 'off');
  const ext = child(el, 'ext');
  if (!off || !ext) return undefined;
  const chOff = child(el, 'chOff');
  const chExt = child(el, 'chExt');
  return {
    x: num(getAttr(off, 'x')),
    y: num(getAttr(off, 'y')),
    cx: num(getAttr(ext, 'cx')),
    cy: num(getAttr(ext, 'cy')),
    rot: num(getAttr(el, 'rot')),
    chX: num(chOff && getAttr(chOff, 'x')),
    chY: num(chOff && getAttr(chOff, 'y')),
    chCx: num(chExt && getAttr(chExt, 'cx')) || num(getAttr(ext, 'cx')),
    chCy: num(chExt && getAttr(chExt, 'cy')) || num(getAttr(ext, 'cy')),
  };
}

/** Affine map from a group's child coordinates to slide coordinates. */
interface Transform {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}
const IDENTITY: Transform = { sx: 1, sy: 1, tx: 0, ty: 0 };

function enterGroup(parent: Transform, g: Xfrm): Transform {
  const kx = g.chCx ? g.cx / g.chCx : 1;
  const ky = g.chCy ? g.cy / g.chCy : 1;
  const sx = parent.sx * kx;
  const sy = parent.sy * ky;
  return {
    sx,
    sy,
    tx: parent.tx + parent.sx * g.x - sx * g.chX,
    ty: parent.ty + parent.sy * g.y - sy * g.chY,
  };
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

function paragraphText(doc: XmlDocument, p: XmlElement): string {
  let out = '';
  for (const c of p.elements) {
    if (c.local === 'r' || c.local === 'fld') {
      const t = child(c, 't');
      if (t) out += textContent(doc, t);
    } else if (c.local === 'br') out += '\n';
  }
  return out;
}

function bodyParagraphs(doc: XmlDocument, txBody: XmlElement | undefined): string[] {
  return txBody ? childrenNamed(txBody, 'p').map((p) => paragraphText(doc, p)) : [];
}

function firstFontSize(el: XmlElement): number | undefined {
  const stack: XmlElement[] = [el];
  while (stack.length) {
    const e = stack.shift()!;
    if (e.local === 'rPr' || e.local === 'defRPr' || e.local === 'endParaRPr') {
      const sz = getAttr(e, 'sz');
      if (sz && Number(sz) > 0) return Number(sz) / 100;
    }
    stack.unshift(...e.elements);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Placeholders (inherit geometry from layout, then master)
// ---------------------------------------------------------------------------------------------

interface Ph {
  type?: string;
  idx?: string;
}

const normType = (t: string | undefined): string =>
  t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || t === undefined ? 'body' : t;

function phOf(sp: XmlElement): Ph | undefined {
  const nv = child(sp, 'nvSpPr') ?? child(sp, 'nvPicPr') ?? child(sp, 'nvGraphicFramePr');
  const ph = nv && child(child(nv, 'nvPr') ?? nv, 'ph');
  return ph ? { type: getAttr(ph, 'type'), idx: getAttr(ph, 'idx') } : undefined;
}

function treeShapes(doc: XmlDocument | undefined): XmlElement[] {
  const tree = doc && child(child(doc.root, 'cSld') ?? doc.root, 'spTree');
  return tree
    ? tree.elements.filter(
        (e) => e.local === 'sp' || e.local === 'pic' || e.local === 'graphicFrame',
      )
    : [];
}

function xfrmOfShape(el: XmlElement): Xfrm | undefined {
  return readXfrm(
    el.local === 'graphicFrame' ? child(el, 'xfrm') : child(child(el, 'spPr') ?? el, 'xfrm'),
  );
}

function inheritedXfrm(ph: Ph, docs: Array<XmlDocument | undefined>): Xfrm | undefined {
  for (const doc of docs) {
    const candidates = treeShapes(doc).flatMap((sp) => {
      const p = phOf(sp);
      return p ? [{ sp, p }] : [];
    });
    const exact = candidates.find(
      (c) => c.p.type === ph.type && (c.p.idx ?? '') === (ph.idx ?? ''),
    );
    const byIdx = ph.idx !== undefined ? candidates.find((c) => c.p.idx === ph.idx) : undefined;
    const byType = candidates.find((c) => normType(c.p.type) === normType(ph.type));
    for (const hit of [exact, byIdx, byType]) {
      const x = hit && xfrmOfShape(hit.sp);
      if (x) return x;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------------------------

export function listSlides(src: PartSource): SlideRef[] {
  const analysis = analyzePackage(src);
  const main = presentationPart(analysis);
  const doc = parse(src, main);
  const list = doc && child(doc.root, 'sldIdLst');
  if (!main || !list) return [];
  const rels = analysis.relationships.get(main) ?? [];
  const out: SlideRef[] = [];
  for (const el of list.elements) {
    const target = rels.find((r) => r.id === relAttr(el, 'id'))?.resolved;
    if (!target || !src.has(target)) continue;
    const { shapes } = readSlide(src, target);
    const title =
      shapes.find((s) => s.placeholder === 'title' || s.placeholder === 'ctrTitle') ??
      shapes.find((s) => s.paragraphs.some(Boolean));
    out.push({
      part: target,
      index: out.length + 1,
      title: title?.paragraphs.join(' ').trim() ?? '',
    });
  }
  return out;
}

export function readSlide(src: PartSource, part: string): SlideData {
  const size = readSlideSize(src);
  const result: SlideData = { size, shapes: [] };
  const doc = parse(src, part);
  const tree = doc && child(child(doc.root, 'cSld') ?? doc.root, 'spTree');
  if (!doc || !tree) return result;

  const analysis = analyzePackage(src);
  const rels = analysis.relationships.get(part) ?? [];
  const layoutPart = rels.find((r) => r.type.endsWith('/slideLayout'))?.resolved;
  const masterPart = layoutPart
    ? analysis.relationships.get(layoutPart)?.find((r) => r.type.endsWith('/slideMaster'))?.resolved
    : undefined;
  const inheritDocs = [parse(src, layoutPart), parse(src, masterPart)];

  const walk = (container: XmlElement, tf: Transform): void => {
    for (const el of container.elements) {
      switch (el.local) {
        case 'grpSp': {
          const g = readXfrm(child(child(el, 'grpSpPr') ?? el, 'xfrm'));
          walk(el, g ? enterGroup(tf, g) : tf);
          break;
        }
        case 'sp':
        case 'pic':
        case 'graphicFrame':
        case 'cxnSp':
          result.shapes.push(shape(el, tf));
          break;
      }
    }
  };

  const shape = (el: XmlElement, tf: Transform): SlideShape => {
    const nv =
      child(el, 'nvSpPr') ??
      child(el, 'nvPicPr') ??
      child(el, 'nvGraphicFramePr') ??
      child(el, 'nvCxnSpPr');
    const name = (nv && getAttr(child(nv, 'cNvPr') ?? nv, 'name')) ?? '';
    const ph = el.local === 'sp' || el.local === 'pic' ? phOf(el) : undefined;
    const xf = xfrmOfShape(el) ?? (ph ? inheritedXfrm(ph, inheritDocs) : undefined);
    const base: SlideShape = {
      kind: 'other',
      name,
      x: xf ? tf.tx + tf.sx * xf.x : 0,
      y: xf ? tf.ty + tf.sy * xf.y : 0,
      cx: xf ? tf.sx * xf.cx : 0,
      cy: xf ? tf.sy * xf.cy : 0,
      paragraphs: [],
      placeholder: ph ? (ph.type ?? 'ph') : undefined,
      rotation: xf?.rot ? xf.rot / 60000 : undefined,
    };

    if (el.local === 'sp') {
      const txBody = child(el, 'txBody');
      return {
        ...base,
        kind: 'text',
        paragraphs: bodyParagraphs(doc, txBody),
        fontSizePt: txBody && firstFontSize(txBody),
      };
    }
    if (el.local === 'pic') {
      const blip = findDescendant(el, 'blip');
      const embed = blip && relAttr(blip, 'embed');
      return { ...base, kind: 'picture', imagePart: rels.find((r) => r.id === embed)?.resolved };
    }
    if (el.local === 'graphicFrame') {
      const data = findDescendant(el, 'graphicData');
      const tbl = data && child(data, 'tbl');
      if (tbl) {
        const rows = childrenNamed(tbl, 'tr').map((tr) =>
          childrenNamed(tr, 'tc')
            .map((tc) => bodyParagraphs(doc, child(tc, 'txBody')).join(' '))
            .join(' | '),
        );
        return { ...base, kind: 'table', paragraphs: rows, fontSizePt: firstFontSize(tbl) };
      }
      return {
        ...base,
        kind:
          /chart/i.test(getAttr(data ?? el, 'uri') ?? '') || findDescendant(el, 'chart')
            ? 'chart'
            : 'other',
      };
    }
    return base;
  };

  walk(tree, IDENTITY);

  const notesPart = rels.find((r) => r.type.endsWith('/notesSlide'))?.resolved;
  const notesDoc = parse(src, notesPart);
  if (notesDoc) {
    const body = treeShapes(notesDoc).find((sp) => phOf(sp)?.type === 'body');
    const text = body && bodyParagraphs(notesDoc, child(body, 'txBody')).join('\n').trim();
    if (text) result.notes = text;
  }
  return result;
}

function findDescendant(el: XmlElement, local: string): XmlElement | undefined {
  for (const c of el.elements) {
    if (c.local === local) return c;
    const deep = findDescendant(c, local);
    if (deep) return deep;
  }
  return undefined;
}
