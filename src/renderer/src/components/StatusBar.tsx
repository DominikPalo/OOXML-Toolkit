import { CircleDot } from 'lucide-react';
import { partKind } from '@core/package/kinds';
import { contentTypeOf } from '@core/package/opc';
import { formatBytes } from '@core/text';
import { host } from '../host';
import { getAnalysis, useApp, useModelVersion } from '../store/app';
import { useEditorStatus } from '../store/editorStatus';
import type { DocTab } from '../store/types';

function DocStatus({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const editor = useEditorStatus();
  const { model, selection } = tab;
  const part = selection.part;
  const exists = !!part && model.has(part);
  const analysis = getAnalysis(model);
  const ct = exists ? contentTypeOf(analysis.contentTypes, part) : undefined;
  const kind = exists ? partKind(part, ct) : undefined;
  const changed = model.changedParts().length;
  const decoded =
    exists && (kind === 'xml' || kind === 'rels' || kind === 'text')
      ? model.getText(part)
      : undefined;

  return (
    <>
      <div className="status-left">
        <span>{analysis.type.label}</span>
        {exists && (
          <>
            <span className="sep">·</span>
            <span className="mono">{part}</span>
            <span className="sep">·</span>
            <span>{formatBytes(model.size(part))}</span>
          </>
        )}
        {selection.folder && <span className="mono">{selection.folder}</span>}
      </div>
      <div className="status-right">
        {decoded && tab.detailTab === 'source' && (
          <span>
            Ln {editor.line}, Col {editor.column}
          </span>
        )}
        {decoded && (
          <span>
            {decoded.encoding.toUpperCase()}
            {decoded.bom ? ' BOM' : ''}
          </span>
        )}
        {tab.readOnly && <span>Read-only</span>}
        {changed > 0 ? (
          <span
            className="status-dirty"
            title={model
              .changedParts()
              .map((c) => `${c.status}: ${c.name}`)
              .join('\n')}
          >
            <CircleDot size={12} /> {changed} unsaved part{changed === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="muted">No unsaved changes</span>
        )}
        {host.kind === 'web' && <span className="chip">browser mode</span>}
      </div>
    </>
  );
}

export function StatusBar() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeId));
  return (
    <footer className="statusbar">
      {tab?.kind === 'doc' ? (
        <DocStatus tab={tab} />
      ) : tab?.kind === 'compare' ? (
        <div className="status-left">
          <span>Comparison</span>
          {tab.result && (
            <>
              <span className="sep">·</span>
              <span>
                {tab.result.counts.modified + tab.result.counts.added + tab.result.counts.removed}{' '}
                changed
              </span>
              <span className="sep">·</span>
              <span>{tab.result.counts.unchanged} unchanged</span>
            </>
          )}
        </div>
      ) : (
        <div className="status-left">
          <span>Ready</span>
        </div>
      )}
    </footer>
  );
}
