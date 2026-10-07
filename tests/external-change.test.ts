/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDocx } from './fixtures/builders';
import {
  dismissExternalChange,
  noteDiskChanges,
  openFile,
  reloadTab,
  saveTab,
} from '../src/renderer/src/store/actions';
import { getState, setState, useApp } from '../src/renderer/src/store/app';
import { setInspectorDraft } from '../src/renderer/src/store/inspectorDraft';
import type { DocTab } from '../src/renderer/src/store/types';
import { PackageModel } from '../src/core/package/model';

const host = vi.hoisted(() => ({
  kind: 'electron',
  os: 'darwin',
  statFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  saveAs: vi.fn(),
}));
vi.mock('../src/renderer/src/host', () => ({ host }));

const PATH = '/deck.docx';
const PART = 'word/document.xml';
const stamp = (n: number) => ({ mtimeMs: n, size: 1000 + n });

const doc = (id: string): DocTab => {
  const t = getState().tabs.find((x) => x.id === id);
  if (t?.kind !== 'doc') throw new Error('Expected a document');
  return t;
};
const openDoc = (data = buildDocx()) =>
  openFile({ name: 'deck.docx', path: PATH, data, stamp: stamp(1) })!;
const answer = async (value: string) => {
  await vi.waitFor(() => expect(getState().dialog?.kind).toBe('confirm'));
  const d = getState().dialog;
  if (d?.kind !== 'confirm') throw new Error('Expected a confirm dialog');
  d.resolve(value);
};

beforeEach(() => {
  vi.resetAllMocks();
  setState(useApp.getInitialState(), true);
});
afterEach(() => vi.useRealTimers());

describe('noticing that another program changed the file', () => {
  it('flags the document only when the stamp differs from the one it was read from', () => {
    const id = openDoc();
    noteDiskChanges([{ path: PATH, stamp: stamp(1) }]); // the report that follows every open
    expect(doc(id).externalChange).toBeUndefined();
    noteDiskChanges([{ path: '/other.docx', stamp: stamp(9) }]);
    expect(doc(id).externalChange).toBeUndefined();
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    expect(doc(id).externalChange).toEqual({ dismissed: false });
  });

  it('adopts the first stamp of a document that was opened without one', () => {
    const id = openFile({ name: 'deck.docx', path: PATH, data: buildDocx() })!;
    noteDiskChanges([{ path: PATH, stamp: stamp(1) }]);
    expect(doc(id).diskStamp).toEqual(stamp(1));
    expect(doc(id).externalChange).toBeUndefined();
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    expect(doc(id).externalChange).toBeDefined();
  });

  it('shows the warning again when the file changes after it was dismissed', () => {
    const id = openDoc();
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    dismissExternalChange(id);
    expect(doc(id).externalChange).toEqual({ dismissed: true });
    noteDiskChanges([{ path: PATH, stamp: stamp(3) }]);
    expect(doc(id).externalChange).toEqual({ dismissed: false });
  });
});

describe('saving over a changed file', () => {
  const edit = (id: string) => {
    const { model } = doc(id);
    model.setText(PART, model.getText(PART).text + '<!--edit-->');
  };

  it('asks first, and writes nothing when the user cancels', async () => {
    const id = openDoc();
    edit(id);
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    const saving = saveTab(id);
    await answer('cancel');
    expect(await saving).toBe(false);
    expect(host.writeFile).not.toHaveBeenCalled();
    expect(doc(id).externalChange).toBeDefined();
  });

  it('overwrites on request and then trusts the file again', async () => {
    const id = openDoc();
    edit(id);
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    host.writeFile.mockResolvedValue(stamp(3));
    const saving = saveTab(id);
    await answer('save');
    expect(await saving).toBe(true);
    expect(doc(id)).toMatchObject({ diskStamp: stamp(3), externalChange: undefined });
    noteDiskChanges([{ path: PATH, stamp: stamp(3) }]); // the app's own write, seen by the host
    expect(doc(id).externalChange).toBeUndefined();
  });

  it('does not ask when the file is as it was read', async () => {
    const id = openDoc();
    edit(id);
    host.writeFile.mockResolvedValue(stamp(2));
    expect(await saveTab(id)).toBe(true);
    expect(getState().dialog).toBeNull();
    expect(doc(id).diskStamp).toEqual(stamp(2));
  });
});

