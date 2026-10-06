import { useMemo, useState } from 'react';
import { FolderOpen, GitCompare } from 'lucide-react';
import { checkFragment } from '@core/xml/edit';
import type { OpenedFile } from '@shared/api';
import { host } from '../host';
import { useApp } from '../store/app';
import { clearHistory, openCompareSource, startCompare, updateSettings } from '../store/actions';
import { closeDialog, toast, toastError } from '../store/ui';
import { setState } from '../store/app';
import type { CompareSide, DialogState, DocTab } from '../store/types';
import { Modal } from './common/Modal';

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'confirm':
      return <ConfirmDialog dialog={dialog} />;
    case 'prompt':
      return <PromptDialog dialog={dialog} />;
    case 'insertXml':
      return <InsertXmlDialog dialog={dialog} />;
    case 'compareSetup':
      return <CompareSetupDialog initialA={dialog.initialA} />;
    case 'settings':
      return <SettingsDialog />;
  }
}

type Of<K extends DialogState['kind']> = Extract<DialogState, { kind: K }>;

function ConfirmDialog({ dialog }: { dialog: Of<'confirm'> }) {
  const cancel = dialog.buttons.find((b) => b.value === 'cancel')?.value ?? 'cancel';
  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve(cancel)}
      footer={dialog.buttons.map((b) => (
        <button
          key={b.value}
          className={`btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`}
          data-autofocus={b.primary ? '' : undefined}
          onClick={() => dialog.resolve(b.value)}
        >
          {b.label}
        </button>
      ))}
    >
      <p>{dialog.message}</p>
      {dialog.detail && (
        <ul className="detail-list mono">
          {dialog.detail.slice(0, 12).map((d) => (
            <li key={d}>{d}</li>
          ))}
          {dialog.detail.length > 12 && <li>…and {dialog.detail.length - 12} more</li>}
        </ul>
      )}
    </Modal>
  );
}

