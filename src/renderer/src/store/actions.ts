/** Application behaviour: everything the UI can ask for lives here, never inside components. */
import { PackageModel, type PartSource } from '@core/package/model';
import { baseName, extensionOf, partKind } from '@core/package/kinds';
import { contentTypeOf, encodePartUri, partNameProblem, relativeTarget } from '@core/package/opc';
import { validatePackage } from '@core/package/validate';
import { comparePackages, type DiffStatus } from '@core/compare/compare';
import { formatXml, minifyXml } from '@core/xml/format';
import { elementAtPath, elementPath, resolveSimpleXPath, xpathOf } from '@core/xml/parser';
import { COMMANDS } from '@shared/commands';
import type { FileFilter, OpenedFile } from '@shared/api';
import { host } from '../host';
import { ancestorIds, elementRowId, folderRowId, partRowId, type TreeRow } from '../lib/treeModel';
import { previewKindOf, tabsFor } from '../lib/previewKind';
import {
  activeDoc,
  activeTab,
  getAnalysis,
  getState,
  setState,
  updateCompare,
  updateDoc,
} from './app';
import { confirmDialog, openDialog, promptDialog, toast, toastError } from './ui';
import type {
  Bookmark,
  CompareSide,
  CompareTab,
  DetailTab,
  DocTab,
  HistoryEntry,
  Selection,
  Settings,
  SidebarView,
  Tab,
  TreeMode,
} from './types';
import type { SessionState } from './persist';

let idSeq = 1;
const newId = (prefix: string): string => `${prefix}-${idSeq++}-${Date.now().toString(36)}`;
let revealToken = 1;

const docById = (id: string): DocTab | undefined => {
  const t = getState().tabs.find((x) => x.id === id);
  return t?.kind === 'doc' ? t : undefined;
};

export const fileKey = (tab: DocTab): string => tab.path ?? tab.name;

// ---------------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------------

export async function openFilesFromDialog(): Promise<void> {
  try {
    const files = await host.openFiles();
    for (const f of files) openFile(f);
  } catch (e) {
    toastError('Could not open file: ', e);
  }
}

export async function openPath(path: string): Promise<boolean> {
  const existing = getState().tabs.find((t) => t.kind === 'doc' && t.path === path);
  if (existing) {
    selectTab(existing.id);
    return true;
  }
  try {
    const data = await host.readFile(path);
    return openFile({ path, name: baseName(path.replace(/\\/g, '/')), data }) !== undefined;
  } catch (e) {
    toastError(`Could not open ${baseName(path.replace(/\\/g, '/'))}: `, e);
    return false;
  }
}

export function openFile(
  file: OpenedFile,
  options: { readOnly?: boolean } = {},
): string | undefined {
  const state = getState();
  if (file.path) {
    const existing = state.tabs.find((t) => t.kind === 'doc' && t.path === file.path);
    if (existing) {
      selectTab(existing.id);
      return existing.id;
    }
  }
  let model: PackageModel;
  try {
    model = PackageModel.open(file.data, file.name);
  } catch (e) {
    toastError(`${file.name} is not a valid ZIP-based package: `, e);
    return undefined;
  }
  const analysis = getAnalysis(model);
  const id = newId('doc');
  const mainDir =
    analysis.mainPart && analysis.mainPart.includes('/')
      ? analysis.mainPart.split('/')[0] + '/'
      : undefined;
  const tab: DocTab = {
    kind: 'doc',
    id,
    name: file.name,
    path: file.path,
    model,
    readOnly: options.readOnly ?? false,
    selection: {},
    selectedRowId: 'root',
    treeMode: 'parts',
    expanded: { root: true, ...(mainDir ? { [folderRowId(mainDir)]: true } : {}) },
    childLimits: {},
    detailTab: 'source',
    navBack: [],
    navForward: [],
    problems: { status: 'idle', items: [], atVersion: -1 },
  };
  setState((s) => ({ tabs: [...s.tabs, tab], activeId: id }));

  const key = file.path ?? file.name;
  const entry: HistoryEntry = {
    key,
    path: file.path,
    name: file.name,
    size: file.data.length,
    typeLabel: analysis.type.label,
    family: analysis.type.family,
    openedAt: Date.now(),
    openCount: 1,
  };
  setState((s) => {
    const prev = s.history.find((h) => h.key === key);
    const merged = prev
      ? { ...prev, ...entry, openCount: prev.openCount + 1, pinned: prev.pinned }
      : entry;
    const rest = s.history.filter((h) => h.key !== key);
    return { history: [merged, ...rest].slice(0, 200) };
  });
  return id;
}

