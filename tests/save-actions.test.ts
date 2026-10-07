/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDocx, buildOdp } from './fixtures/builders';
import { openFile, saveTab, saveTabAs } from '../src/renderer/src/store/actions';
import { getState, setState, useApp } from '../src/renderer/src/store/app';
import { PackageModel } from '../src/core/package/model';
import { checkOdfPackage } from '../src/core/package/odf';
import { ZipArchive } from '../src/core/zip/zip';

const host = vi.hoisted(() => ({
  kind: 'electron',
  os: 'darwin',
  writeFile: vi.fn(),
  saveAs: vi.fn(),
}));
vi.mock('../src/renderer/src/host', () => ({ host }));

function editedDocument() {
  const id = openFile({ name: 'test.docx', path: '/test.docx', data: buildDocx() })!;
  const tab = getState().tabs.find((t) => t.id === id)!;
  if (tab.kind !== 'doc') throw new Error('Expected a document');
  const part = 'word/document.xml';
  const original = tab.model.getText(part).text;
  tab.model.setText(part, original + '<!--saved-->');
  return { id, model: tab.model, part, original };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  setState(useApp.getInitialState(), true);
});
afterEach(() => vi.useRealTimers());

describe('asynchronous saves', () => {
  it('keeps typing during a write dirty and preserves undo/redo', async () => {
    const { id, model, part, original } = editedDocument();
    let finish!: () => void;
    host.writeFile.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const saving = saveTab(id);
    await Promise.resolve();
    expect(host.writeFile).toHaveBeenCalledOnce();
    model.setText(part, original + '<!--newer-->');
    finish();
    expect(await saving).toBe(false); // Close must not discard the remaining edits.
    expect(model.getText(part).text).toBe(original + '<!--newer-->');
    expect(model.isDirty()).toBe(true);
    const disk = PackageModel.open(host.writeFile.mock.calls[0][1]);
    expect(disk.getText(part).text).toBe(original + '<!--saved-->');
    model.undo();
    expect(model.getText(part).text).toBe(original);
    model.redo();
    expect(model.getText(part).text).toBe(original + '<!--newer-->');
  });

  it('preserves a pending Save As edit and updates the destination', async () => {
    const { id, model, part, original } = editedDocument();
    let finish!: (result: { name: string; path: string }) => void;
    host.saveAs.mockImplementation(() => new Promise((r) => (finish = r)));
    const saving = saveTabAs(id);
    await Promise.resolve();
    model.setText(part, original + '<!--newer-->');
    finish({ name: 'copy.docx', path: '/copy.docx' });
    expect(await saving).toBe(false);
    expect(model.getText(part).text).toBe(original + '<!--newer-->');
    expect(getState().tabs[0]).toMatchObject({ path: '/copy.docx', name: 'copy.docx' });
  });

  it('preserves undo and part changes made after the snapshot', () => {
    const { model, part, original } = editedDocument();
    model.addPart('new.txt', 'saved');
    const version = model.version;
    const bytes = model.serialize();
    model.undo(); // Remove the part already present in the saved snapshot.
    model.undo(); // Restore original XML while the write is pending.
    model.addPart('later.txt', 'pending');
    model.removePart('word/styles.xml');
    model.rebase(bytes, version);
    expect(model.getText(part).text).toBe(original);
    expect(model.has('new.txt')).toBe(false);
    expect(model.getText('later.txt').text).toBe('pending');
    expect(model.has('word/styles.xml')).toBe(false);
    expect(model.isDirty()).toBe(true);
    const restored = PackageModel.open(model.serialize());
    expect(restored.names()).toEqual(model.names());
  });

  it('keeps a part restored during the write in its original position', () => {
    const model = PackageModel.open(buildOdp());
    const order = model.entryOrder();
    model.removePart('mimetype');
    model.removePart('content.xml');
    const version = model.version;
    const bytes = model.serialize(); // the file being written has neither part
    model.undo(); // content.xml is back...
    model.undo(); // ...and so is mimetype, before the write completes
    model.rebase(bytes, version);
    expect(model.isDirty()).toBe(true); // the file on disk still lacks both
    expect(model.entryOrder()).toEqual(order);
    expect(model.names()).toEqual(PackageModel.open(model.serialize()).names());
    expect(ZipArchive.open(model.serialize()).entries[0].name).toBe('mimetype');
    expect(checkOdfPackage(model).map((p) => p.code)).not.toContain('odf-mimetype-order');
  });

  it('keeps restored parts in order when one of them is removed again', () => {
    const model = PackageModel.open(buildOdp());
    const order = model.entryOrder();
    const [first, second, third] = order;
    for (const name of [first, second, third]) model.removePart(name);
    const version = model.version;
    const bytes = model.serialize();
    for (let i = 0; i < 3; i++) model.undo();
    model.rebase(bytes, version);
    expect(model.entryOrder()).toEqual(order);
    model.removePart(second); // `third` was anchored to it
    expect(model.entryOrder()).toEqual(order.filter((n) => n !== second));
  });

  it('marks an unchanged successful save clean', async () => {
    const { id, model } = editedDocument();
    host.writeFile.mockResolvedValue(undefined);
    expect(await saveTab(id)).toBe(true);
    expect(model.isDirty()).toBe(false);
  });
});
