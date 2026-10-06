import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, lineNumbers } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { xml } from '@codemirror/lang-xml';
import { search } from '@codemirror/search';
import {
  MergeView,
  getChunks,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from '@codemirror/merge';
import { editorTheme, highlightStyle } from '../detail/CodeEditor';

export interface DiffViewHandle {
  next(): void;
  prev(): void;
  chunkCount(): number;
}

interface Props {
  left: string;
  right: string;
  mode: 'split' | 'unified';
  language: 'xml' | 'plain';
  collapseUnchanged: boolean;
  fontSize: number;
  wrap: boolean;
  onChunks?: (count: number) => void;
}

function base(language: 'xml' | 'plain', wrap: boolean): Extension[] {
  return [
    lineNumbers(),
    drawSelection(),
    search({ top: true }),
    syntaxHighlighting(highlightStyle),
    editorTheme,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    ...(language === 'xml' ? [xml()] : []),
    ...(wrap ? [EditorView.lineWrapping] : []),
  ];
}

/** Read-only side-by-side or unified diff of two texts. */
export const DiffView = forwardRef<DiffViewHandle, Props>(function DiffView(
  { left, right, mode, language, collapseUnchanged, fontSize, wrap, onChunks },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const target = useRef<EditorView | null>(null);
  const chunks = useRef(0);
  const onChunksRef = useRef(onChunks);
  onChunksRef.current = onChunks;

  useImperativeHandle(
    ref,
    () => ({
      next: () => target.current && goToNextChunk(target.current),
      prev: () => target.current && goToPreviousChunk(target.current),
      chunkCount: () => chunks.current,
    }),
    [],
  );

  useEffect(() => {
    const parent = host.current!;
    parent.textContent = '';
    const collapse = collapseUnchanged ? { margin: 3, minSize: 8 } : undefined;
    let destroy: () => void;
    const report = (view: EditorView): void => {
      const c = getChunks(view.state)?.chunks.length ?? 0;
      chunks.current = c;
      onChunksRef.current?.(c);
    };

    if (mode === 'split') {
      const mv = new MergeView({
        a: { doc: left, extensions: base(language, wrap) },
        b: { doc: right, extensions: base(language, wrap) },
        parent,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: collapse,
      });
      target.current = mv.b;
      report(mv.b);
      destroy = () => mv.destroy();
    } else {
      const view = new EditorView({
        parent,
        doc: right,
        extensions: [
          ...base(language, wrap),
          unifiedMergeView({
            original: left,
            highlightChanges: true,
            gutter: true,
            mergeControls: false,
            collapseUnchanged: collapse,
          }),
        ],
      });
      target.current = view;
      report(view);
      destroy = () => view.destroy();
    }
    return () => {
      destroy();
      target.current = null;
    };
  }, [left, right, mode, language, collapseUnchanged, wrap]);

  return (
    <div
      ref={host}
      className={`diff-view ${mode}`}
      style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
    />
  );
});