export async function openDropped(files: File[]): Promise<void> {
  for (const f of files) {
    try {
      const path = host.pathForFile(f);
      if (path) await host.approvePaths([path]);
      openFile({ path, name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    } catch (e) {
      toastError(`Could not open ${f.name}: `, e);
    }
  }
}

export function openEmbedded(tabId: string, part: string): void {
  const tab = docById(tabId);
  if (!tab) return;
  const id = openFile({
    name: `${baseName(part)} (in ${tab.name})`,
    data: tab.model.getBytes(part),
  });
  if (id) toast('info', 'Opened embedded package. Use “Save As” to write it to disk.');
}

export async function restoreSession(session: SessionState | undefined): Promise<void> {
  if (!session?.tabs?.length || !getState().settings.restoreSession) return;
  for (const t of session.tabs) {
    if (!(await openPath(t.path).catch(() => false))) continue;
    const tab = getState().tabs.find((x) => x.kind === 'doc' && x.path === t.path);
    if (tab && tab.kind === 'doc') {
      const sel = t.selection ?? {};
      const valid = !sel.part || tab.model.has(sel.part);
      updateDoc(tab.id, { treeMode: t.treeMode ?? 'parts' });
      if (valid && (sel.part || sel.folder)) navigate(tab.id, sel, { record: false });
    }
  }
  const active = getState().tabs.find((x) => x.kind === 'doc' && x.path === session.activePath);
  if (active) selectTab(active.id);
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

export function selectTab(id: string): void {
  setState((s) => {
    const target = s.tabs.find((t) => t.id === id);
    // Search and package check only apply to documents; a comparison shows its own tree instead.
    const needsExplorer =
      target?.kind === 'compare' &&
      (s.ui.sidebarView === 'search' || s.ui.sidebarView === 'problems');
    return { activeId: id, ui: needsExplorer ? { ...s.ui, sidebarView: 'explorer' } : s.ui };
  });
}

export function cycleTab(direction: 1 | -1): void {
  const { tabs, activeId } = getState();
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  selectTab(tabs[(i + direction + tabs.length) % tabs.length].id);
}

export function isDirty(tab: Tab): boolean {
  return tab.kind === 'doc' && tab.model.isDirty();
}

export async function closeTab(id: string, options: { force?: boolean } = {}): Promise<boolean> {
  const tab = getState().tabs.find((t) => t.id === id);
  if (!tab) return true;
  if (tab.kind === 'doc' && tab.model.isDirty() && !options.force) {
    selectTab(id);
    const choice = await confirmDialog({
      title: `Save changes to “${tab.name}”?`,
      message: 'Your changes will be lost if you don’t save them.',
      buttons: [
        { label: 'Don’t Save', value: 'discard', danger: true },
        { label: 'Cancel', value: 'cancel' },
        { label: 'Save', value: 'save', primary: true },
      ],
    });
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await saveTab(id))) return false;
  }
  setState((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeId = s.activeId;
    if (activeId === id) {
      const idx = s.tabs.findIndex((t) => t.id === id);
      activeId = (tabs[Math.min(idx, tabs.length - 1)] ?? null)?.id ?? null;
    }
    return { tabs, activeId };
  });
  return true;
}

export function dirtyDocs(): DocTab[] {
  return getState().tabs.filter((t): t is DocTab => t.kind === 'doc' && t.model.isDirty());
}

/** Window close: ask what to do with unsaved documents, then close. */
export async function requestWindowClose(): Promise<void> {
  const dirty = dirtyDocs();
  if (!dirty.length) {
    host.forceClose();
    return;
  }
  const choice = await confirmDialog({
    title: `You have ${dirty.length} document${dirty.length > 1 ? 's' : ''} with unsaved changes`,
    message: 'Do you want to save them before closing?',
    detail: dirty.map((d) => d.name),
    buttons: [
      { label: 'Discard Changes', value: 'discard', danger: true },
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save All', value: 'save', primary: true },
    ],
  });
  if (choice === 'cancel') return;
  if (choice === 'save') for (const d of dirty) if (!(await saveTab(d.id))) return;
  host.forceClose();
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

function saveFilters(name: string): FileFilter[] {
  const ext = extensionOf(name);
  return ext
    ? [
        { name: `${ext.toUpperCase()} file`, extensions: [ext] },
        { name: 'All files', extensions: ['*'] },
      ]
    : [{ name: 'All files', extensions: ['*'] }];
}

async function confirmMalformed(tab: DocTab): Promise<boolean> {
  const bad = tab.model
    .changedParts()
    .filter((p) => p.status !== 'deleted')
    .map((p) => p.name)
    .filter((n) => {
      const kind = partKind(n, contentTypeOf(getAnalysis(tab.model).contentTypes, n));
      return (kind === 'xml' || kind === 'rels') && !!tab.model.getXml(n).error;
    });
  if (!bad.length) return true;
  const choice = await confirmDialog({
    title: 'Some edited parts are not well-formed XML',
    message: 'Office will probably refuse to open the file (or offer to “repair” it). Save anyway?',
    detail: bad,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save Anyway', value: 'save', danger: true },
    ],
  });
  return choice === 'save';
}

export async function saveTab(id: string): Promise<boolean> {
  const tab = docById(id);
  if (!tab) return false;
  if (!tab.path || host.kind === 'web') return saveTabAs(id);
  if (!tab.model.isDirty()) {
    toast('info', 'No changes to save.');
    return true;
  }
  if (!(await confirmMalformed(tab))) return false;
  try {
    const bytes = tab.model.serialize();
    await host.writeFile(tab.path, bytes, { backup: getState().settings.backupOnSave });
    tab.model.rebase(bytes);
    touchHistorySize(fileKey(tab), bytes.length);
    toast('success', `Saved ${tab.name}`);
    return true;
  } catch (e) {
    toastError('Save failed: ', e);
    return false;
  }
}

export async function saveTabAs(id: string): Promise<boolean> {
  const tab = docById(id);
  if (!tab) return false;
  if (tab.model.isDirty() && !(await confirmMalformed(tab))) return false;
  try {
    const bytes = tab.model.serialize();
    const result = await host.saveAs(tab.name, bytes, saveFilters(tab.name));
    if (!result) return false;
    tab.model.rebase(bytes);
    const oldKey = fileKey(tab);
    updateDoc(id, { name: result.name, path: result.path ?? tab.path });
    if (result.path) {
      setState((s) => ({
        history: [
          {
            ...(s.history.find((h) => h.key === oldKey) ?? {
              name: result.name,
              typeLabel: 'Package',
              family: 'unknown',
              openCount: 1,
            }),
            key: result.path!,
            path: result.path,
            name: result.name,
            size: bytes.length,
            openedAt: Date.now(),
          } as HistoryEntry,
          ...s.history.filter((h) => h.key !== oldKey && h.key !== result.path),
        ],
      }));
    }
    toast('success', host.kind === 'web' ? `Downloaded ${result.name}` : `Saved ${result.name}`);
    return true;
  } catch (e) {
    toastError('Save failed: ', e);
    return false;
  }
}

function touchHistorySize(key: string, size: number): void {
  setState((s) => ({ history: s.history.map((h) => (h.key === key ? { ...h, size } : h)) }));
}

// ---------------------------------------------------------------------------------------------
// Selection & navigation
// ---------------------------------------------------------------------------------------------

export function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.part === b.part &&
    a.folder === b.folder &&
    (a.path ?? []).join('/') === (b.path ?? []).join('/') &&
    !!a.path === !!b.path
  );
}

