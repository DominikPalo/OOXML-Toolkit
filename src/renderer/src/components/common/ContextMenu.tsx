import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';

export type MenuItem =
  | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { separator: true };

interface State {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Returns `[open, element]`. Call `open(event, items)` from `onContextMenu` and render `element` once. */
export function useContextMenu(): [(e: MouseEvent, items: MenuItem[]) => void, ReactNode] {
  const [state, setState] = useState<State | null>(null);
  const open = useCallback((e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (items.length) setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  return [open, state && <Menu state={state} onClose={() => setState(null)} />];
}

function Menu({ state, onClose }: { state: State; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(state.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(state.y, window.innerHeight - r.height - 4)),
    });
  }, [state]);

  useEffect(() => {
    const close = (): void => onClose();
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', close);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {state.items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