function PromptDialog({ dialog }: { dialog: Of<'prompt'> }) {
  const [value, setValue] = useState(dialog.value);
  const error = dialog.validate?.(value);
  const submit = (): void => {
    if (!error) dialog.resolve(value);
  };
  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve(undefined)}
      footer={
        <>
          <button className="btn" onClick={() => dialog.resolve(undefined)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!!error} onClick={submit}>
            {dialog.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{dialog.label}</span>
        {dialog.multiline ? (
          <textarea
            className="input"
            data-autofocus
            rows={4}
            value={value}
            placeholder={dialog.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input
            className="input mono"
            data-autofocus
            value={value}
            placeholder={dialog.placeholder}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
      </label>
      {error && value !== dialog.value && <p className="field-error">{error}</p>}
    </Modal>
  );
}

const POSITIONS: Array<{ id: 'lastChild' | 'firstChild' | 'before' | 'after'; label: string }> = [
  { id: 'lastChild', label: 'Inside, as last child' },
  { id: 'firstChild', label: 'Inside, as first child' },
  { id: 'before', label: 'Before' },
  { id: 'after', label: 'After' },
];

function InsertXmlDialog({ dialog }: { dialog: Of<'insertXml'> }) {
  const [xml, setXml] = useState('');
  const [position, setPosition] = useState<(typeof POSITIONS)[number]['id']>('lastChild');
  const check = useMemo(() => (xml.trim() ? checkFragment(xml) : undefined), [xml]);
  return (
    <Modal
      title={`Insert XML relative to <${dialog.target}>`}
      width={560}
      onClose={() => dialog.resolve(undefined)}
      footer={
        <>
          <button className="btn" onClick={() => dialog.resolve(undefined)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!check?.ok}
            onClick={() => dialog.resolve({ xml, position })}
          >
            Insert
          </button>
        </>
      }
    >
      <div className="radio-row">
        {POSITIONS.map((p) => (
          <label key={p.id} className="check">
            <input
              type="radio"
              name="pos"
              checked={position === p.id}
              onChange={() => setPosition(p.id)}
            />{' '}
            {p.label}
          </label>
        ))}
      </div>
      <label className="field">
        <span>One XML element. Use the namespace prefixes already declared in the document.</span>
        <textarea
          className="input mono"
          data-autofocus
          rows={8}
          value={xml}
          spellCheck={false}
          placeholder={'<w:p><w:r><w:t>New</w:t></w:r></w:p>'}
          onChange={(e) => setXml(e.target.value)}
        />
      </label>
      {check && !check.ok && <p className="field-error">{check.error}</p>}
      {check?.ok && <p className="muted small">Looks good.</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Compare setup
// ---------------------------------------------------------------------------------------------

type Pick =
  | { kind: 'tab'; id: string }
  | { kind: 'history'; key: string }
  | { kind: 'file'; file: OpenedFile }
  | undefined;

function SidePicker({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: Pick;
  onChange: (p: Pick) => void;
}) {
  // Select stable references and derive: a selector that allocates would re-render forever (zustand v5).
  const allTabs = useApp((s) => s.tabs);
  const allHistory = useApp((s) => s.history);
  const tabs = useMemo(() => allTabs.filter((t): t is DocTab => t.kind === 'doc'), [allTabs]);
  const history = useMemo(() => allHistory.filter((h) => h.path), [allHistory]);
  const encoded = !value
    ? ''
    : value.kind === 'tab'
      ? `tab:${value.id}`
      : value.kind === 'history'
        ? `hist:${value.key}`
        : 'file';

  const browse = async (): Promise<void> => {
    const [file] = await host.openFiles({ multiple: false, title: `Choose ${title}` });
    if (file) onChange({ kind: 'file', file });
  };

  return (
    <div className="side-picker">
      <h4>{title}</h4>
      <p className="muted small">{hint}</p>
      <select
        className="input"
        value={encoded}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith('tab:')) onChange({ kind: 'tab', id: v.slice(4) });
          else if (v.startsWith('hist:')) onChange({ kind: 'history', key: v.slice(5) });
          else if (!v) onChange(undefined);
        }}
        aria-label={title}
      >
        <option value="">Select…</option>
        {value?.kind === 'file' && <option value="file">{value.file.name} (chosen file)</option>}
        {tabs.length > 0 && (
          <optgroup label="Open documents">
            {tabs.map((t) => (
              <option key={t.id} value={`tab:${t.id}`}>
                {t.name}
                {t.model.isDirty() ? ' (with unsaved changes)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {history.length > 0 && (
          <optgroup label="Recent files">
            {history.slice(0, 20).map((h) => (
              <option key={h.key} value={`hist:${h.key}`}>
                {h.name} — {h.path}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button className="btn" onClick={() => void browse()}>
        <FolderOpen size={14} /> Browse…
      </button>
    </div>
  );
}

async function resolveSide(pick: Pick): Promise<CompareSide | undefined> {
  const state = useApp.getState();
  if (!pick) return undefined;
  if (pick.kind === 'tab') {
    const t = state.tabs.find((x) => x.id === pick.id);
    return t?.kind === 'doc' ? { label: t.name, source: t.model } : undefined;
  }
  if (pick.kind === 'file') return openCompareSource(pick.file);
  const h = state.history.find((x) => x.key === pick.key);
  if (!h?.path) return undefined;
  const data = await host.readFile(h.path);
  return openCompareSource({ path: h.path, name: h.name, data });
}

function CompareSetupDialog({ initialA }: { initialA?: string }) {
  const active = useApp((s) =>
    s.tabs.find((t) => t.id === s.activeId)?.kind === 'doc' ? s.activeId : null,
  );
  const [a, setA] = useState<Pick>(() =>
    (initialA ?? active) ? { kind: 'tab', id: (initialA ?? active)! } : undefined,
  );
  const [b, setB] = useState<Pick>();
  const [busy, setBusy] = useState(false);
  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      const [sa, sb] = await Promise.all([resolveSide(a), resolveSide(b)]);
      if (!sa || !sb) {
        toast('error', 'Could not load both files.');
        return;
      }
      closeDialog();
      startCompare(sa, sb);
    } catch (e) {
      toastError('Could not start the comparison: ', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Compare two files"
      width={680}
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn primary" disabled={!a || !b || busy} onClick={() => void go()}>
            <GitCompare size={14} /> {busy ? 'Loading…' : 'Compare'}
          </button>
        </>
      }
    >
      <div className="compare-setup">
        <SidePicker title="A — original" hint="The base version." value={a} onChange={setA} />
        <SidePicker
          title="B — changed"
          hint="The version to compare against A."
          value={b}
          onChange={setB}
        />
      </div>
      <p className="muted small">
        Differences are shown part by part. Unsaved edits of open documents are included. Parts that
        only differ in whitespace are flagged as “formatting only”.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

function SettingsDialog() {
  const settings = useApp((s) => s.settings);
  const bookmarkCount = useApp((s) => s.bookmarks.length);
  const historyCount = useApp((s) => s.history.length);
  return (
    <Modal
      title="Settings"
      width={520}
      onClose={closeDialog}
      footer={
        <button className="btn primary" onClick={closeDialog}>
          Done
        </button>
      }
    >
      <div className="settings">
        <label className="field row">
          <span>Theme</span>
          <select
            className="input"
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.target.value as typeof settings.theme })}
          >
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="field row">
          <span>Editor font size</span>
          <input
            className="input narrow"
            type="number"
            min={9}
            max={28}
            value={settings.editorFontSize}
            onChange={(e) =>
              updateSettings({
                editorFontSize: Math.max(9, Math.min(28, Number(e.target.value) || 13)),
              })
            }
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.wrapLines}
            onChange={(e) => updateSettings({ wrapLines: e.target.checked })}
          />{' '}
          Wrap long lines in the source editor
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.prettyPrint}
            onChange={(e) => updateSettings({ prettyPrint: e.target.checked })}
          />{' '}
          Show XML parts re-indented (the file only changes when you edit)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.backupOnSave}
            onChange={(e) => updateSettings({ backupOnSave: e.target.checked })}
          />{' '}
          Keep a <code>.bak</code> copy of the previous file when saving
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.restoreSession}
            onChange={(e) => updateSettings({ restoreSession: e.target.checked })}
          />{' '}
          Re-open the previous files on start
        </label>
        <h4>Comparison defaults</h4>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.compareIgnoreFormatting}
            onChange={(e) => updateSettings({ compareIgnoreFormatting: e.target.checked })}
          />{' '}
          Treat whitespace-only XML differences as “formatting only”
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.compareSortAttributes}
            onChange={(e) => updateSettings({ compareSortAttributes: e.target.checked })}
          />{' '}
          Ignore attribute order
        </label>
        <h4>Data</h4>
        <div className="actions">
          <button
            className="btn"
            disabled={!historyCount}
            onClick={() => {
              clearHistory();
              toast('info', 'History cleared');
            }}
          >
            Clear history ({historyCount})
          </button>
          <button
            className="btn danger"
            disabled={!bookmarkCount}
            onClick={() => {
              setState({ bookmarks: [] });
              toast('info', 'Bookmarks removed');
            }}
          >
            Remove all bookmarks ({bookmarkCount})
          </button>
        </div>
      </div>
    </Modal>
  );
}