export function rowIdForSelection(sel: Selection): string {
  if (sel.part && sel.path) return elementRowId(sel.part, sel.path);
  if (sel.part) return partRowId(sel.part);
  if (sel.folder) return folderRowId(sel.folder);
  return 'root';
}

/** Which detail tab to show after the selection changed. */
function validDetailTab(tab: DocTab, sel: Selection): DetailTab {
  if (!sel.part) return tab.detailTab;
  const ct = contentTypeOf(getAnalysis(tab.model).contentTypes, sel.part);
  const available = tabsFor({
    kind: partKind(sel.part, ct),
    part: sel.part,
    hasElement: !!sel.path,
    preview: previewKindOf(ct),
  });
  if (available.includes(tab.detailTab)) return tab.detailTab;
  return available[0] ?? 'source';
}

export function navigate(
  id: string,
  sel: Selection,
  options: { record?: boolean; detailTab?: DetailTab; sidebar?: boolean } = {},
): void {
  updateDoc(id, (tab) => {
    const same = sameSelection(tab.selection, sel);
    const navBack =
      options.record === false || same ? tab.navBack : [...tab.navBack.slice(-49), tab.selection];
    const expanded = { ...tab.expanded };
    if (tab.treeMode === 'parts')
      for (const rid of ancestorIds(sel.part, sel.path, sel.folder)) expanded[rid] = true;
    else expanded.root = true;
    const next: Partial<DocTab> = {
      selection: sel,
      selectedRowId: tab.treeMode === 'parts' ? rowIdForSelection(sel) : tab.selectedRowId,
      navBack,
      navForward: same || options.record === false ? tab.navForward : [],
      expanded,
    };
    const detail = options.detailTab ?? validDetailTab(tab, sel);
    next.detailTab = detail;
    return next;
  });
  setState({ activeId: id });
  if (options.sidebar) showSidebar('explorer');
}

