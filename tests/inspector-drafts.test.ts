/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDocx } from './fixtures/builders';
import {
  openFile,
  saveTab,
  saveTabAs,
  closeTab,
  requestWindowClose,
  selectTab,
  navigate,
  setDetailTab,
  dispatchCommand,
  isDirty,
} from '../src/renderer/src/store/actions';
import { getState, setState, useApp } from '../src/renderer/src/store/app';
import {
  clearInspectorDraft,
  setInspectorDraft,
  useInspectorDraft,
} from '../src/renderer/src/store/inspectorDraft';
import { PackageModel } from '../src/core/package/model';

const host = vi.hoisted(() => ({
  kind: 'electron',
  os: 'darwin',
  writeFile: vi.fn(),
  saveAs: vi.fn(),
  forceClose: vi.fn(),
}));
vi.mock('../src/renderer/src/host', () => ({ host }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  setState(useApp.getInitialState(), true);
  useInspectorDraft.setState({ pending: null });
});
afterEach(() => vi.useRealTimers());

const PART = 'word/document.xml';
const HEADING_TEXT = [0, 0, 1, 0]; // w:document / w:body / first w:p / w:r / w:t

/** Type `value` into the Inspector's text field of the heading, without committing it. */
function type(id: string, value: string, part = PART): void {
  setInspectorDraft({ tabId: id, part, path: HEADING_TEXT, attr: null, value, label: 'Edit text' });
}

function draftDocument(value = 'draft heading') {
  const id = openFile({ name: 'test.docx', path: '/test.docx', data: buildDocx() })!;
  const tab = getState().tabs.find((t) => t.id === id)!;
  if (tab.kind !== 'doc') throw new Error('Expected a document');
  type(id, value);
  return { id, tab, model: tab.model };
}

describe('Inspector draft commands', () => {
  it('saves pending input from a previously clean document', async () => {
    const { id, model } = draftDocument();
    expect(model.isDirty()).toBe(false);
    host.writeFile.mockResolvedValue(undefined);
    expect(await saveTab(id)).toBe(true);
    const saved = PackageModel.open(host.writeFile.mock.calls[0][1]);
    expect(saved.getText(PART).text).toContain('<w:t>draft heading</w:t>');
    expect(useInspectorDraft.getState().pending).toBeNull();
  });

  it('includes pending input in Save As', async () => {
    const { id } = draftDocument();
    host.saveAs.mockResolvedValue({ name: 'copy.docx', path: '/copy.docx' });
    expect(await saveTabAs(id)).toBe(true);
    const saved = PackageModel.open(host.saveAs.mock.calls[0][1]);
    expect(saved.getText(PART).text).toContain('<w:t>draft heading</w:t>');
  });

  it('prompts instead of closing a clean model with a pending draft', async () => {
    const { id, model } = draftDocument();
    const closing = closeTab(id);
    const dialog = getState().dialog;
    expect(dialog?.kind).toBe('confirm');
    if (dialog?.kind !== 'confirm') throw new Error('Expected confirmation');
    dialog.resolve('cancel');
    expect(await closing).toBe(false);
    expect(model.isDirty()).toBe(true);
    expect(getState().tabs).toHaveLength(1);
  });

  it('prompts on native window close before calling forceClose', async () => {
    draftDocument();
    const closing = requestWindowClose();
    const dialog = getState().dialog;
    expect(host.forceClose).not.toHaveBeenCalled();
    if (dialog?.kind !== 'confirm') throw new Error('Expected confirmation');
    dialog.resolve('cancel');
    await closing;
    expect(host.forceClose).not.toHaveBeenCalled();
  });

  it('keeps the tab open if another Inspector draft appears during save-on-close', async () => {
    const { id, model } = draftDocument();
    let finish!: () => void;
    host.writeFile.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const closing = closeTab(id);
    const dialog = getState().dialog;
    if (dialog?.kind !== 'confirm') throw new Error('Expected confirmation');
    dialog.resolve('save');
    await vi.waitFor(() => expect(host.writeFile).toHaveBeenCalledOnce());
    type(id, 'later');
    finish();
    expect(await closing).toBe(false);
    expect(getState().tabs).toHaveLength(1);
    expect(model.getText(PART).text).toContain('<w:t>later</w:t>');
    expect(model.isDirty()).toBe(true);
  });

  it('does not commit another document when saving a background tab', async () => {
    const background = openFile({ name: 'other.docx', path: '/other.docx', data: buildDocx() })!;
    const { id, model } = draftDocument();
    expect(await saveTab(background)).toBe(true);
    expect(model.isDirty()).toBe(false);
    expect(useInspectorDraft.getState().pending?.tabId).toBe(id);
    selectTab(background);
    expect(model.isDirty()).toBe(true);
    expect(useInspectorDraft.getState().pending).toBeNull();
  });
});

describe('Inspector draft bookkeeping', () => {
  it('counts a pending draft as unsaved changes until it is cleared', () => {
    const { id, tab } = draftDocument();
    expect(isDirty(tab)).toBe(true);
    clearInspectorDraft(id, null);
    expect(isDirty(tab)).toBe(false);
  });

  it('commits when the selection or the detail tab changes', () => {
    const { id, model } = draftDocument();
    navigate(id, { part: 'word/styles.xml' });
    expect(model.getText(PART).text).toContain('<w:t>draft heading</w:t>');
    expect(useInspectorDraft.getState().pending).toBeNull();

    type(id, 'second draft');
    setDetailTab(id, 'source');
    expect(model.getText(PART).text).toContain('<w:t>second draft</w:t>');
    expect(useInspectorDraft.getState().pending).toBeNull();
  });

  it('commits before a menu command reads the document', async () => {
    const { id, model } = draftDocument();
    host.writeFile.mockResolvedValue(undefined);
    dispatchCommand('file.save');
    await vi.waitFor(() => expect(host.writeFile).toHaveBeenCalledOnce());
    expect(PackageModel.open(host.writeFile.mock.calls[0][1]).getText(PART).text).toContain(
      '<w:t>draft heading</w:t>',
    );
    expect(model.isDirty()).toBe(false);
    expect(useInspectorDraft.getState().pending?.tabId).toBeUndefined();

    type(id, 'review me');
    dispatchCommand('file.compareChanges');
    expect(getState().toasts.map((t) => t.text)).not.toContain('There are no unsaved changes.');
    expect(model.isDirty()).toBe(true);
  });

  it('leaves the draft to the field for undo, redo and find', () => {
    const { id } = draftDocument();
    // The commands look at the DOM (focused field, find box); the test environment has none.
    vi.stubGlobal('document', { activeElement: null, execCommand: vi.fn() });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    try {
      for (const command of ['edit.undo', 'edit.redo', 'edit.find']) dispatchCommand(command);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(useInspectorDraft.getState().pending?.tabId).toBe(id);
  });

  it('reports a draft that cannot be applied instead of failing the command', async () => {
    const { id } = draftDocument();
    type(id, 'lost', 'word/missing.xml');
    await expect(saveTab(id)).resolves.toBe(true);
    expect(
      getState()
        .toasts.map((t) => t.text)
        .join('\n'),
    ).toMatch(/Could not apply the edit/);
    expect(useInspectorDraft.getState().pending).toBeNull();
  });
});