describe('reloading', () => {
  const changedFile = () => {
    const base = PackageModel.open(buildDocx());
    base.setText(PART, base.getText(PART).text + '<!--from PowerPoint-->');
    return base.serialize();
  };

  it('replaces the model, keeps the selection and clears the warning', async () => {
    const id = openDoc();
    const first = doc(id);
    setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === 'doc'
          ? {
              ...t,
              selection: { part: PART },
              selectedRowId: 'part:' + PART,
              problems: { status: 'done', items: [], atVersion: 0 },
            }
          : t,
      ),
    }));
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    host.statFile.mockResolvedValue(stamp(2));
    host.readFile.mockResolvedValue(changedFile());

    expect(await reloadTab(id)).toBe(true);

    const tab = doc(id);
    expect(tab.model).not.toBe(first.model);
    expect(tab.model.getText(PART).text).toContain('from PowerPoint');
    expect(tab).toMatchObject({
      selection: { part: PART },
      diskStamp: stamp(2),
      externalChange: undefined,
      reloads: 1,
      problems: { status: 'idle' },
    });
    expect(host.statFile.mock.invocationCallOrder[0]).toBeLessThan(
      host.readFile.mock.invocationCallOrder[0],
    );
  });

  it('falls back to what still exists when the selection is gone', async () => {
    const id = openDoc();
    setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === 'doc'
          ? { ...t, selection: { part: 'word/styles.xml' }, selectedRowId: 'part:word/styles.xml' }
          : t,
      ),
    }));
    const smaller = PackageModel.open(buildDocx());
    smaller.removePart('word/styles.xml');
    host.statFile.mockResolvedValue(stamp(2));
    host.readFile.mockResolvedValue(smaller.serialize());
    expect(await reloadTab(id)).toBe(true);
    expect(doc(id)).toMatchObject({ selection: {}, selectedRowId: 'root' });
  });

  it('asks before discarding unsaved changes, and keeps them on cancel', async () => {
    const id = openDoc();
    const { model } = doc(id);
    model.setText(PART, model.getText(PART).text + '<!--mine-->');
    const reloading = reloadTab(id);
    await answer('cancel');
    expect(await reloading).toBe(false);
    expect(host.readFile).not.toHaveBeenCalled();
    expect(doc(id).model).toBe(model);
    expect(model.isDirty()).toBe(true);
  });

  it('discards unsaved changes and the pending Inspector input when confirmed', async () => {
    const id = openDoc();
    doc(id).model.setText(PART, '<x/>');
    setInspectorDraft({ tabId: id, part: PART, path: [0], attr: null, value: 'typed', label: 'x' });
    host.statFile.mockResolvedValue(stamp(2));
    host.readFile.mockResolvedValue(changedFile());
    const reloading = reloadTab(id);
    // Starting a reload commits the draft, so the document is dirty either way.
    await answer('reload');
    expect(await reloading).toBe(true);
    expect(doc(id).model.isDirty()).toBe(false);
    expect(doc(id).model.getText(PART).text).toContain('from PowerPoint');
  });

  it('leaves the document alone when the file cannot be read', async () => {
    const id = openDoc();
    noteDiskChanges([{ path: PATH, stamp: stamp(2) }]);
    const model = doc(id).model;
    host.statFile.mockResolvedValue(stamp(2));
    host.readFile.mockResolvedValue(new Uint8Array([1, 2, 3])); // Office is mid-save: not a ZIP yet
    expect(await reloadTab(id)).toBe(false);
    expect(doc(id).model).toBe(model);
    expect(doc(id).externalChange).toBeDefined();
    expect(getState().toasts.at(-1)?.kind).toBe('error');
  });

  it('has nothing to reload for a document that did not come from a file', async () => {
    const id = openFile({ name: 'embedded.docx', data: buildDocx() })!;
    expect(await reloadTab(id)).toBe(false);
    expect(host.readFile).not.toHaveBeenCalled();
  });
});