export function selectRow(id: string, row: TreeRow): void {
  let sel: Selection;
  switch (row.kind) {
    case 'root':
    case 'group':
      sel = {};
      break;
    case 'folder':
      sel = { folder: row.folder };
      break;
    case 'part':
      sel = { part: row.part };
      break;
    case 'element':
      sel = { part: row.part, path: row.path };
      break;
    case 'rel':
      sel = { part: row.part ?? row.rel?.relsPart };
      break;
    case 'error':
      sel = { part: row.part };
      break;
    default:
      return;
  }
  navigate(id, sel);
  updateDoc(id, { selectedRowId: row.id });
}

export function navBack(id: string): void {
  const tab = docById(id);
  if (!tab || !tab.navBack.length) return;
  const prev = tab.navBack[tab.navBack.length - 1];
  updateDoc(id, {
    navBack: tab.navBack.slice(0, -1),
    navForward: [...tab.navForward, tab.selection],
  });
  navigate(id, prev, { record: false });
}

export function navForward(id: string): void {
  const tab = docById(id);
  if (!tab || !tab.navForward.length) return;
  const next = tab.navForward[tab.navForward.length - 1];
  updateDoc(id, {
    navForward: tab.navForward.slice(0, -1),
    navBack: [...tab.navBack, tab.selection],
  });
  navigate(id, next, { record: false });
}

export function toggleRow(id: string, rowId: string, force?: boolean): void {
  updateDoc(id, (tab) => {
    const expanded = { ...tab.expanded };
    const open = force ?? !expanded[rowId];
    if (open) expanded[rowId] = true;
    else delete expanded[rowId];
    return { expanded };
  });
}

export function growChildLimit(id: string, rowId: string, by: number): void {
  updateDoc(id, (tab) => ({
    childLimits: { ...tab.childLimits, [rowId]: (tab.childLimits[rowId] ?? 200) + by },
  }));
}

export function collapseAll(id: string): void {
  updateDoc(id, { expanded: { root: true } });
}

export function setTreeMode(id: string, mode: TreeMode): void {
  updateDoc(id, (tab) => ({
    treeMode: mode,
    expanded: { ...tab.expanded, root: true },
    selectedRowId: mode === 'parts' ? rowIdForSelection(tab.selection) : '',
  }));
}

export function setDetailTab(id: string, detailTab: DetailTab): void {
  updateDoc(id, { detailTab });
}

/** Open a part in the source editor and scroll to a range. */
export function revealInSource(
  id: string,
  target: { part: string; line?: number; column?: number; offset?: number; length?: number },
): void {
  navigate(id, { part: target.part }, { detailTab: 'source', sidebar: false });
  updateDoc(id, { reveal: { ...target, token: revealToken++ } });
}

export function showSidebar(view: SidebarView): void {
  setState((s) => ({ ui: { ...s.ui, sidebarView: view, sidebarOpen: true } }));
}

export function toggleSidebar(): void {
  setState((s) => ({ ui: { ...s.ui, sidebarOpen: !s.ui.sidebarOpen } }));
}

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

export function undo(): void {
  const tab = activeDoc();
  if (!tab) return;
  const entry = tab.model.undo();
  if (!entry) return;
  const part = entry.changes[0]?.part;
  if (part && tab.model.has(part) && tab.selection.part !== part)
    navigate(tab.id, { part }, { record: false });
  toast('info', `Undid: ${entry.label}`);
}

export function redo(): void {
  const tab = activeDoc();
  if (!tab) return;
  const entry = tab.model.redo();
  if (!entry) return;
  const part = entry.changes[0]?.part;
  if (part && tab.model.has(part) && tab.selection.part !== part)
    navigate(tab.id, { part }, { record: false });
  toast('info', `Redid: ${entry.label}`);
}

export function formatPart(id: string, part: string, minify = false): void {
  const tab = docById(id);
  if (!tab) return;
  try {
    const text = tab.model.getText(part).text;
    tab.model.setText(part, minify ? minifyXml(text) : formatXml(text), {
      label: `${minify ? 'Minify' : 'Format'} ${part}`,
      coalesceKey: undefined,
    });
  } catch (e) {
    toastError('Cannot format: ', e);
  }
}

