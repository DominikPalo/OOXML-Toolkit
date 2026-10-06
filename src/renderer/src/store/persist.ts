/** Loads and saves settings, history, bookmarks and the open-tab session through the host. */
import { host } from '../host';
import { getState, setState, useApp } from './app';
import {
  DEFAULT_SETTINGS,
  type Bookmark,
  type HistoryEntry,
  type Selection,
  type Settings,
} from './types';

export interface SessionState {
  tabs: Array<{ path: string; selection: Selection; treeMode?: 'parts' | 'relationships' }>;
  activePath?: string;
  ui?: { sidebarView?: string; sidebarOpen?: boolean; sidebarWidth?: number };
}

export async function loadPersisted(): Promise<SessionState | undefined> {
  const [settings, history, bookmarks, session] = await Promise.all([
    host.storageGet<Partial<Settings>>('settings'),
    host.storageGet<HistoryEntry[]>('history'),
    host.storageGet<Bookmark[]>('bookmarks'),
    host.storageGet<SessionState>('session'),
  ]);
  setState((s) => ({
    settings: { ...DEFAULT_SETTINGS, ...settings },
    history: Array.isArray(history) ? history : [],
    bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
    ui: {
      ...s.ui,
      ...(session?.ui?.sidebarView ? { sidebarView: session.ui.sidebarView as never } : {}),
      ...(session?.ui?.sidebarOpen !== undefined ? { sidebarOpen: session.ui.sidebarOpen } : {}),
      ...(session?.ui?.sidebarWidth ? { sidebarWidth: session.ui.sidebarWidth } : {}),
    },
    loaded: true,
  }));
  return session;
}

/** Persist changes as they happen. Call once after `loadPersisted`. */
export function startPersisting(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSession = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = getState();
      const tabs = s.tabs.flatMap((t) =>
        t.kind === 'doc' && t.path
          ? [{ path: t.path, selection: t.selection, treeMode: t.treeMode }]
          : [],
      );
      const active = s.tabs.find((t) => t.id === s.activeId);
      const session: SessionState = {
        tabs,
        activePath: active?.kind === 'doc' ? active.path : undefined,
        ui: {
          sidebarView: s.ui.sidebarView,
          sidebarOpen: s.ui.sidebarOpen,
          sidebarWidth: s.ui.sidebarWidth,
        },
      };
      void host.storageSet('session', session);
    }, 400);
  };

  useApp.subscribe((state, prev) => {
    if (!state.loaded) return;
    if (state.settings !== prev.settings) void host.storageSet('settings', state.settings);
    if (state.history !== prev.history) {
      void host.storageSet('history', state.history);
      host.setRecentFiles(state.history.flatMap((h) => (h.path ? [h.path] : [])));
    }
    if (state.bookmarks !== prev.bookmarks) void host.storageSet('bookmarks', state.bookmarks);
    if (state.tabs !== prev.tabs || state.activeId !== prev.activeId || state.ui !== prev.ui)
      scheduleSession();
  });
}
