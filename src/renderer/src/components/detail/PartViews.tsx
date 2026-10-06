import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, FolderOpen, Hash, PackageOpen } from 'lucide-react';
import { baseName, imageMime, partKind } from '@core/package/kinds';
import { contentTypeOf, shortRelType, sourceOfRels, type Relationship } from '@core/package/opc';
import { formatBytes } from '@core/text';
import { getAnalysis, useModelVersion } from '../../store/app';
import { navigate, openEmbedded } from '../../store/actions';
import { formatDate, hex32 } from '../../lib/describe';
import { copyText } from '../../lib/clipboard';
import type { DocTab } from '../../store/types';
import { PartIcon } from '../common/Icons';
import { VirtualList } from '../common/VirtualList';

// ---------------------------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------------------------

function RelRow({
  tab,
  rel,
  direction,
}: {
  tab: DocTab;
  rel: Relationship;
  direction: 'out' | 'in';
}) {
  const names = tab.model.names();
  const target = direction === 'out' ? rel.resolved : rel.source || undefined;
  const exists = target !== undefined && names.includes(target);
  const missing = direction === 'out' && rel.resolved !== undefined && !exists;
  const goto = exists ? target : direction === 'in' ? rel.relsPart : undefined;
  return (
    <tr
      className={goto ? 'clickable' : ''}
      onClick={() => goto && navigate(tab.id, { part: goto }, { sidebar: false })}
      title={rel.type}
    >
      <td className="mono">{rel.id}</td>
      <td>{shortRelType(rel.type)}</td>
      <td className="mono wrap-any">
        {direction === 'out' ? rel.target : rel.source || '(package)'}
        {rel.external && <ExternalLink size={12} className="inline-ic" />}
        {missing && <AlertTriangle size={12} className="inline-ic ic-error" />}
      </td>
      <td className="mono muted wrap-any">
        {direction === 'out' ? (rel.resolved ?? (rel.external ? 'external' : '—')) : rel.relsPart}
      </td>
    </tr>
  );
}

function RelTable({
  tab,
  rels,
  direction,
  empty,
}: {
  tab: DocTab;
  rels: Relationship[];
  direction: 'out' | 'in';
  empty: string;
}) {
  if (!rels.length) return <p className="muted">{empty}</p>;
  return (
    <table className="grid rel-table">
      <thead>
        <tr>
          <th>Id</th>
          <th>Type</th>
          <th>{direction === 'out' ? 'Target' : 'Source part'}</th>
          <th>{direction === 'out' ? 'Resolves to' : 'Declared in'}</th>
        </tr>
      </thead>
      <tbody>
        {rels.map((r) => (
          <RelRow key={`${r.relsPart}:${r.id}`} tab={tab} rel={r} direction={direction} />
        ))}
      </tbody>
    </table>
  );
}

/** Outgoing and incoming relationships of an XML part. */
export function RelationshipsView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const part = tab.selection.part!;
  const analysis = getAnalysis(tab.model);
  return (
    <div className="pad">
      <h3>
        Outgoing <span className="count">{analysis.relationships.get(part)?.length ?? 0}</span>
      </h3>
      <p className="muted small">
        Relationships declared by this part (in{' '}
        {`${part.slice(0, part.lastIndexOf('/') + 1)}_rels/${baseName(part)}.rels`}).
      </p>
      <RelTable
        tab={tab}
        rels={analysis.relationships.get(part) ?? []}
        direction="out"
        empty="This part declares no relationships."
      />
      <h3>
        Incoming <span className="count">{analysis.incoming.get(part)?.length ?? 0}</span>
      </h3>
      <p className="muted small">Parts whose relationships point at this part.</p>
      <RelTable
        tab={tab}
        rels={analysis.incoming.get(part) ?? []}
        direction="in"
        empty="No relationship refers to this part."
      />
    </div>
  );
}