export function setPartText(id: string, part: string, text: string): void {
  docById(id)?.model.setText(part, text);
}

export function selectedElementPath(tab: DocTab): { xpath: string; name: string } | undefined {
  if (!tab.selection.part || !tab.selection.path) return undefined;
  const { doc } = tab.model.getXml(tab.selection.part);
  const el = doc && elementAtPath(doc, tab.selection.path);
  return el ? { xpath: xpathOf(el), name: el.name } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Part operations
// ---------------------------------------------------------------------------------------------

export async function exportPart(id: string, part: string): Promise<void> {
  const tab = docById(id);
  if (!tab) return;
  try {
    const r = await host.saveAs(baseName(part), tab.model.getBytes(part));
    if (r)
      toast(
        'success',
        host.kind === 'web' ? `Downloaded ${r.name}` : `Exported to ${r.path ?? r.name}`,
      );
  } catch (e) {
    toastError('Export failed: ', e);
  }
}

export async function replacePart(id: string, part: string): Promise<void> {
  const tab = docById(id);
  if (!tab) return;
  const [file] = await host.openFiles({
    title: `Replace ${baseName(part)} with…`,
    multiple: false,
    filters: [{ name: 'All files', extensions: ['*'] }],
  });
  if (!file) return;
  tab.model.setBytes(part, file.data, { label: `Replace ${part}` });
  toast('success', `Replaced ${part} (${file.data.length.toLocaleString()} bytes)`);
}

/** OPC part names are case-insensitive, so `Word/A.xml` clashes with `word/a.xml`. */
function partNameTaken(tab: DocTab, name: string): boolean {
  const lower = name.toLowerCase();
  return tab.model.names().some((n) => n.toLowerCase() === lower);
}

const CT_DEFAULTS: Record<string, string> = {
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bin: 'application/vnd.openxmlformats-officedocument.oleObject',
  txt: 'text/plain',
  json: 'application/json',
};

export async function addPartFromFile(id: string, folder = ''): Promise<void> {
  const tab = docById(id);
  if (!tab) return;
  const files = await host.openFiles({
    title: 'Add file as part…',
    multiple: false,
    filters: [{ name: 'All files', extensions: ['*'] }],
  });
  const file = files[0];
  if (!file) return;
  const name = await promptDialog({
    title: 'Add part',
    label: 'Part name (path inside the package)',
    value: folder + file.name,
    confirmLabel: 'Add',
    validate: (v) =>
      !v.trim()
        ? 'Enter a name.'
        : tab.model.has(v.trim().replace(/^\//, ''))
          ? 'A part with this name already exists.'
          : undefined,
  });
  if (!name) return;
  const partName = name.trim().replace(/^\//, '');
  tab.model.transaction(`Add ${partName}`, () => {
    tab.model.addPart(partName, file.data);
    ensureContentType(tab.model, partName);
  });
  navigate(id, { part: partName }, { sidebar: true });
}

/** Make sure `[Content_Types].xml` has an entry for the part (a `Default` for its extension). */
function ensureContentType(model: PackageModel, partName: string): void {
  const ctPart = '[Content_Types].xml';
  if (!model.has(ctPart)) return;
  const analysis = getAnalysis(model);
  if (contentTypeOf(analysis.contentTypes, partName)) return;
  const ext = extensionOf(partName);
  if (!ext) return;
  const type = CT_DEFAULTS[ext] ?? 'application/octet-stream';
  const { doc } = model.getXml(ctPart);
  if (!doc) return;
  const frag = `<Default Extension="${ext}" ContentType="${type}"/>`;
  const first = doc.root.elements[0];
  const text = first
    ? doc.source.slice(0, first.start) +
      frag +
      (doc.source.slice(doc.root.start, first.start).includes('\n') ? '\n  ' : '') +
      doc.source.slice(first.start)
    : doc.source.slice(0, doc.root.startTagEnd) + frag + doc.source.slice(doc.root.startTagEnd);
  model.setText(ctPart, text, { label: `Add content type for .${ext}`, coalesceKey: undefined });
}

export async function deletePart(id: string, part: string): Promise<void> {
  const tab = docById(id);
  if (!tab) return;
  const incoming = getAnalysis(tab.model).incoming.get(part)?.length ?? 0;
  const choice = await confirmDialog({
    title: `Delete “${baseName(part)}”?`,
    message:
      'The part is removed from the package. Relationships and content-type entries that reference it are left untouched' +
      (incoming
        ? ` (${incoming} relationship${incoming > 1 ? 's' : ''} point${incoming > 1 ? '' : 's'} to it).`
        : '.') +
      ' You can undo this.',
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Delete', value: 'delete', danger: true },
    ],
  });
  if (choice !== 'delete') return;
  tab.model.removePart(part);
  if (tab.selection.part === part) navigate(id, {}, { record: false });
}

export async function renamePart(id: string, part: string): Promise<void> {
  const tab = docById(id);
  if (!tab) return;
  const name = await promptDialog({
    title: 'Rename part',
    label: 'New part name. Relationships and content types that refer to this part are updated.',
    value: part,
    confirmLabel: 'Rename',
    validate: (v) => {
      const n = v.trim().replace(/^\//, '');
      return (
        partNameProblem(n) ??
        (n !== part && partNameTaken(tab, n) ? 'A part with this name already exists.' : undefined)
      );
    },
  });
  const next = name?.trim().replace(/^\//, '');
  if (!next || next === part) return;
  const analysis = getAnalysis(tab.model);
  tab.model.transaction(`Rename ${part}`, () => {
    tab.model.renamePart(part, next);
    // Fix relationship targets (`Target` is relative to the source part) and the content-type override.
    const byRels = new Map<string, Array<{ id: string; source: string }>>();
    for (const r of analysis.incoming.get(part) ?? []) {
      const list = byRels.get(r.relsPart) ?? [];
      list.push({ id: r.id, source: r.source });
      byRels.set(r.relsPart, list);
    }
    for (const [relsPart, items] of byRels) {
      const { doc } = tab.model.getXml(relsPart);
      if (!doc) continue;
      const edits = [];
      for (const it of items) {
        const el = doc.root.elements.find((e) =>
          e.attrs.some((a) => a.name === 'Id' && a.value === it.id),
        );
        const target = el?.attrs.find((a) => a.name === 'Target');
        if (!el || !target) continue;
        const value = encodePartUri(
          target.value.startsWith('/') ? '/' + next : relativeTarget(it.source, next),
        );
        edits.push({
          from: target.valueStart,
          to: target.valueEnd,
          insert: value.replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
        });
      }
      if (edits.length) {
        const sorted = edits.sort((a, b) => b.from - a.from);
        let text = doc.source;
        for (const e of sorted) text = text.slice(0, e.from) + e.insert + text.slice(e.to);
        tab.model.setText(relsPart, text, {
          label: `Update relationships in ${relsPart}`,
          coalesceKey: undefined,
        });
      }
    }
    const ct = tab.model.has('[Content_Types].xml')
      ? tab.model.getXml('[Content_Types].xml').doc
      : undefined;
    const ov = ct?.root.elements.find(
      (e) =>
        e.local === 'Override' &&
        e.attrs.some((a) => a.name === 'PartName' && a.value.replace(/^\//, '') === part),
    );
    const pn = ov?.attrs.find((a) => a.name === 'PartName');
    if (ct && pn) {
      tab.model.setText(
        '[Content_Types].xml',
        ct.source.slice(0, pn.valueStart) + '/' + next + ct.source.slice(pn.valueEnd),
        {
          label: 'Update content types',
          coalesceKey: undefined,
        },
      );
    }
  });
  navigate(id, { part: next }, { record: false });
}

// ---------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------

function bookmarkMatch(tab: DocTab, part: string, xpath?: string): Bookmark | undefined {
  return getState().bookmarks.find(
    (b) => b.fileKey === fileKey(tab) && b.part === part && b.xpath === xpath,
  );
}

export function currentBookmark(tab: DocTab): Bookmark | undefined {
  if (!tab.selection.part) return undefined;
  return bookmarkMatch(tab, tab.selection.part, selectedElementPath(tab)?.xpath);
}

export function toggleBookmark(tabId?: string, selection?: Selection): void {
  const tab = tabId ? docById(tabId) : activeDoc();
  if (!tab) return;
  const sel = selection ?? tab.selection;
  if (!sel.part) {
    toast('info', 'Select a part or element to bookmark it.');
    return;
  }
  let xpath: string | undefined;
  let label = baseName(sel.part);
  if (sel.path) {
    const { doc } = tab.model.getXml(sel.part);
    const el = doc && elementAtPath(doc, sel.path);
    if (el && doc) {
      xpath = xpathOf(el);
      label = `${el.name} — ${baseName(sel.part)}`;
    }
  }
  const existing = bookmarkMatch(tab, sel.part, xpath);
  if (existing) {
    setState((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== existing.id) }));
    toast('info', 'Bookmark removed');
    return;
  }
  const bookmark: Bookmark = {
    id: newId('bm'),
    fileKey: fileKey(tab),
    filePath: tab.path,
    fileName: tab.name,
    part: sel.part,
    xpath,
    label,
    createdAt: Date.now(),
  };
  setState((s) => ({ bookmarks: [bookmark, ...s.bookmarks] }));
  toast('success', 'Bookmarked');
}

export function removeBookmark(id: string): void {
  setState((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
}

export function updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'label' | 'note'>>): void {
  setState((s) => ({ bookmarks: s.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
}

export async function gotoBookmark(b: Bookmark): Promise<void> {
  let tab = getState().tabs.find((t): t is DocTab => t.kind === 'doc' && fileKey(t) === b.fileKey);
  if (!tab) {
    if (!b.filePath) {
      toast('error', `Open “${b.fileName}” first — it was not opened from a known location.`);
      return;
    }
    if (!(await openPath(b.filePath))) return;
    tab = getState().tabs.find((t): t is DocTab => t.kind === 'doc' && t.path === b.filePath);
    if (!tab) return;
  }
  if (!tab.model.has(b.part)) {
    toast('error', `“${b.part}” no longer exists in ${b.fileName}.`);
    return;
  }
  let path: number[] | undefined;
  if (b.xpath) {
    const { doc } = tab.model.getXml(b.part);
    const el = doc && resolveSimpleXPath(doc, b.xpath);
    if (el) path = elementPath(el);
    else
      toast('info', 'The bookmarked element has moved or was removed; showing the part instead.');
  }
  navigate(tab.id, { part: b.part, path }, { sidebar: false });
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

export function togglePin(key: string): void {
  setState((s) => ({
    history: s.history.map((h) => (h.key === key ? { ...h, pinned: !h.pinned } : h)),
  }));
}

export function removeHistory(key: string): void {
  setState((s) => ({ history: s.history.filter((h) => h.key !== key) }));
}

export function clearHistory(): void {
  setState((s) => ({ history: s.history.filter((h) => h.pinned) }));
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export async function runValidation(id: string): Promise<void> {
  const tab = docById(id);
  if (!tab) return;
  updateDoc(id, { problems: { ...tab.problems, status: 'running' } });
  try {
    const version = tab.model.version;
    const items = await validatePackage(tab.model);
    updateDoc(id, { problems: { status: 'done', items, atVersion: version } });
  } catch (e) {
    updateDoc(id, { problems: { status: 'idle', items: [], atVersion: -1 } });
    toastError('Check failed: ', e);
  }
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

export function startCompare(a: CompareSide, b: CompareSide): string {
  const { settings } = getState();
  const id = newId('cmp');
  const tab: CompareTab = {
    kind: 'compare',
    id,
    name: `${a.label} ⇄ ${b.label}`,
    a,
    b,
    options: {
      detectFormatting: settings.compareIgnoreFormatting,
      sortAttributes: settings.compareSortAttributes,
    },
    status: 'running',
    progress: 0,
    expanded: { root: true },
    filter: { added: true, removed: true, modified: true, formatting: true, unchanged: false },
    view: 'split',
    collapseUnchanged: true,
  };
  setState((s) => ({
    tabs: [...s.tabs, tab],
    activeId: id,
    ui: { ...s.ui, sidebarView: 'explorer', sidebarOpen: true },
  }));
  void runCompare(id);
  return id;
}

export async function runCompare(id: string): Promise<void> {
  const tab = getState().tabs.find((t): t is CompareTab => t.id === id && t.kind === 'compare');
  if (!tab) return;
  updateCompare(id, { status: 'running', progress: 0, error: undefined });
  try {
    const result = await comparePackages(tab.a.source, tab.b.source, tab.options, (done, total) =>
      updateCompare(id, { progress: done / Math.max(total, 1) }),
    );
    const first = result.parts.find((p) => p.status !== 'unchanged');
    const expanded: Record<string, true> = { root: true };
    for (const p of result.parts) {
      if (p.status === 'unchanged') continue;
      const segs = p.name.split('/');
      segs.pop();
      let acc = '';
      for (const s of segs) {
        acc += s + '/';
        expanded[folderRowId(acc)] = true;
      }
    }
    updateCompare(id, { status: 'done', result, progress: 1, selected: first?.name, expanded });
  } catch (e) {
    updateCompare(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export function setCompareFilter(id: string, status: DiffStatus, on: boolean): void {
  updateCompare(id, (t) => ({ filter: { ...t.filter, [status]: on } }));
}

export function toggleCompareRow(id: string, rowId: string): void {
  updateCompare(id, (t) => {
    const expanded = { ...t.expanded };
    if (expanded[rowId]) delete expanded[rowId];
    else expanded[rowId] = true;
    return { expanded };
  });
}

export function swapCompare(id: string): void {
  updateCompare(id, (t) => ({ a: t.b, b: t.a, name: `${t.b.label} ⇄ ${t.a.label}` }));
  void runCompare(id);
}

export async function compareWithFile(tabId?: string): Promise<void> {
  const tab = tabId ? docById(tabId) : activeDoc();
  if (!tab) {
    openDialog({ kind: 'compareSetup' });
    return;
  }
  openDialog({ kind: 'compareSetup', initialA: tab.id });
}

export function reviewChanges(tabId?: string): void {
  const tab = tabId ? docById(tabId) : activeDoc();
  if (!tab) return;
  if (!tab.model.isDirty()) {
    toast('info', 'There are no unsaved changes.');
    return;
  }
  startCompare(
    { label: `${tab.name} (saved)`, source: tab.model.originalView() },
    { label: `${tab.name} (edited)`, source: tab.model },
  );
}

export async function openCompareSource(file: OpenedFile): Promise<CompareSide | undefined> {
  try {
    const model = PackageModel.open(file.data, file.name);
    return {
      label: file.name,
      source: model as PartSource,
      family: getAnalysis(model).type.family,
    };
  } catch (e) {
    toastError(`${file.name}: `, e);
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Settings & commands
// ---------------------------------------------------------------------------------------------

export function updateSettings(patch: Partial<Settings>): void {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
}

export function toggleTheme(): void {
  const { theme } = getState().settings;
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  updateSettings({ theme: dark ? 'light' : 'dark' });
}

export function findInPart(): void {
  window.dispatchEvent(new CustomEvent('ooxml:find'));
}

export function dispatchCommand(command: string, arg?: string): void {
  const tab = activeTab();
  const doc = activeDoc();
  switch (command) {
    case COMMANDS.open.id:
      void openFilesFromDialog();
      break;
    case 'file.openRecent':
      if (arg) void openPath(arg);
      break;
    case COMMANDS.save.id:
      if (doc) void saveTab(doc.id);
      break;
    case COMMANDS.saveAs.id:
      if (doc) void saveTabAs(doc.id);
      break;
    case COMMANDS.close.id:
      if (tab) void closeTab(tab.id);
      break;
    case COMMANDS.compare.id:
      void compareWithFile();
      break;
    case COMMANDS.compareDisk.id:
      reviewChanges();
      break;
    case COMMANDS.reveal.id:
      if (doc?.path) void host.revealInFolder(doc.path);
      break;
    case COMMANDS.undo.id: {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        document.execCommand('undo');
      else undo();
      break;
    }
    case COMMANDS.redo.id: {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        document.execCommand('redo');
      else redo();
      break;
    }
    case COMMANDS.find.id:
      findInPart();
      break;
    case COMMANDS.searchAll.id:
      showSidebar('search');
      setTimeout(() => window.dispatchEvent(new CustomEvent('ooxml:focus-search')), 30);
      break;
    case COMMANDS.quickOpen.id:
      if (doc) setState((s) => ({ ui: { ...s.ui, quickOpen: true } }));
      break;
    case COMMANDS.explorer.id:
      showSidebar('explorer');
      break;
    case COMMANDS.bookmarks.id:
      showSidebar('bookmarks');
      break;
    case COMMANDS.history.id:
      showSidebar('history');
      break;
    case COMMANDS.problems.id:
      showSidebar('problems');
      if (doc && doc.problems.status === 'idle') void runValidation(doc.id);
      break;
    case COMMANDS.toggleSidebar.id:
      toggleSidebar();
      break;
    case COMMANDS.toggleTheme.id:
      toggleTheme();
      break;
    case COMMANDS.toggleBookmark.id:
      toggleBookmark();
      break;
    case COMMANDS.navBack.id:
      if (doc) navBack(doc.id);
      break;
    case COMMANDS.navForward.id:
      if (doc) navForward(doc.id);
      break;
    case COMMANDS.nextTab.id:
      cycleTab(1);
      break;
    case COMMANDS.prevTab.id:
      cycleTab(-1);
      break;
    case COMMANDS.formatXml.id:
      if (doc?.selection.part) formatPart(doc.id, doc.selection.part);
      break;
    case COMMANDS.settings.id:
      openDialog({ kind: 'settings' });
      break;
  }
}
