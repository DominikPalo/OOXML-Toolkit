import { RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useModelVersion } from '../store/app';
import { dismissExternalChange, isDirty, reloadTab } from '../store/actions';
import { useInspectorDraft } from '../store/inspectorDraft';
import type { DocTab } from '../store/types';

/** Shown above a document whose file was modified by another program (PowerPoint, Word, ...). */
export function DiskChangeBanner({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  useInspectorDraft((s) => s.pending?.tabId === tab.id);
  const dirty = isDirty(tab);
  return (
    <div className="disk-banner" role="alert">
      <TriangleAlert size={15} className="disk-banner-icon" />
      <span className="disk-banner-text">
        <b>{tab.name}</b> was changed by another program.{' '}
        {dirty
          ? 'You also have unsaved changes: reloading discards them, saving overwrites the other changes.'
          : 'Reload to see the latest version.'}
      </span>
      <button className="btn" onClick={() => void reloadTab(tab.id)}>
        <RefreshCw size={13} /> Reload
      </button>
      <button
        className="icon-btn"
        onClick={() => dismissExternalChange(tab.id)}
        title="Keep working with the version open here"
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}
