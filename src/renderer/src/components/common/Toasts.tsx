import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../../store/app';
import { dismissToast } from '../../store/ui';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.kind === 'error' ? (
            <AlertCircle size={16} />
          ) : t.kind === 'success' ? (
            <CheckCircle2 size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{t.text}</span>
          <button className="icon-btn" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
