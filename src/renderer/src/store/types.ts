import type { PackageModel, PartSource } from '@core/package/model';
import type { Problem } from '@core/package/validate';
import type { CompareOptions, CompareResult, DiffStatus } from '@core/compare/compare';
import type { PackageFamily } from '@core/package/opc';
import type { FileStamp } from '@shared/api';

export type SidebarView = 'explorer' | 'search' | 'bookmarks' | 'history' | 'problems';
export type TreeMode = 'parts' | 'relationships';
export type DetailTab =
  'source' | 'preview' | 'inspector' | 'relationships' | 'info' | 'hex' | 'table';

/** What is selected in a document: nothing = package root. */
export interface Selection {
  folder?: string;
  part?: string;
  /** Element index path inside `part`. */
  path?: number[];
}

/** A request to scroll the source editor to a range (search hits, problems, bookmarks). */
export interface Reveal {
  part: string;
  line?: number;
  column?: number;
  offset?: number;
  length?: number;
  token: number;
}

export interface DocTab {
  kind: 'doc';
  id: string;
  name: string;
  /** Absolute path on disk (desktop app only). */
  path?: string;
  model: PackageModel;
  readOnly: boolean;
  /** Stamp of the file as it was when `model` was read from it or last saved to it. */
  diskStamp?: FileStamp;
  /** Another program changed the file on disk after it was loaded here. */
  externalChange?: {
    dismissed: boolean;
    /** The version on disk that raised the warning. */
    stamp: FileStamp;
  };
  /** How often the document was reloaded from disk (remounts the views of the old model). */
  reloads: number;

  selection: Selection;
  /** Row id of the selected tree row (needed in relationship mode where parts occur many times). */
  selectedRowId: string;
  treeMode: TreeMode;
  expanded: Record<string, true>;
  childLimits: Record<string, number>;
  detailTab: DetailTab;
  navBack: Selection[];
  navForward: Selection[];
  reveal?: Reveal;
  problems: { status: 'idle' | 'running' | 'done'; items: Problem[]; atVersion: number };
}

export interface CompareSide {
  label: string;
  source: PartSource;
  family?: PackageFamily;
}

export interface CompareTab {
  kind: 'compare';
  id: string;
  name: string;
  a: CompareSide;
  b: CompareSide;
  options: CompareOptions;
  status: 'running' | 'done' | 'error';
  progress: number;
  error?: string;
  result?: CompareResult;
  selected?: string;
  expanded: Record<string, true>;
  filter: Record<DiffStatus, boolean>;
  view: 'split' | 'unified';
  collapseUnchanged: boolean;
}

export type Tab = DocTab | CompareTab;

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  editorFontSize: number;
  wrapLines: boolean;
  prettyPrint: boolean;
  backupOnSave: boolean;
  restoreSession: boolean;
  compareIgnoreFormatting: boolean;
  compareSortAttributes: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  editorFontSize: 13,
  wrapLines: false,
  prettyPrint: true,
  backupOnSave: false,
  restoreSession: true,
  compareIgnoreFormatting: true,
  compareSortAttributes: false,
};

export interface HistoryEntry {
  /** Path when known, otherwise the file name. */
  key: string;
  path?: string;
  name: string;
  size: number;
  typeLabel: string;
  family: PackageFamily;
  openedAt: number;
  openCount: number;
  pinned?: boolean;
}

export interface Bookmark {
  id: string;
  /** Path when known, otherwise the file name (same as `HistoryEntry.key`). */
  fileKey: string;
  filePath?: string;
  fileName: string;
  part: string;
  /** XPath-like locator for element bookmarks. */
  xpath?: string;
  label: string;
  note?: string;
  createdAt: number;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export type DialogState =
  | {
      kind: 'confirm';
      title: string;
      message: string;
      detail?: string[];
      buttons: DialogButton[];
      resolve: (value: string) => void;
    }
  | {
      kind: 'prompt';
      title: string;
      label: string;
      value: string;
      placeholder?: string;
      multiline?: boolean;
      confirmLabel?: string;
      validate?: (value: string) => string | undefined;
      resolve: (value: string | undefined) => void;
    }
  | {
      kind: 'insertXml';
      target: string;
      resolve: (
        value:
          { xml: string; position: 'firstChild' | 'lastChild' | 'before' | 'after' } | undefined,
      ) => void;
    }
  | { kind: 'compareSetup'; initialA?: string }
  | { kind: 'settings' };

export interface UiState {
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidth: number;
  quickOpen: boolean;
  dragging: boolean;
}

export interface AppState {
  tabs: Tab[];
  activeId: string | null;
  settings: Settings;
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  ui: UiState;
  dialog: DialogState | null;
  toasts: Toast[];
  loaded: boolean;
}
