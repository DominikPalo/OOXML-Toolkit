import { textContent, type XmlDocument, type XmlElement } from '@core/xml/parser';

const KEY_ATTRS = [
  'name',
  'Name',
  'id',
  'Id',
  'r:id',
  'r',
  'ref',
  'w:val',
  'val',
  'type',
  'Target',
  'PartName',
  'Extension',
  'w:styleId',
  'w:id',
  'sheetId',
  'idx',
  'uri',
  't',
  's',
];

export const truncate = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n - 1) + '…' : s;

export interface Hint {
  kind: 'text' | 'attrs';
  text: string;
}

/** A short, informative summary shown next to an element in the tree. */
export function elementHint(doc: XmlDocument, el: XmlElement): Hint | undefined {
  if (el.elements.length === 0) {
    const t = textContent(doc, el).trim().replace(/\s+/g, ' ');
    if (t) return { kind: 'text', text: truncate(t, 70) };
  }
  const attrs = el.attrs.filter((a) => !a.name.startsWith('xmlns'));
  if (!attrs.length) return undefined;
  const preferred = KEY_ATTRS.map((k) => attrs.find((a) => a.name === k)).filter(
    (a): a is NonNullable<typeof a> => !!a,
  );
  const chosen = (preferred.length ? preferred : attrs).slice(0, 2);
  return {
    kind: 'attrs',
    text: chosen.map((a) => `${a.name}="${truncate(a.value, 28)}"`).join(' '),
  };
}

export function formatDate(d: Date | number | undefined): string {
  if (d === undefined) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export const hex32 = (n: number): string => n.toString(16).toUpperCase().padStart(8, '0');

export function shortName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}
