/**
 * Application commands. The native menu (Electron) and the in-app keyboard handler (browser)
 * are both generated from this list so the shortcuts never drift apart.
 */
export interface CommandDef {
  id: string;
  label: string;
  /** Electron accelerator syntax, e.g. `CmdOrCtrl+Shift+F`. */
  accelerator?: string;
}

export const COMMANDS = {
  open: { id: 'file.open', label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  save: { id: 'file.save', label: 'Save', accelerator: 'CmdOrCtrl+S' },
  saveAs: { id: 'file.saveAs', label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' },
  reload: { id: 'file.reload', label: 'Reload from Disk' },
  close: { id: 'file.close', label: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
  compare: { id: 'file.compare', label: 'Compare Files…', accelerator: 'CmdOrCtrl+Shift+D' },
  compareDisk: {
    id: 'file.compareChanges',
    label: 'Review Unsaved Changes',
    accelerator: 'CmdOrCtrl+Alt+D',
  },
  reveal: { id: 'file.reveal', label: 'Reveal in Finder / Explorer' },
  undo: { id: 'edit.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
  redo: { id: 'edit.redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' },
  find: { id: 'edit.find', label: 'Find in Part', accelerator: 'CmdOrCtrl+F' },
  searchAll: { id: 'view.search', label: 'Search in Package', accelerator: 'CmdOrCtrl+Shift+F' },
  quickOpen: { id: 'view.quickOpen', label: 'Go to Part…', accelerator: 'CmdOrCtrl+P' },
  explorer: { id: 'view.explorer', label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E' },
  bookmarks: { id: 'view.bookmarks', label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+B' },
  history: { id: 'view.history', label: 'Recent Files', accelerator: 'CmdOrCtrl+Shift+H' },
  problems: { id: 'view.problems', label: 'Package Check', accelerator: 'CmdOrCtrl+Shift+M' },
  toggleSidebar: { id: 'view.toggleSidebar', label: 'Toggle Side Bar', accelerator: 'CmdOrCtrl+B' },
  toggleTheme: { id: 'view.toggleTheme', label: 'Toggle Light / Dark Theme' },
  toggleBookmark: {
    id: 'bookmark.toggle',
    label: 'Bookmark Selection',
    accelerator: 'CmdOrCtrl+D',
  },
  navBack: { id: 'nav.back', label: 'Back', accelerator: 'CmdOrCtrl+[' },
  navForward: { id: 'nav.forward', label: 'Forward', accelerator: 'CmdOrCtrl+]' },
  nextTab: { id: 'tab.next', label: 'Next Tab', accelerator: 'Ctrl+Tab' },
  prevTab: { id: 'tab.prev', label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab' },
  formatXml: { id: 'edit.format', label: 'Format XML', accelerator: 'CmdOrCtrl+Alt+F' },
  settings: { id: 'app.settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,' },
  about: { id: 'app.about', label: 'About OOXML Toolkit' },
} as const satisfies Record<string, CommandDef>;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS]['id'];

/** The parts of a DOM `KeyboardEvent` we need (this module is also compiled without DOM typings). */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Test a keyboard event against an Electron accelerator (used by the browser fallback). */
export function matchesAccelerator(accelerator: string, e: KeyEventLike, isMac: boolean): boolean {
  const parts = accelerator.split('+');
  const key = parts.pop()!.toLowerCase();
  const has = (m: string): boolean => parts.includes(m);
  const ctrlWanted = has('Ctrl') || (has('CmdOrCtrl') && !isMac);
  const metaWanted = has('Cmd') || (has('CmdOrCtrl') && isMac);
  if (e.ctrlKey !== ctrlWanted || e.metaKey !== metaWanted) return false;
  if (e.shiftKey !== has('Shift') || e.altKey !== has('Alt')) return false;
  // `e.code` keeps letters matchable when Alt/Option changes `e.key` (macOS).
  return (
    e.key.toLowerCase() === key ||
    (key.length === 1 && /[a-z]/.test(key) && e.code === `Key${key.toUpperCase()}`)
  );
}
