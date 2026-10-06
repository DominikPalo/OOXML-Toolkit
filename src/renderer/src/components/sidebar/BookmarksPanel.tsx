import { useMemo } from 'react';
import { Bookmark as BookmarkIcon, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { baseName, partKind } from '@core/package/kinds';
import { gotoBookmark, removeBookmark, updateBookmark } from '../../store/actions';
import { useApp } from '../../store/app';
import { promptDialog } from '../../store/ui';
import type { Bookmark } from '../../store/types';
import { PartIcon } from '../common/Icons';

export function BookmarksPanel() {
  const bookmarks = useApp((s) => s.bookmarks);
  const active = useApp((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return t?.kind === 'doc' ? (t.path ?? t.name) : undefined;
  });

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: Bookmark[] }>();
    for (const b of bookmarks) {
      const g = map.get(b.fileKey) ?? { name: b.fileName, items: [] };
      g.items.push(b);
      map.set(b.fileKey, g);
    }
    // The file being viewed comes first.
    return [...map].sort(([a], [b]) => Number(b === active) - Number(a === active));
  }, [bookmarks, active]);

  if (!bookmarks.length) {
    return (
      <div className="panel empty-panel">
        <BookmarkIcon size={28} className="ic" />
        <p>No bookmarks yet.</p>
        <p className="muted small">
          Select a part or an element and press <kbd>Ctrl/Cmd</kbd>+<kbd>D</kbd>, or use the
          bookmark button above the detail view.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      {groups.map(([key, g]) => (
        <section key={key} className="bm-group">
          <h4 title={key}>
            {g.name}
            {key === active && <span className="chip">open</span>}
          </h4>
          {g.items.map((b) => (
            <div
              key={b.id}
              className="bm-item"
              onClick={() => void gotoBookmark(b)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && void gotoBookmark(b)}
            >
              <PartIcon kind={partKind(b.part)} size={14} />
              <div className="bm-text">
                <span className="bm-label">{b.label}</span>
                <span className="bm-sub mono" title={b.xpath ? `${b.part}#${b.xpath}` : b.part}>
                  {b.xpath ? b.xpath : baseName(b.part)}
                </span>
                {b.note && (
                  <span className="bm-note">
                    <StickyNote size={11} /> {b.note}
                  </span>
                )}
              </div>
              <div className="row-actions">
                <button
                  className="icon-btn"
                  title="Rename or add a note"
                  aria-label="Edit bookmark"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const label = await promptDialog({
                      title: 'Bookmark name',
                      label: 'Name',
                      value: b.label,
                      confirmLabel: 'Next',
                      validate: (v) => (v.trim() ? undefined : 'Enter a name.'),
                    });
                    if (label === undefined) return;
                    const note = await promptDialog({
                      title: 'Bookmark note',
                      label: 'Note (optional)',
                      value: b.note ?? '',
                      multiline: true,
                      confirmLabel: 'Save',
                    });
                    updateBookmark(b.id, { label: label.trim(), note: note?.trim() || undefined });
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-btn"
                  title="Remove bookmark"
                  aria-label="Remove bookmark"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBookmark(b.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
