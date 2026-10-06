import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';

export interface VirtualListHandle {
  scrollToIndex(index: number): void;
  focus(): void;
}

interface Props<T> {
  items: readonly T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  itemKey: (item: T, index: number) => string | number;
  className?: string;
  overscan?: number;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  role?: string;
  ariaLabel?: string;
}

/** Fixed-row-height virtual list. Only the rows in (or near) the viewport are mounted. */
function VirtualListInner<T>(
  {
    items,
    rowHeight,
    renderRow,
    itemKey,
    className,
    overscan = 8,
    onKeyDown,
    role,
    ariaLabel,
  }: Props<T>,
  ref: React.Ref<VirtualListHandle>,
): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scroller.current;
      if (!el) return;
      const top = index * rowHeight;
      const viewTop = el.scrollTop;
      const viewHeight = el.clientHeight;
      if (top < viewTop) el.scrollTop = Math.max(0, top - rowHeight);
      else if (top + rowHeight > viewTop + viewHeight)
        el.scrollTop = top + rowHeight * 2 - viewHeight;
    },
    [rowHeight],
  );

  useImperativeHandle(ref, () => ({ scrollToIndex, focus: () => scroller.current?.focus() }), [
    scrollToIndex,
  ]);

  // Keep the scroll position valid when the list shrinks.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollTop > Math.max(0, items.length * rowHeight - el.clientHeight))
      el.scrollTop = Math.max(0, items.length * rowHeight - el.clientHeight);
  }, [items.length, rowHeight]);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <div
        key={itemKey(items[i], i)}
        className="vl-row"
        style={{ top: i * rowHeight, height: rowHeight }}
      >
        {renderRow(items[i], i)}
      </div>,
    );
  }

  return (
    <div
      ref={scroller}
      className={`vl ${className ?? ''}`}
      tabIndex={0}
      role={role}
      aria-label={ariaLabel}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div className="vl-inner" style={{ height: items.length * rowHeight }}>
        {rows}
      </div>
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: Props<T> & { ref?: React.Ref<VirtualListHandle> },
) => ReactNode;
