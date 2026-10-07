import { useEffect, useState, useSyncExternalStore } from 'react';
import { OOXML_EXTENSIONS } from '@shared/api';
import { host } from './host';
import { activeTab, setState, useApp } from './store/app';
import {
  dispatchCommand,
  isDirty,
  openDropped,
  openPath,
  requestWindowClose,
  restoreSession,
} from './store/actions';
import { loadPersisted, startPersisting } from './store/persist';
import { useInspectorDraft } from './store/inspectorDraft';
import { ActivityBar, Sidebar } from './components/sidebar/Sidebar';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { Welcome } from './components/Welcome';
import { Dialogs } from './components/Dialogs';
import { QuickOpen } from './components/QuickOpen';
import { Toasts } from './components/common/Toasts';
import { ResizeHandle } from './components/common/ResizeHandle';
import { DetailPane } from './components/detail/DetailPane';
import { CompareView } from './components/compare/CompareView';

let booted = false;

function useBoot(): void {
  useEffect(() => {
    if (booted) return;
    booted = true;
    const offs = [
      host.onCommand((command, arg) => dispatchCommand(command, arg)),
      host.onOpenPaths((paths) => paths.forEach((p) => void openPath(p))),
      host.onCloseRequested(() => void requestWindowClose()),
    ];
    void (async () => {
      const session = await loadPersisted();
      startPersisting();
      host.ready();
      await restoreSession(session);
    })();
    return () => offs.forEach((off) => off());
  }, []);
}

function useTheme(): void {
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Number of documents with unsaved changes (re-evaluated whenever any model or draft changes). */
function useDirtyCount(): number {
  const tabs = useApp((s) => s.tabs);
  return useSyncExternalStore(
    (cb) => {
      const offs = tabs.flatMap((t) => (t.kind === 'doc' ? [t.model.subscribe(cb)] : []));
      offs.push(useInspectorDraft.subscribe(cb));
      return () => offs.forEach((off) => off());
    },
    () => tabs.reduce((n, t) => n + (isDirty(t) ? 1 : 0), 0),
  );
}

function useWindowState(): void {
  const dirtyCount = useDirtyCount();
  const tab = useApp((s) => activeTab(s));
  const name = tab ? (tab.kind === 'doc' ? tab.name : `Compare: ${tab.name}`) : undefined;
  const path = tab?.kind === 'doc' ? tab.path : undefined;
  useEffect(() => {
    host.setWindowState({
      title: name ? `${name} — OOXML Toolkit` : 'OOXML Toolkit',
      path,
      dirtyCount,
    });
  }, [name, path, dirtyCount]);

  useEffect(() => {
    if (host.kind !== 'web' || !dirtyCount) return;
    const guard = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirtyCount]);
}

function useDragDrop(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean =>
      !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void openDropped([...e.dataTransfer!.files]);
    };
    const offHost = host.onFileDrag?.(setDragging);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      offHost?.();
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return dragging;
}

function Main() {
  const tab = useApp((s) => activeTab(s));
  if (!tab) return <Welcome />;
  if (tab.kind === 'compare') return <CompareView key={tab.id} tab={tab} />;
  return <DetailPane key={tab.id} tab={tab} />;
}

export function App() {
  useBoot();
  useTheme();
  useWindowState();
  const dragging = useDragDrop();
  const ui = useApp((s) => s.ui);
  const hasTabs = useApp((s) => s.tabs.length > 0);
  const showSidebar =
    ui.sidebarOpen && (hasTabs || ui.sidebarView === 'bookmarks' || ui.sidebarView === 'history');
  const fontSize = useApp((s) => s.settings.editorFontSize);

  return (
    <div
      className="app"
      data-os={host.os}
      style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
    >
      <TabBar />
      <div className="workspace">
        <ActivityBar />
        {showSidebar && (
          <>
            <div className="sidebar-wrap" style={{ width: ui.sidebarWidth }}>
              <Sidebar />
            </div>
            <ResizeHandle
              size={ui.sidebarWidth}
              onResize={(w) => setState((s) => ({ ui: { ...s.ui, sidebarWidth: w } }))}
              min={200}
              max={640}
            />
          </>
        )}
        <main className="main">
          <Main />
        </main>
      </div>
      <StatusBar />
      <QuickOpen />
      <Dialogs />
      <Toasts />
      {dragging && (
        <div className="drop-overlay">
          <div>Drop to open</div>
          <small>
            {OOXML_EXTENSIONS.slice(0, 8)
              .map((e) => `.${e}`)
              .join('  ')}{' '}
            …
          </small>
        </div>
      )}
    </div>
  );
}
