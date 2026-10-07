import type { ReactNode } from 'react';
import { ChevronDown, FileDiff, GitCompare, Plus, Save, X } from 'lucide-react';
import { getAnalysis, useApp, useModelVersion } from '../store/app';
import {
  closeTab,
  compareWithFile,
  dispatchCommand,
  isDirty,
  openFilesFromDialog,
  selectTab,
} from '../store/actions';
import { COMMANDS } from '@shared/commands';
import { host, isMac } from '../host';
import { useInspectorDraft } from '../store/inspectorDraft';
import type { CompareTab, DocTab } from '../store/types';
import { useContextMenu } from './common/ContextMenu';
import { DocBadge } from './common/Icons';

interface ShellProps {
  id: string;
  name: string;
  title: string;
  active: boolean;
  dirty: boolean;
  icon: ReactNode;
}

function TabShell({ id, name, title, active, dirty, icon }: ShellProps) {
  return (
    <div
      className={`tab ${active ? 'active' : ''}`}
      role="tab"
      aria-selected={active}
      title={title}
      onClick={() => selectTab(id)}
      onAuxClick={(e) => e.button === 1 && void closeTab(id)}
    >
      {icon}
      <span className="tab-name">{name}</span>
      <button
        className={`tab-close ${dirty ? 'dirty' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(id);
        }}
        aria-label={`Close ${name}`}
        title={dirty ? 'Unsaved changes — click to close' : 'Close'}
      >
        {dirty && <span className="dirty-dot" />}
        <X size={13} className="x" />
      </button>
    </div>
  );
}

function DocTabItem({ tab, active }: { tab: DocTab; active: boolean }) {
  useModelVersion(tab.model); // re-render when the document becomes dirty / clean
  useInspectorDraft((s) => s.pending?.tabId === tab.id); // ...or when a draft starts / ends
  return (
    <TabShell
      id={tab.id}
      name={tab.name}
      title={tab.path ?? tab.name}
      active={active}
      dirty={isDirty(tab)}
      icon={<DocBadge family={getAnalysis(tab.model).type.family} size={16} />}
    />
  );
}

function CompareTabItem({ tab, active }: { tab: CompareTab; active: boolean }) {
  return (
    <TabShell
      id={tab.id}
      name={`Compare: ${tab.name}`}
      title={tab.name}
      active={active}
      dirty={false}
      icon={<FileDiff size={15} className="ic" />}
    />
  );
}

const SAVE_KEY = isMac ? '⌘S' : 'Ctrl+S';
const SAVE_AS_KEY = isMac ? '⇧⌘S' : 'Ctrl+Shift+S';

/** Same paths as File → Save / Save As (⌘S / ⇧⌘S), so Inspector drafts are committed first. */
function SaveButton({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  useInspectorDraft((s) => s.pending?.tabId === tab.id);
  const [openMenu, menu] = useContextMenu();
  const dirty = isDirty(tab);
  return (
    <div className="split-btn">
      <button
        className="btn-ghost"
        onClick={() => dispatchCommand(COMMANDS.save.id)}
        disabled={!dirty}
        title={dirty ? `Save (${SAVE_KEY})` : 'No unsaved changes'}
      >
        <Save size={15} /> Save
      </button>
      <button
        className="btn-ghost split-more"
        aria-label="More save options"
        aria-haspopup="menu"
        title="More save options"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu(
            e,
            [
              {
                label: 'Save',
                shortcut: SAVE_KEY,
                disabled: !dirty,
                onClick: () => dispatchCommand(COMMANDS.save.id),
              },
              {
                label: 'Save As…',
                shortcut: SAVE_AS_KEY,
                onClick: () => dispatchCommand(COMMANDS.saveAs.id),
              },
            ],
            { x: r.left, y: r.bottom + 2 },
          );
        }}
      >
        <ChevronDown size={14} />
      </button>
      {menu}
    </div>
  );
}

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);
  const activeDoc = tabs.find((t): t is DocTab => t.id === activeId && t.kind === 'doc');

  return (
    <header
      className={`tabbar ${host.os === 'darwin' ? 'mac-inset' : ''}`}
      // Tauri ignores `-webkit-app-region`; tabs and buttons are excluded automatically.
      data-tauri-drag-region={host.kind === 'tauri' && host.os === 'darwin' ? 'deep' : undefined}
    >
      <div className="tabs" role="tablist">
        {tabs.map((t) =>
          t.kind === 'doc' ? (
            <DocTabItem key={t.id} tab={t} active={t.id === activeId} />
          ) : (
            <CompareTabItem key={t.id} tab={t} active={t.id === activeId} />
          ),
        )}
        <button
          className="tab-new"
          onClick={() => void openFilesFromDialog()}
          title="Open file… (Ctrl/Cmd+O)"
          aria-label="Open file"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="tabbar-actions">
        {activeDoc && <SaveButton tab={activeDoc} />}
        <button
          className="btn-ghost"
          onClick={() => void compareWithFile()}
          title="Compare two files (Ctrl/Cmd+Shift+D)"
        >
          <GitCompare size={15} /> Compare
        </button>
      </div>
    </header>
  );
}
