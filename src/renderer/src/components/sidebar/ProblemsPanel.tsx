import { AlertCircle, AlertTriangle, CheckCircle2, Info, Play, RefreshCw } from 'lucide-react';
import type { Problem } from '@core/package/validate';
import { navigate, revealInSource, runValidation } from '../../store/actions';
import { useModelVersion } from '../../store/app';
import type { DocTab } from '../../store/types';

const ICON = {
  error: <AlertCircle size={15} className="ic-error" />,
  warning: <AlertTriangle size={15} className="ic-warn" />,
  info: <Info size={15} className="ic-info" />,
};

export function ProblemsPanel({ tab }: { tab: DocTab }) {
  const version = useModelVersion(tab.model);
  const { problems } = tab;
  const stale = problems.status === 'done' && problems.atVersion !== version;
  const open = (p: Problem): void => {
    if (!p.part || !tab.model.has(p.part)) return;
    if (p.line) revealInSource(tab.id, { part: p.part, line: p.line, column: p.column, length: 1 });
    else navigate(tab.id, { part: p.part }, { sidebar: false });
  };

  return (
    <div className="panel">
      <div className="panel-tools">
        <button
          className="btn"
          onClick={() => void runValidation(tab.id)}
          disabled={problems.status === 'running'}
        >
          {problems.status === 'done' ? <RefreshCw size={14} /> : <Play size={14} />}{' '}
          {problems.status === 'done' ? 'Check again' : 'Check package'}
        </button>
        {stale && <span className="chip warn">outdated</span>}
      </div>
      {problems.status === 'idle' && (
        <div className="empty-panel">
          <p>Validate the package structure.</p>
          <p className="muted small">
            Finds malformed XML, dangling relationships, parts without a content type and
            unreferenced parts.
          </p>
        </div>
      )}
      {problems.status === 'running' && (
        <div className="empty-panel">
          <p>Checking…</p>
        </div>
      )}
      {problems.status === 'done' && problems.items.length === 0 && (
        <div className="empty-panel ok">
          <CheckCircle2 size={28} />
          <p>No problems found.</p>
        </div>
      )}
      {problems.items.map((p, i) => (
        <button key={i} className="problem" onClick={() => open(p)} title={p.part}>
          {ICON[p.severity]}
          <span className="problem-text">
            <span>{p.message}</span>
            {p.part && (
              <span className="problem-loc mono">
                {p.part}
                {p.line ? `:${p.line}:${p.column}` : ''}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
