import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns2,
  Download,
  FileDiff,
  Rows2,
  RefreshCw,
} from 'lucide-react';
import {
  buildReport,
  diffLabel,
  normalizedText,
  type DiffStatus,
  type PartDiff,
} from '@core/compare/compare';
import { isPreviewableImage, partKind } from '@core/package/kinds';
import { buildFolderTree, folderLabel, type FolderNode } from '@core/package/tree';
import { formatBytes } from '@core/text';
import { host } from '../../host';
import { useApp, updateCompare } from '../../store/app';
import { runCompare, setCompareFilter, swapCompare, toggleCompareRow } from '../../store/actions';
import { toast, toastError } from '../../store/ui';
import { hex32 } from '../../lib/describe';
import { prettyText } from '../../lib/display';
import { useImageUrl } from '../../lib/imageUrl';
import type { CompareTab } from '../../store/types';
import { FolderIcon, PartIcon } from '../common/Icons';
import { VirtualList } from '../common/VirtualList';
import { CodeEditor } from '../detail/CodeEditor';
import { DiffView, type DiffViewHandle } from './DiffView';

const STATUS_ORDER: DiffStatus[] = ['modified', 'added', 'removed', 'formatting', 'unchanged'];
const STATUS_LETTER: Record<DiffStatus, string> = {
  added: 'A',
  removed: 'R',
  modified: 'M',
  formatting: 'F',
  unchanged: '=',
};

// ---------------------------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------------------------

interface CmpRow {
  id: string;
  depth: number;
  kind: 'root' | 'folder' | 'part';
  label: string;
  part?: string;
  status?: DiffStatus;
  counts?: Partial<Record<DiffStatus, number>>;
  expandable: boolean;
  expanded: boolean;
  partKind?: ReturnType<typeof partKind>;
}

function buildCompareRows(tab: CompareTab): CmpRow[] {
  const result = tab.result;
  if (!result) return [];
  const parts = result.parts.filter((p) => tab.filter[p.status]);
  const byName = new Map(parts.map((p) => [p.name, p]));
  const counts = new Map<string, Partial<Record<DiffStatus, number>>>();
  for (const p of parts) {
    const segs = p.name.split('/');
    segs.pop();
    let acc = '';
    for (const s of ['', ...segs]) {
      acc = s ? acc + s + '/' : '';
      const c = counts.get(acc) ?? {};
      c[p.status] = (c[p.status] ?? 0) + 1;
      counts.set(acc, c);
    }
  }
  const rows: CmpRow[] = [
    {
      id: 'root',
      depth: 0,
      kind: 'root',
      label: 'Package',
      counts: counts.get(''),
      expandable: true,
      expanded: !!tab.expanded.root,
    },
  ];
  if (!tab.expanded.root) return rows;

  const walk = (f: FolderNode, depth: number): void => {
    for (const sub of f.folders) {
      const { label, node } = folderLabel(sub);
      const id = `f:${node.path}`;
      const open = !!tab.expanded[id];
      rows.push({
        id,
        depth,
        kind: 'folder',
        label,
        counts: counts.get(node.path),
        expandable: true,
        expanded: open,
      });
      if (open) walk(node, depth + 1);
    }
    for (const name of f.parts) {
      const p = byName.get(name)!;
      rows.push({
        id: `p:${name}`,
        depth,
        kind: 'part',
        label: name.slice(name.lastIndexOf('/') + 1),
        part: name,
        status: p.status,
        partKind: p.kind,
        expandable: false,
        expanded: false,
      });
    }
  };
  walk(buildFolderTree(parts.map((p) => p.name)), 1);
  return rows;
}