/** The content of a `.rels` part as a table. */
export function RelsTableView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const part = tab.selection.part!;
  const source = sourceOfRels(part);
  const analysis = getAnalysis(tab.model);
  const rels = source === undefined ? [] : (analysis.relationships.get(source) ?? []);
  return (
    <div className="pad">
      <p className="muted">
        Relationships of <b className="mono">{source === '' ? 'the package' : source}</b>
        {source && !tab.model.has(source) && (
          <span className="ic-error"> (that part does not exist)</span>
        )}
      </p>
      <RelTable
        tab={tab}
        rels={rels}
        direction="out"
        empty="No relationships (or the file is not well-formed XML)."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------------------------

export function InfoView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const part = tab.selection.part!;
  const { model } = tab;
  const analysis = getAnalysis(model);
  const [sha, setSha] = useState<string>();
  useEffect(() => setSha(undefined), [part, model.version]);

  if (!model.has(part)) return <div className="empty">This part no longer exists.</div>;
  const contentType = contentTypeOf(analysis.contentTypes, part);
  const kind = partKind(part, contentType);
  const entry = model.entryInfo(part);
  const size = model.size(part);
  const decoded =
    kind === 'xml' || kind === 'rels' || kind === 'text' ? model.getText(part) : undefined;
  const incoming = analysis.incoming.get(part) ?? [];
  const status = model.status(part);

  const computeSha = async (): Promise<void> => {
    const digest = await crypto.subtle.digest('SHA-256', model.getBytes(part) as BufferSource);
    setSha([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''));
  };

  const rows: Array<[string, React.ReactNode]> = [
    ['Part name', <span className="mono">{part}</span>],
    [
      'Content type',
      contentType ? (
        <span className="mono">{contentType}</span>
      ) : (
        <span className="ic-error">none defined</span>
      ),
    ],
    ['Kind', kind],
    ['Size', `${formatBytes(size)} (${size.toLocaleString()} bytes)`],
    ...(entry
      ? ([
          [
            'Compressed',
            `${formatBytes(entry.compressedSize)} (${entry.size ? Math.round((1 - entry.compressedSize / entry.size) * 100) : 0}% saved, ${entry.method === 8 ? 'deflate' : 'stored'})`,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(entry
      ? ([
          ['CRC-32', <span className="mono">{hex32(entry.crc32)}</span>],
          ['Modified in ZIP', formatDate(entry.modified)],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(decoded
      ? ([
          ['Encoding', `${decoded.encoding.toUpperCase()}${decoded.bom ? ' with BOM' : ''}`],
          ['Lines', decoded.text.split('\n').length.toLocaleString()],
        ] as Array<[string, React.ReactNode]>)
      : []),
    [
      'Status',
      status === 'unchanged'
        ? 'Unchanged'
        : status === 'modified'
          ? 'Modified (unsaved)'
          : status === 'added'
            ? 'Added (unsaved)'
            : 'Deleted',
    ],
    [
      'Referenced by',
      incoming.length
        ? incoming.map((r) => `${r.source || '(package)'} (${r.id})`).join(', ')
        : 'nothing',
    ],
  ];

  return (
    <div className="pad">
      <dl className="kv wide">
        {rows.map(([k, v]) => (
          <div key={k} className="kv-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="kv-row">
          <dt>SHA-256</dt>
          <dd>
            {sha ? (
              <span className="mono wrap-any">
                {sha}{' '}
                <button className="icon-btn" onClick={() => void copyText(sha)} title="Copy">
                  <Hash size={13} />
                </button>
              </span>
            ) : (
              <button className="btn" onClick={() => void computeSha()}>
                <Hash size={14} /> Compute
              </button>
            )}
          </dd>
        </div>
      </dl>
      {kind === 'package' && (
        <div className="actions">
          <button className="btn primary" onClick={() => openEmbedded(tab.id, part)}>
            <PackageOpen size={14} /> Open as package
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------------------------

export function ImageView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const part = tab.selection.part!;
  const bytes = tab.model.has(part) ? tab.model.getBytes(part) : undefined;
  const [url, setUrl] = useState<string>();
  const [dims, setDims] = useState<string>();
  const [fit, setFit] = useState(true);

  useEffect(() => {
    if (!bytes) return;
    const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(part) }));
    setUrl(u);
    setDims(undefined);
    return () => URL.revokeObjectURL(u);
  }, [bytes, part]);

  if (!bytes) return <div className="empty">This part no longer exists.</div>;
  return (
    <div className="image-view">
      <div className="image-toolbar">
        <span className="muted">{dims ?? ''}</span>
        <span className="spacer" />
        <button className={`btn-ghost ${fit ? 'active' : ''}`} onClick={() => setFit(true)}>
          Fit
        </button>
        <button className={`btn-ghost ${!fit ? 'active' : ''}`} onClick={() => setFit(false)}>
          100%
        </button>
      </div>
      <div className="image-stage">
        {url && (
          <img
            src={url}
            alt={baseName(part)}
            className={fit ? 'fit' : ''}
            onLoad={(e) =>
              setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)
            }
            onError={() => setDims('This image format cannot be previewed.')}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Hex
// ---------------------------------------------------------------------------------------------

const BYTES_PER_ROW = 16;

export function HexView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const part = tab.selection.part!;
  const bytes = tab.model.has(part) ? tab.model.getBytes(part) : undefined;
  const rows = useMemo(
    () => Array.from({ length: Math.ceil((bytes?.length ?? 0) / BYTES_PER_ROW) }, (_, i) => i),
    [bytes],
  );
  if (!bytes) return <div className="empty">This part no longer exists.</div>;
  if (!bytes.length) return <div className="empty">This part is empty.</div>;

  return (
    <div className="hex">
      <div className="hex-head mono">
        <span className="hex-off">Offset</span>
        <span className="hex-bytes">
          {Array.from({ length: BYTES_PER_ROW }, (_, i) =>
            i.toString(16).toUpperCase().padStart(2, '0'),
          ).join(' ')}
        </span>
        <span className="hex-ascii">Text</span>
      </div>
      <VirtualList
        items={rows}
        rowHeight={19}
        itemKey={(r) => r}
        className="hex-list"
        renderRow={(r) => {
          const start = r * BYTES_PER_ROW;
          const chunk = bytes.subarray(start, start + BYTES_PER_ROW);
          let hex = '';
          let ascii = '';
          for (let i = 0; i < BYTES_PER_ROW; i++) {
            if (i < chunk.length) {
              hex += chunk[i].toString(16).padStart(2, '0') + ' ';
              ascii += chunk[i] >= 32 && chunk[i] < 127 ? String.fromCharCode(chunk[i]) : '·';
            } else hex += '   ';
          }
          return (
            <div className="hex-row mono">
              <span className="hex-off">{start.toString(16).padStart(8, '0')}</span>
              <span className="hex-bytes">{hex}</span>
              <span className="hex-ascii">{ascii}</span>
            </div>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------------------------

export function FolderView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const folder = tab.selection.folder!;
  const analysis = getAnalysis(tab.model);
  const parts = tab.model.names().filter((n) => n.startsWith(folder));
  const direct = new Map<
    string,
    { name: string; isFolder: boolean; size: number; count: number }
  >();
  for (const n of parts) {
    const rest = n.slice(folder.length);
    const slash = rest.indexOf('/');
    const key = slash === -1 ? rest : rest.slice(0, slash + 1);
    const entry = direct.get(key) ?? { name: key, isFolder: slash !== -1, size: 0, count: 0 };
    entry.size += tab.model.size(n);
    entry.count++;
    direct.set(key, entry);
  }
  const entries = [...direct.values()].sort(
    (a, b) =>
      Number(b.isFolder) - Number(a.isFolder) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const total = entries.reduce((n, e) => n + e.size, 0);

  return (
    <div className="pad">
      <h2 className="view-title">
        <FolderOpen size={18} className="ic ic-folder" /> <span className="mono">{folder}</span>
      </h2>
      <p className="muted">
        {parts.length.toLocaleString()} part{parts.length === 1 ? '' : 's'} · {formatBytes(total)}
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Content type</th>
            <th className="num">Size</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const full = folder + e.name;
            const ct = e.isFolder ? undefined : contentTypeOf(analysis.contentTypes, full);
            return (
              <tr
                key={e.name}
                className="clickable"
                onClick={() =>
                  navigate(tab.id, e.isFolder ? { folder: full } : { part: full }, {
                    sidebar: false,
                  })
                }
              >
                <td>
                  <span className="cell-icon">
                    {e.isFolder ? (
                      <FolderOpen size={14} className="ic ic-folder" />
                    ) : (
                      <PartIcon kind={partKind(full, ct)} />
                    )}
                  </span>
                  {e.name}
                  {e.isFolder && <span className="muted"> · {e.count} parts</span>}
                </td>
                <td className="mono muted wrap-any">{ct ?? ''}</td>
                <td className="num">{formatBytes(e.size)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
