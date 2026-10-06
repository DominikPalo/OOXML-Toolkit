import {
  Bookmark,
  FolderTree,
  History,
  Search,
  ShieldAlert,
  Settings,
  Sun,
  Moon,
} from 'lucide-react';
import { COMMANDS } from '@shared/commands';
import { isMac } from '../../host';
import { activeTab, useApp } from '../../store/app';
import { dispatchCommand, showSidebar, toggleSidebar } from '../../store/actions';
import type { SidebarView } from '../../store/types';
import { CompareTree } from '../compare/CompareView';
import { Explorer } from './Explorer';
import { SearchPanel } from './SearchPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { HistoryPanel } from './HistoryPanel';
import { ProblemsPanel } from './ProblemsPanel';

const VIEWS: Array<{
  id: SidebarView;
  label: string;
  icon: typeof Search;
  command: string;
  accel: string;
}> = [
  {
    id: 'explorer',
    label: 'Explorer',
    icon: FolderTree,
    command: COMMANDS.explorer.id,
    accel: 'Shift+E',
  },
  { id: 'search', label: 'Search', icon: Search, command: COMMANDS.searchAll.id, accel: 'Shift+F' },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    icon: Bookmark,
    command: COMMANDS.bookmarks.id,
    accel: 'Shift+B',
  },
  {
    id: 'history',
    label: 'Recent files',
    icon: History,
    command: COMMANDS.history.id,
    accel: 'Shift+H',
  },
  {
    id: 'problems',
    label: 'Package check',
    icon: ShieldAlert,
    command: COMMANDS.problems.id,
    accel: 'Shift+M',
  },
];

export function ActivityBar() {
  const ui = useApp((s) => s.ui);
  const bookmarkCount = useApp((s) => s.bookmarks.length);
  const theme = useApp((s) => s.settings.theme);
  const errors = useApp((s) => {
    const t = activeTab(s);
    return t?.kind === 'doc' ? t.problems.items.filter((p) => p.severity === 'error').length : 0;
  });
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <nav className="activity-bar" aria-label="Views">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = ui.sidebarOpen && ui.sidebarView === v.id;
        const badge = v.id === 'bookmarks' ? bookmarkCount : v.id === 'problems' ? errors : 0;
        return (
          <button
            key={v.id}
            className={`activity-btn ${active ? 'active' : ''}`}
            title={`${v.label} (${isMac ? '⌘' : 'Ctrl+'}${v.accel.replace('Shift+', isMac ? '⇧' : 'Shift+')})`}
            aria-label={v.label}
            aria-pressed={active}
            onClick={() =>
              active
                ? toggleSidebar()
                : v.id === 'search' || v.id === 'problems'
                  ? dispatchCommand(v.command)
                  : showSidebar(v.id)
            }
          >
            <Icon size={20} />
            {badge > 0 && (
              <span className={`badge-dot ${v.id === 'problems' ? 'error' : ''}`}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
      <span className="spacer" />
      <button
        className="activity-btn"
        title="Toggle light / dark theme"
        aria-label="Toggle theme"
        onClick={() => dispatchCommand(COMMANDS.toggleTheme.id)}
      >
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <button
        className="activity-btn"
        title="Settings"
        aria-label="Settings"
        onClick={() => dispatchCommand(COMMANDS.settings.id)}
      >
        <Settings size={19} />
      </button>
    </nav>
  );
}

const TITLES: Record<SidebarView, string> = {
  explorer: 'Explorer',
  search: 'Search',
  bookmarks: 'Bookmarks',
  history: 'Recent files',
  problems: 'Package check',
};

export function Sidebar() {
  const view = useApp((s) => s.ui.sidebarView);
  const tab = useApp((s) => activeTab(s));

  let body: React.ReactNode;
  if (view === 'bookmarks') body = <BookmarksPanel />;
  else if (view === 'history') body = <HistoryPanel />;
  else if (!tab)
    body = (
      <div className="empty-panel">
        <p>No document open.</p>
      </div>
    );
  else if (tab.kind === 'compare') {
    body =
      view === 'explorer' ? (
        <CompareTree tab={tab} />
      ) : (
        <div className="empty-panel">
          <p>Not available while comparing.</p>
          <p className="muted small">Switch to a document tab.</p>
        </div>
      );
  } else if (view === 'explorer') body = <Explorer tab={tab} />;
  else if (view === 'search') body = <SearchPanel tab={tab} />;
  else body = <ProblemsPanel tab={tab} />;

  return (
    <aside className="sidebar" aria-label={TITLES[view]}>
      <div className="sidebar-title">
        {view === 'explorer' && tab?.kind === 'compare' ? 'Compared parts' : TITLES[view]}
      </div>
      <div className="sidebar-body">{body}</div>
    </aside>
  );
}
