import { useCallback, useRef } from 'react';

interface Props {
  /** Current size of the panel being resized. */
  size: number;
  onResize: (size: number) => void;
  min?: number;
  max?: number;
  /** `left`: the panel is left of the handle (dragging right grows it). */
  side?: 'left' | 'right';
  orientation?: 'vertical' | 'horizontal';
}

export function ResizeHandle({
  size,
  onResize,
  min = 180,
  max = 720,
  side = 'left',
  orientation = 'vertical',
}: Props) {
  const start = useRef({ pos: 0, size: 0 });

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const pos = orientation === 'vertical' ? e.clientX : e.clientY;
      const delta = (pos - start.current.pos) * (side === 'left' ? 1 : -1);
      onResize(Math.max(min, Math.min(max, start.current.size + delta)));
    },
    [max, min, onResize, orientation, side],
  );

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    start.current = { pos: orientation === 'vertical' ? e.clientX : e.clientY, size };
    document.body.classList.add('resizing');
    const up = (): void => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={`resize-handle ${orientation}`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(320)}
      role="separator"
      aria-orientation={orientation}
      tabIndex={-1}
    />
  );
}
