import { useDeferredValue, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  AlertTriangle,
  ExternalLink,
  ListTree,
  Network,
  Circle,
  Bookmark,
  Repeat2,
} from 'lucide-react';
import { deleteElement, duplicateElement, insertFragment, moveElement } from '@core/xml/edit';
import { elementAtPath } from '@core/xml/parser';
import { getAnalysis, useApp, useModelVersion } from '../../store/app';
import {
  addPartFromFile,
  collapseAll,
  deletePart,
  exportPart,
  growChildLimit,
  navBack,
  navForward,
  navigate,
  openEmbedded,
  renamePart,
  replacePart,
  selectRow,
  setTreeMode,
  toggleBookmark,
  toggleRow,
} from '../../store/actions';
import { insertXmlDialog } from '../../store/ui';
import { buildRows, type TreeRow } from '../../lib/treeModel';
import { mutateElement } from '../../lib/edits';
import type { DocTab } from '../../store/types';
import { ElementIcon, FolderIcon, PartIcon } from '../common/Icons';
import { useContextMenu, type MenuItem } from '../common/ContextMenu';
import { VirtualList, type VirtualListHandle } from '../common/VirtualList';
import { copyText } from '../../lib/clipboard';

const ROW_HEIGHT = 24;

export function Explorer({ tab }: { tab: DocTab }) {
  const version = useModelVersion(tab.model);
  const deferredVersion = useDeferredValue(version);
  const list = useRef<VirtualListHandle>(null);
  const [openMenu, menu] = useContextMenu();
  const bookmarks = useApp((s) => s.bookmarks);

  const rows = useMemo(
    () => buildRows(tab, getAnalysis(tab.model)),
    // `tab` identity changes on every selection change; only these fields affect the rows.
    [tab.model, tab.expanded, tab.childLimits, tab.treeMode, tab.name, deferredVersion],
  );

  const selectedIndex = rows.findIndex((r) => r.id === tab.selectedRowId);

  // Scroll the selection into view when it changes from elsewhere (search, back/forward, bookmarks…).
  const lastScrolled = useRef('');
  useEffect(() => {
    if (selectedIndex >= 0 && lastScrolled.current !== tab.selectedRowId) {
      list.current?.scrollToIndex(selectedIndex);
    }
    lastScrolled.current = tab.selectedRowId;
  }, [selectedIndex, tab.selectedRowId]);

  // Parts bookmarked as a whole get a marker in the tree (element bookmarks are listed in the Bookmarks panel).
  const bookmarkedParts = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookmarks)
      if (b.fileKey === (tab.path ?? tab.name) && !b.xpath) set.add(b.part);
    return set;
  }, [bookmarks, tab.path, tab.name]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!rows.length) return;
    const idx = Math.max(0, selectedIndex);
    const row = rows[idx];
    const select = (i: number): void => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r.kind !== 'more') selectRow(tab.id, r);
      list.current?.scrollToIndex(Math.max(0, Math.min(rows.length - 1, i)));
    };
    switch (e.key) {
      case 'ArrowDown':
        select(idx + 1);
        break;
      case 'ArrowUp':
        select(idx - 1);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(rows.length - 1);
        break;
      case 'PageDown':
        select(idx + 12);
        break;
      case 'PageUp':
        select(idx - 12);
        break;
      case 'ArrowRight':
        if (row.expandable && !row.expanded) toggleRow(tab.id, row.id, true);
        else if (row.expandable) select(idx + 1);
        break;
      case 'ArrowLeft':
        if (row.expandable && row.expanded) toggleRow(tab.id, row.id, false);
        else {
          for (let i = idx - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) {
              select(i);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (row.kind === 'more') growChildLimit(tab.id, row.moreFor!, 500);
        else if (row.expandable) toggleRow(tab.id, row.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const rowMenu = (row: TreeRow): MenuItem[] => {
    const items: MenuItem[] = [];
    const { model } = tab;
    const editable = !tab.readOnly;
    if (row.kind === 'root' || row.kind === 'group') {
      items.push({ label: 'Collapse All', onClick: () => collapseAll(tab.id) });
    }
    if (row.kind === 'folder') {
      items.push({
        label: 'Add File Here…',
        onClick: () => void addPartFromFile(tab.id, row.folder),
        disabled: !editable,
      });
      items.push({ label: 'Copy Path', onClick: () => void copyText(row.folder!) });
    }
    if (row.part && (row.kind === 'part' || row.kind === 'rel')) {
      const part = row.part;
      const sel = { part };
      items.push({
        label: 'Bookmark',
        onClick: () => toggleBookmark(tab.id, sel),
        shortcut: undefined,
      });
      items.push({ label: 'Copy Part Name', onClick: () => void copyText(part) });
      items.push({ separator: true });
      items.push({ label: 'Export…', onClick: () => void exportPart(tab.id, part) });
      if (row.partKind === 'package')
        items.push({ label: 'Open as Package', onClick: () => openEmbedded(tab.id, part) });
      items.push({
        label: 'Replace Content…',
        onClick: () => void replacePart(tab.id, part),
        disabled: !editable,
      });
      items.push({
        label: 'Rename…',
        onClick: () => void renamePart(tab.id, part),
        disabled: !editable,
      });
      items.push({
        label: 'Delete…',
        onClick: () => void deletePart(tab.id, part),
        danger: true,
        disabled: !editable,
      });
    }
    if (row.kind === 'element' && row.part && row.path) {
      const part = row.part;
      const path = row.path;
      const { doc } = model.getXml(part);
      const el = doc && elementAtPath(doc, path);
      items.push({ label: 'Bookmark', onClick: () => toggleBookmark(tab.id, { part, path }) });
      if (el && doc) {
        items.push({
          label: 'Copy XML',
          onClick: () => void copyText(doc.source.slice(el.start, el.end)),
        });
        items.push({ separator: true });
        items.push({
          label: 'Insert XML…',
          disabled: !editable,
          onClick: async () => {
            const r = await insertXmlDialog(el.name);
            if (!r) return;
            mutateElement(model, part, path, `Insert into ${el.name}`, (d, target) =>
              insertFragment(d, target, r.position, r.xml),
            );
          },
        });
        items.push({
          label: 'Duplicate',
          disabled: !editable || !el.parent,
          onClick: () =>
            mutateElement(model, part, path, `Duplicate ${el.name}`, (d, t) =>
              duplicateElement(d, t),
            ),
        });
        items.push({
          label: 'Move Up',
          disabled: !editable || !el.parent || el.index === 0,
          onClick: () => {
            mutateElement(model, part, path, `Move ${el.name} up`, (d, t) => moveElement(d, t, -1));
            navigate(
              tab.id,
              { part, path: [...path.slice(0, -1), path[path.length - 1] - 1] },
              { record: false },
            );
          },
        });
        items.push({
          label: 'Move Down',
          disabled: !editable || !el.parent || el.index >= el.parent.elements.length - 1,
          onClick: () => {
            mutateElement(model, part, path, `Move ${el.name} down`, (d, t) =>
              moveElement(d, t, 1),
            );
            navigate(
              tab.id,
              { part, path: [...path.slice(0, -1), path[path.length - 1] + 1] },
              { record: false },
            );
          },
        });
        items.push({
          label: 'Delete',
          danger: true,
          disabled: !editable || !el.parent,
          onClick: () => {
            const ok = mutateElement(model, part, path, `Delete ${el.name}`, (d, t) =>
              deleteElement(d, t),
            );
            if (ok) navigate(tab.id, { part, path: path.slice(0, -1) }, { record: false });
          },
        });
      }
    }
    return items;
  };

  const renderRow = (row: TreeRow): React.ReactNode => {
    const selected = row.id === tab.selectedRowId;
    const bookmarked = row.kind === 'part' && !!row.part && bookmarkedParts.has(row.part);
    return (
      <div
        className={`tree-row ${selected ? 'selected' : ''} ${row.missing ? 'missing' : ''} ${row.status === 'deleted' ? 'deleted' : ''}`}
        style={{ paddingLeft: 6 + row.depth * 14 }}
        onClick={() => {
          if (row.kind === 'more') growChildLimit(tab.id, row.moreFor!, 500);
          else selectRow(tab.id, row);
        }}
        onDoubleClick={() => row.expandable && toggleRow(tab.id, row.id)}
        onContextMenu={(e) => {
          if (row.kind !== 'more') {
            selectRow(tab.id, row);
            openMenu(e, rowMenu(row));
          }
        }}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={row.expandable ? row.expanded : undefined}
        aria-level={row.depth + 1}
        title={row.rel ? `${row.rel.type}\n→ ${row.rel.target}` : (row.part ?? undefined)}
      >
        <span
          className="tree-chevron"
          onClick={(e) => {
            if (row.expandable) {
              e.stopPropagation();
              toggleRow(tab.id, row.id);
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
          {row.kind === 'folder' ? (
            <FolderIcon open={row.expanded} />
          ) : row.kind === 'element' ? (
            <ElementIcon />
          ) : row.kind === 'error' || row.missing ? (
            <AlertTriangle size={14} className="ic ic-error" />
          ) : row.external ? (
            <ExternalLink size={14} className="ic ic-rels" />
          ) : row.cycle ? (
            <Repeat2 size={14} className="ic" />
          ) : row.kind === 'root' ? (
            <ListTree size={15} className="ic ic-folder" />
          ) : row.kind === 'group' ? (
            <Circle size={12} className="ic" />
          ) : row.kind === 'more' ? null : (
            <PartIcon kind={row.partKind} />
          )}
        </span>
        <span
          className={`tree-label ${row.kind === 'element' ? 'mono' : ''} ${row.kind === 'more' ? 'link' : ''}`}
        >
          {row.label}
        </span>
        {row.hint && (
          <span className={`tree-hint ${row.hint.kind === 'text' ? 'text' : 'mono'}`}>
            {row.hint.text}
          </span>
        )}
        {bookmarked && <Bookmark size={12} className="tree-bookmark" />}
        {row.status === 'modified' && <span className="dot modified" title="Modified" />}
        {row.status === 'added' && <span className="dot added" title="Added" />}
      </div>
    );
  };

  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <div className="segmented" role="tablist" aria-label="Tree mode">
          <button
            className={tab.treeMode === 'parts' ? 'active' : ''}
            onClick={() => setTreeMode(tab.id, 'parts')}
            title="Package folder structure and XML elements"
          >
            <ListTree size={13} /> Parts
          </button>
          <button
            className={tab.treeMode === 'relationships' ? 'active' : ''}
            onClick={() => setTreeMode(tab.id, 'relationships')}
            title="Relationship graph starting at the package root"
          >
            <Network size={13} /> Relations
          </button>
        </div>
        <span className="spacer" />
        <button
          className="icon-btn"
          disabled={!tab.navBack.length}
          onClick={() => navBack(tab.id)}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          className="icon-btn"
          disabled={!tab.navForward.length}
          onClick={() => navForward(tab.id)}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => collapseAll(tab.id)}
          title="Collapse all"
          aria-label="Collapse all"
        >
          <ChevronsDownUp size={15} />
        </button>
      </div>
      <VirtualList
        ref={list}
        items={rows}
        rowHeight={ROW_HEIGHT}
        itemKey={(r) => r.id}
        renderRow={renderRow}
        className="tree"
        role="tree"
        ariaLabel="Package structure"
        onKeyDown={onKeyDown}
      />
      {menu}
    </div>
  );
}
