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
} from '../src/renderer/src/store/actions';
import { getState, setState, useApp } from '../src/renderer/src/store/app';
import { setInspectorDraft, useInspectorDraft } from '../src/renderer/src/store/inspectorDraft';
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

function draftDocument() {
  const id = openFile({ name: 'test.docx', path: '/test.docx', data: buildDocx() })!;
  const tab = getState().tabs.find((t) => t.id === id)!;
  if (tab.kind !== 'doc') throw new Error('Expected a document');
  const part = 'word/document.xml';
  const edited = tab.model.getText(part).text + '<!--draft-->';
  setInspectorDraft(id, 'text', () => tab.model.setText(part, edited));
  return { id, model: tab.model, part, edited };
}

describe('Inspector draft commands', () => {
  it('saves pending input from a previously clean document', async () => {
    const { id, model, part, edited } = draftDocument();
    expect(model.isDirty()).toBe(false);
    host.writeFile.mockResolvedValue(undefined);
    expect(await saveTab(id)).toBe(true);
    const saved = PackageModel.open(host.writeFile.mock.calls[0][1]);
    expect(saved.getText(part).text).toBe(edited);
    expect(useInspectorDraft.getState().pending).toBeNull();
  });

  it('includes pending input in Save As', async () => {
    const { id, part, edited } = draftDocument();
    host.saveAs.mockResolvedValue({ name: 'copy.docx', path: '/copy.docx' });
    expect(await saveTabAs(id)).toBe(true);
    expect(PackageModel.open(host.saveAs.mock.calls[0][1]).getText(part).text).toBe(edited);
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
    const { id, model, part, edited } = draftDocument();
    let finish!: () => void;
    host.writeFile.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const closing = closeTab(id);
    const dialog = getState().dialog;
    if (dialog?.kind !== 'confirm') throw new Error('Expected confirmation');
    dialog.resolve('save');
    await Promise.resolve();
    await Promise.resolve();
    expect(host.writeFile).toHaveBeenCalledOnce();
    setInspectorDraft(id, 'text', () => model.setText(part, edited + '<!--later-->'));
    finish();
    expect(await closing).toBe(false);
    expect(getState().tabs).toHaveLength(1);
    expect(model.getText(part).text).toBe(edited + '<!--later-->');
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
