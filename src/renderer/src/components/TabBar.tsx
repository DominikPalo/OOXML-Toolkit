import type { ReactNode } from 'react';
import { FileDiff, GitCompare, Plus, X } from 'lucide-react';
import { getAnalysis, useApp, useModelVersion } from '../store/app';
import {
  closeTab,
  compareWithFile,
  isDirty,
  openFilesFromDialog,
  selectTab,
} from '../store/actions';
import { host } from '../host';
import { useInspectorDraft } from '../store/inspectorDraft';
import type { CompareTab, DocTab } from '../store/types';
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

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeId = useApp((s) => s.activeId);

  return (
    <header className={`tabbar ${host.os === 'darwin' ? 'mac-inset' : ''}`}>
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