export function CompareTree({ tab }: { tab: CompareTab }) {
  const rows = useMemo(() => buildCompareRows(tab), [tab.result, tab.filter, tab.expanded]);
  const counts = tab.result?.counts;

  return (
    <div className="explorer">
      <div className="filter-bar">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            className={`filter-chip ${s} ${tab.filter[s] ? 'on' : ''}`}
            onClick={() => setCompareFilter(tab.id, s, !tab.filter[s])}
            title={`${tab.filter[s] ? 'Hide' : 'Show'} ${diffLabel(s).toLowerCase()} parts`}
          >
            <span className={`status-letter ${s}`}>{STATUS_LETTER[s]}</span> {counts?.[s] ?? 0}
          </button>
        ))}
      </div>
      {tab.status === 'running' && (
        <div className="progress">
          <span style={{ width: `${Math.round(tab.progress * 100)}%` }} />
        </div>
      )}
      <VirtualList
        items={rows}
        rowHeight={24}
        itemKey={(r) => r.id}
        className="tree"
        role="tree"
        ariaLabel="Compared parts"
        renderRow={(row) => {
          const selected = row.kind === 'part' && row.part === tab.selected;
          return (
            <div
              className={`tree-row ${selected ? 'selected' : ''}`}
              style={{ paddingLeft: 6 + row.depth * 14 }}
              onClick={() => {
                if (row.kind === 'part') updateCompare(tab.id, { selected: row.part });
                else if (row.kind === 'root') updateCompare(tab.id, { selected: undefined });
                else toggleCompareRow(tab.id, row.id);
              }}
              role="treeitem"
              aria-selected={selected}
            >
              <span
                className="tree-chevron"
                onClick={(e) => {
                  if (row.expandable) {
                    e.stopPropagation();
                    toggleCompareRow(tab.id, row.id);
                  }
                }}
              >
                {row.expandable ? (
                  row.expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )
                ) : null}
              </span>
              <span className="tree-icon">
                {row.kind === 'part' ? (
                  <PartIcon kind={row.partKind} />
                ) : (
                  <FolderIcon open={row.expanded} />
                )}
              </span>
              <span className={`tree-label ${row.status ? `cmp-${row.status}` : ''}`}>
                {row.label}
              </span>
              {row.kind === 'part' && row.status && (
                <span className={`status-letter ${row.status}`}>{STATUS_LETTER[row.status]}</span>
              )}
              {row.kind !== 'part' && row.counts && (
                <span className="folder-counts">
                  {STATUS_ORDER.filter((s) => s !== 'unchanged' && row.counts![s]).map((s) => (
                    <span
                      key={s}
                      className={`status-letter ${s}`}
                      title={`${row.counts![s]} ${diffLabel(s).toLowerCase()}`}
                    >
                      {row.counts![s]}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------------------------

export function CompareView({ tab }: { tab: CompareTab }) {
  const settings = useApp((s) => s.settings);
  const diffRef = useRef<DiffViewHandle>(null);
  const [chunks, setChunks] = useState(0);
  const result = tab.result;
  const diff = result?.parts.find((p) => p.name === tab.selected);

  const exportReport = async (): Promise<void> => {
    if (!result) return;
    try {
      const md = buildReport(tab.a.label, tab.b.label, result);
      const r = await host.saveAs('ooxml-comparison.md', new TextEncoder().encode(md), [
        { name: 'Markdown', extensions: ['md'] },
      ]);
      if (r) toast('success', 'Report saved');
    } catch (e) {
      toastError('Could not save the report: ', e);
    }
  };

  return (
    <div className="compare">
      <header className="compare-head">
        <div className="compare-title">
          <FileDiff size={18} className="ic" />
          <span className="side a">{tab.a.label}</span>
          <button
            className="icon-btn"
            onClick={() => swapCompare(tab.id)}
            title="Swap sides"
            aria-label="Swap sides"
          >
            <ArrowLeftRight size={15} />
          </button>
          <span className="side b">{tab.b.label}</span>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => void runCompare(tab.id)}
            disabled={tab.status === 'running'}
            title="Compare again (picks up edits to live documents)"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn" onClick={() => void exportReport()} disabled={!result}>
            <Download size={14} /> Export report
          </button>
        </div>
        <div className="compare-options">
          <label className="check">
            <input
              type="checkbox"
              checked={!!tab.options.detectFormatting}
              onChange={(e) => {
                updateCompare(tab.id, {
                  options: { ...tab.options, detectFormatting: e.target.checked },
                });
                void runCompare(tab.id);
              }}
            />
            Ignore formatting-only differences
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!tab.options.sortAttributes}
              onChange={(e) => {
                updateCompare(tab.id, {
                  options: { ...tab.options, sortAttributes: e.target.checked },
                });
                void runCompare(tab.id);
              }}
            />
            Ignore attribute order
          </label>
        </div>
      </header>

      <div className="compare-body">
        {tab.status === 'error' && <div className="empty error">{tab.error}</div>}
        {tab.status === 'running' && !result && <div className="empty">Comparing…</div>}
        {result && !diff && <Summary tab={tab} />}
        {result && diff && (
          <div className="diff-pane">
            <div className="diff-toolbar">
              <PartIcon kind={diff.kind} />
              <b className="mono">{diff.name}</b>
              <span className={`chip cmp-${diff.status}`}>{diffLabel(diff.status)}</span>
              <span className="muted">
                {diff.sizeA !== undefined && `A ${formatBytes(diff.sizeA)}`}
                {diff.sizeA !== undefined && diff.sizeB !== undefined && ' → '}
                {diff.sizeB !== undefined && `B ${formatBytes(diff.sizeB)}`}
              </span>
              <span className="spacer" />
              {(diff.status === 'modified' || diff.status === 'formatting') &&
                (diff.kind === 'xml' || diff.kind === 'rels' || diff.kind === 'text') && (
                  <>
                    <span className="muted small">
                      {chunks} change{chunks === 1 ? '' : 's'}
                    </span>
                    <button
                      className="icon-btn"
                      onClick={() => diffRef.current?.prev()}
                      title="Previous change"
                      aria-label="Previous change"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => diffRef.current?.next()}
                      title="Next change"
                      aria-label="Next change"
                    >
                      <ArrowDown size={15} />
                    </button>
                    <div className="segmented">
                      <button
                        className={tab.view === 'split' ? 'active' : ''}
                        onClick={() => updateCompare(tab.id, { view: 'split' })}
                      >
                        <Columns2 size={13} /> Split
                      </button>
                      <button
                        className={tab.view === 'unified' ? 'active' : ''}
                        onClick={() => updateCompare(tab.id, { view: 'unified' })}
                      >
                        <Rows2 size={13} /> Unified
                      </button>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={tab.collapseUnchanged}
                        onChange={(e) =>
                          updateCompare(tab.id, { collapseUnchanged: e.target.checked })
                        }
                      />
                      Collapse unchanged
                    </label>
                  </>
                )}
            </div>
            <div className="diff-body">
              <PartDiffContent
                key={`${tab.id}|${diff.name}`}
                tab={tab}
                diff={diff}
                diffRef={diffRef}
                onChunks={setChunks}
                fontSize={settings.editorFontSize}
                wrap={settings.wrapLines}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ tab }: { tab: CompareTab }) {
  const result = tab.result!;
  const changed = result.parts.filter((p) => p.status !== 'unchanged');
  return (
    <div className="pad">
      <h2 className="view-title">Comparison summary</h2>
      <div className="stat-row">
        {STATUS_ORDER.map((s) => (
          <div key={s} className={`stat st-${s}`}>
            <b>{result.counts[s]}</b>
            <span>{diffLabel(s).toLowerCase()}</span>
          </div>
        ))}
      </div>
      {changed.length === 0 ? (
        <p className="muted">The two packages are identical.</p>
      ) : (
        <>
          <p className="muted">Select a part in the tree, or pick one below.</p>
          <table className="grid">
            <thead>
              <tr>
                <th>Part</th>
                <th>Status</th>
                <th className="num">A</th>
                <th className="num">B</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((p) => (
                <tr
                  key={p.name}
                  className="clickable"
                  onClick={() => updateCompare(tab.id, { selected: p.name })}
                >
                  <td className="mono wrap-any">{p.name}</td>
                  <td>
                    <span className={`chip cmp-${p.status}`}>{diffLabel(p.status)}</span>
                  </td>
                  <td className="num">{p.sizeA !== undefined ? formatBytes(p.sizeA) : '—'}</td>
                  <td className="num">{p.sizeB !== undefined ? formatBytes(p.sizeB) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ImageBox({
  bytes,
  name,
  label,
}: {
  bytes: Uint8Array | undefined;
  name: string;
  label: string;
}) {
  const { url, state } = useImageUrl(name, bytes);
  return (
    <div className="image-box">
      <div className="image-box-label">{label}</div>
      <div className="image-stage">
        {url ? (
          <img src={url} className="fit" alt={label} />
        ) : (
          <span className="muted">
            {!bytes ? 'not present' : state === 'loading' ? 'Rendering…' : 'cannot be previewed'}
          </span>
        )}
      </div>
    </div>
  );
}

function PartDiffContent({
  tab,
  diff,
  diffRef,
  onChunks,
  fontSize,
  wrap,
}: {
  tab: CompareTab;
  diff: PartDiff;
  diffRef: React.Ref<DiffViewHandle>;
  onChunks: (n: number) => void;
  fontSize: number;
  wrap: boolean;
}) {
  const { a, b } = tab;
  const textual = diff.kind === 'xml' || diff.kind === 'rels' || diff.kind === 'text';
  const texts = useMemo(() => {
    if (!textual) return undefined;
    try {
      const read = (side: typeof a, present: boolean): string => {
        if (!present) return '';
        if (diff.status === 'formatting' || diff.kind === 'text')
          return side.source.getText(diff.name).text;
        return normalizedText(side.source, diff.name, tab.options);
      };
      return { left: read(a, diff.status !== 'added'), right: read(b, diff.status !== 'removed') };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [a, b, diff, textual, tab.options]);

  if (diff.status === 'unchanged' && !textual)
    return (
      <div className="empty">Identical in both packages ({formatBytes(diff.sizeA ?? 0)}).</div>
    );

  if (textual && texts) {
    if ('error' in texts) return <div className="empty error">{texts.error}</div>;
    if (diff.status === 'added' || diff.status === 'removed' || diff.status === 'unchanged') {
      const value = diff.status === 'added' ? texts.right : texts.left;
      return (
        <div className="single-view">
          <div className="banner">
            {diff.status === 'unchanged'
              ? 'Identical in both packages.'
              : `This part exists only in ${diff.status === 'added' ? 'B' : 'A'}.`}
          </div>
          <CodeEditor
            value={diff.kind === 'text' ? value : prettyText(`${tab.id}:${diff.name}`, value)}
            readOnly
            language={diff.kind === 'text' ? 'plain' : 'xml'}
            wrap={wrap}
            fontSize={fontSize}
          />
        </div>
      );
    }
    return (
      <div className="single-view">
        {diff.status === 'formatting' && (
          <div className="banner">
            Only formatting or insignificant whitespace differs — the XML content is equivalent.
          </div>
        )}
        <div className="diff-labels">
          <span className="side a">A · {a.label}</span>
          <span className="side b">B · {b.label}</span>
        </div>
        <DiffView
          ref={diffRef}
          left={texts.left}
          right={texts.right}
          mode={tab.view}
          language={diff.kind === 'text' ? 'plain' : 'xml'}
          collapseUnchanged={tab.collapseUnchanged}
          fontSize={fontSize}
          wrap={wrap}
          onChunks={onChunks}
        />
      </div>
    );
  }

  // Binary / image parts
  const bytesA = diff.status === 'added' ? undefined : a.source.getBytes(diff.name);
  const bytesB = diff.status === 'removed' ? undefined : b.source.getBytes(diff.name);
  return (
    <div className="pad">
      <dl className="kv wide">
        <div className="kv-row">
          <dt>A</dt>
          <dd>
            {bytesA
              ? `${formatBytes(bytesA.length)} · CRC-32 ${hex32(a.source.knownCrc(diff.name) ?? 0)}`
              : 'not present'}
          </dd>
        </div>
        <div className="kv-row">
          <dt>B</dt>
          <dd>
            {bytesB
              ? `${formatBytes(bytesB.length)} · CRC-32 ${hex32(b.source.knownCrc(diff.name) ?? 0)}`
              : 'not present'}
          </dd>
        </div>
      </dl>
      {isPreviewableImage(diff.name) && (
        <div className="image-pair">
          <ImageBox bytes={bytesA} name={diff.name} label={`A · ${a.label}`} />
          <ImageBox bytes={bytesB} name={diff.name} label={`B · ${b.label}`} />
        </div>
      )}
      {!isPreviewableImage(diff.name) && (
        <p className="muted">
          Binary content differs. Open the part in each document to inspect it in the hex view.
        </p>
      )}
    </div>
  );
}
