import {
  Binary,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Code2,
} from 'lucide-react';
import type { PartKind } from '@core/package/kinds';
import type { PackageFamily } from '@core/package/opc';

export function PartIcon({ kind, size = 15 }: { kind: PartKind | undefined; size?: number }) {
  switch (kind) {
    case 'xml':
      return <FileCode size={size} className="ic ic-xml" />;
    case 'rels':
      return <Link2 size={size} className="ic ic-rels" />;
    case 'image':
      return <FileImage size={size} className="ic ic-image" />;
    case 'text':
      return <FileText size={size} className="ic ic-text" />;
    case 'package':
      return <FileArchive size={size} className="ic ic-package" />;
    case 'binary':
      return <Binary size={size} className="ic ic-binary" />;
    default:
      return <File size={size} className="ic" />;
  }
}

export function FolderIcon({ open, size = 15 }: { open: boolean; size?: number }) {
  return open ? (
    <FolderOpen size={size} className="ic ic-folder" />
  ) : (
    <Folder size={size} className="ic ic-folder" />
  );
}

export function ElementIcon({ size = 14 }: { size?: number }) {
  return <Code2 size={size} className="ic ic-element" />;
}

const FAMILY: Record<PackageFamily, { letter: string; cls: string; title: string }> = {
  word: { letter: 'W', cls: 'word', title: 'Word' },
  excel: { letter: 'X', cls: 'excel', title: 'Excel' },
  powerpoint: { letter: 'P', cls: 'ppt', title: 'PowerPoint' },
  visio: { letter: 'V', cls: 'visio', title: 'Visio' },
  odf: { letter: 'O', cls: 'odf', title: 'OpenDocument' },
  unknown: { letter: 'Z', cls: 'zip', title: 'Package' },
};

/** Small coloured badge identifying the kind of document. */
export function DocBadge({
  family,
  size = 18,
}: {
  family: PackageFamily | undefined;
  size?: number;
}) {
  const f = FAMILY[family ?? 'unknown'];
  return (
    <span
      className={`doc-badge ${f.cls}`}
      style={{ width: size, height: size, fontSize: size * 0.6 }}
      title={f.title}
    >
      {f.letter}
    </span>
  );
}
