import { useMemo, useState } from 'react';
import { FolderOpen, Pin, PinOff, Trash2, X } from 'lucide-react';
import { formatBytes } from '@core/text';
import { host } from '../../host';
import {
  clearHistory,
  openFilesFromDialog,
  openPath,
  removeHistory,
  togglePin,
} from '../../store/actions';
import { getState, useApp } from '../../store/app';
import { toast } from '../../store/ui';
import { timeAgo } from '../../lib/describe';
import type { HistoryEntry } from '../../store/types';
import { DocBadge } from '../common/Icons';

export function openHistoryEntry(h: HistoryEntry): void {
  if (h.path) void openPath(h.path);
  else {
    const open = getState().tabs.find((t) => t.kind === 'doc' && t.name === h.name);
    if (open) useApp.setState({ activeId: open.id });
    else
      toast(
        'info',
        'This file was opened in the browser and cannot be re-opened automatically. Use Open… to pick it again.',
      );
  }
}

export function HistoryList({
  entries,
  compact = false,
}: {
  entries: HistoryEntry[];
  compact?: boolean;
}) {
  return (
    <>
      {entries.map((h) => (
        <div
          key={h.key}
          className={`hist-item ${compact ? 'compact' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => openHistoryEntry(h)}
          onKeyDown={(e) => e.key === 'Enter' && openHistoryEntry(h)}
          title={h.path ?? h.name}
        >
          <DocBadge family={h.family} size={compact ? 22 : 26} />
          <div className="hist-text">
            <span className="hist-name">{h.name}</span>
            <span className="hist-sub">
              {h.path ? h.path.slice(0, h.path.length - h.name.length - 1) || '/' : h.typeLabel}
            </span>
            <span className="hist-sub">
              {timeAgo(h.openedAt)} · {formatBytes(h.size)}
            </span>
          </div>
          {!compact && (
            <div className="row-actions">
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(h.key);
                }}
                title={h.pinned ? 'Unpin' : 'Pin to the top'}
                aria-label={h.pinned ? 'Unpin' : 'Pin'}
              >
                {h.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
              {h.path && host.kind !== 'web' && (
                <button
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void host.revealInFolder(h.path!);
                  }}
                  title="Reveal in file manager"
                  aria-label="Reveal"
                >
                  <FolderOpen size={13} />
                </button>
              )}
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  removeHistory(h.key);
                }}
                title="Remove from history"
                aria-label="Remove"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function HistoryPanel() {
  const history = useApp((s) => s.history);
  const [filter, setFilter] = useState('');
  const { pinned, recent } = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = history.filter(
      (h) => !f || h.name.toLowerCase().includes(f) || h.path?.toLowerCase().includes(f),
    );
    return { pinned: list.filter((h) => h.pinned), recent: list.filter((h) => !h.pinned) };
  }, [history, filter]);

  return (
    <div className="panel">
      <div className="panel-tools">
        <input
          className="input"
          placeholder="Filter recent files"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter recent files"
        />
        <button
          className="icon-btn"
          onClick={() => void openFilesFromDialog()}
          title="Open file…"
          aria-label="Open file"
        >
          <FolderOpen size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={clearHistory}
          disabled={!history.some((h) => !h.pinned)}
          title="Clear history (keeps pinned files)"
          aria-label="Clear history"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {history.length === 0 && (
        <div className="empty-panel">
          <p>No recent files.</p>
          <p className="muted small">Files you open appear here.</p>
        </div>
      )}
      {pinned.length > 0 && <h4 className="panel-sub">Pinned</h4>}
      <HistoryList entries={pinned} />
      {recent.length > 0 && <h4 className="panel-sub">Recent</h4>}
      <HistoryList entries={recent} />
    </div>
  );
}
