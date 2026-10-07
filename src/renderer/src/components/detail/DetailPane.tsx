import { useMemo } from 'react';
import { Bookmark, BookmarkCheck, ChevronRight, Copy, Download } from 'lucide-react';
import { baseName, partKind } from '@core/package/kinds';
import { contentTypeOf } from '@core/package/opc';
import { elementAtPath, xpathOf } from '@core/xml/parser';
import { formatBytes } from '@core/text';
import { getAnalysis, useApp, useModelVersion } from '../../store/app';
import {
  currentBookmark,
  exportPart,
  navigate,
  setDetailTab,
  toggleBookmark,
} from '../../store/actions';
import { copyText } from '../../lib/clipboard';
import { previewKindOf, tabsFor } from '../../lib/previewKind';
import type { DetailTab, DocTab } from '../../store/types';
import { PartIcon } from '../common/Icons';
import {
  FolderView,
  HexView,
  ImageView,
  InfoView,
  RelationshipsView,
  RelsTableView,
} from './PartViews';
import { InspectorView } from './InspectorView';
import { OverviewView } from './OverviewView';
import { PreviewView } from './PreviewView';
import { SourceEditor } from './SourceEditor';

const TAB_LABELS: Record<DetailTab, string> = {
  source: 'Source',
  preview: 'Preview',
  inspector: 'Inspector',
  relationships: 'Relationships',
  info: 'Info',
  hex: 'Hex',
  table: 'Table',
};

export function DetailPane({ tab }: { tab: DocTab }) {
  const sel = tab.selection;
  if (sel.part) return <PartView tab={tab} />;
  if (sel.folder) return <FolderView tab={tab} />;
  return <OverviewView tab={tab} />;
}

function Breadcrumb({ tab }: { tab: DocTab }) {
  const part = tab.selection.part!;
  const path = tab.selection.path;
  const { doc } = tab.model.getXml(part);
  const segments = part.split('/');
  const trail: Array<{ label: string; onClick: () => void; current?: boolean }> = segments
    .slice(0, -1)
    .map((seg, i) => ({
      label: seg,
      onClick: () => navigate(tab.id, { folder: segments.slice(0, i + 1).join('/') + '/' }),
    }));
  trail.push({ label: baseName(part), onClick: () => navigate(tab.id, { part }), current: !path });
  if (path && doc) {
    for (let i = 0; i <= path.length; i++) {
      const el = elementAtPath(doc, path.slice(0, i));
      if (!el) break;
      // Show position among same-named siblings only when it disambiguates.
      const same = el.parent ? el.parent.elements.filter((s) => s.name === el.name) : [];
      const label = same.length > 1 ? `${el.name}[${same.indexOf(el) + 1}]` : el.name;
      trail.push({
        label,
        onClick: () => navigate(tab.id, { part, path: path.slice(0, i) }),
        current: i === path.length,
      });
    }
  }
  return (
    <nav className="breadcrumb" aria-label="Location">
      {trail.map((t, i) => (
        <span key={i} className="crumb-wrap">
          {i > 0 && <ChevronRight size={12} className="crumb-sep" />}
          <button className={`crumb ${t.current ? 'current' : ''}`} onClick={t.onClick}>
            {t.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function PartView({ tab }: { tab: DocTab }) {
  const version = useModelVersion(tab.model);
  const part = tab.selection.part!;
  const { model } = tab;
  const exists = model.has(part);
  const analysis = getAnalysis(model);
  const contentType = exists ? contentTypeOf(analysis.contentTypes, part) : undefined;
  const head = useMemo(
    () => (exists ? model.getBytes(part).subarray(0, 4) : undefined),
    [exists, model, part, version],
  );
  const kind = exists ? partKind(part, contentType, head) : undefined;
  const hasElement = !!tab.selection.path;
  const tabs = tabsFor({
    kind,
    part,
    hasElement,
    preview: previewKindOf(contentType),
    odf: analysis.type.family === 'odf',
  });
  const active: DetailTab = tabs.includes(tab.detailTab) ? tab.detailTab : (tabs[0] ?? 'source');
  const bookmarks = useApp((s) => s.bookmarks);
  const bookmarked = !!currentBookmark(tab) && bookmarks.length > 0;
  const status = exists ? model.status(part) : 'deleted';
  const xpath =
    hasElement &&
    (() => {
      const { doc } = model.getXml(part);
      const el = doc && elementAtPath(doc, tab.selection.path!);
      return el ? xpathOf(el) : undefined;
    })();

  if (!exists) {
    return (
      <div className="empty">
        <p>
          <b className="mono">{part}</b> no longer exists in this package.
        </p>
      </div>
    );
  }

  return (
    <div className="part-view">
      <header className="part-head">
        <div className="part-head-top">
          <PartIcon kind={kind} size={18} />
          <Breadcrumb tab={tab} />
          <span className="spacer" />
          {status !== 'unchanged' && (
            <span className={`chip status-${status}`}>
              {status === 'added' ? 'Added' : 'Modified'}
            </span>
          )}
          <button
            className={`icon-btn ${bookmarked ? 'on' : ''}`}
            onClick={() => toggleBookmark(tab.id)}
            title="Bookmark (Ctrl/Cmd+D)"
            aria-label="Toggle bookmark"
          >
            {bookmarked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </button>
          <button
            className="icon-btn"
            onClick={() => void copyText(xpath ? `${part}#${xpath}` : part)}
            title={xpath ? 'Copy part name and XPath' : 'Copy part name'}
            aria-label="Copy location"
          >
            <Copy size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => void exportPart(tab.id, part)}
            title="Export this part to a file"
            aria-label="Export part"
          >
            <Download size={15} />
          </button>
        </div>
        <div className="part-meta">
          {contentType ? (
            <span className="mono">{contentType}</span>
          ) : (
            <span className="ic-error">
              {analysis.type.family === 'odf' ? 'not in the manifest' : 'no content type'}
            </span>
          )}
          <span>·</span>
          <span>{formatBytes(model.size(part))}</span>
        </div>
        <div className="tabstrip" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === active}
              className={t === active ? 'active' : ''}
              onClick={() => setDetailTab(tab.id, t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </header>
      <div className="part-body">
        {active === 'source' && <SourceEditor tab={tab} />}
        {active === 'inspector' && <InspectorView tab={tab} />}
        {active === 'preview' &&
          (kind === 'image' ? <ImageView tab={tab} /> : <PreviewView tab={tab} />)}
        {active === 'relationships' && <RelationshipsView tab={tab} />}
        {active === 'table' && <RelsTableView tab={tab} />}
        {active === 'info' && <InfoView tab={tab} />}
        {active === 'hex' && <HexView tab={tab} />}
      </div>
    </div>
  );
}
