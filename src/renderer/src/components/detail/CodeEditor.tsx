import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { xml } from '@codemirror/lang-xml';
import { tags as t } from '@lezer/highlight';

export interface Range {
  from: number;
  to: number;
}

interface Marks {
  element?: Range | null;
  match?: Range | null;
}

const setMarks = StateEffect.define<Marks>();

const elementMark = Decoration.mark({ class: 'cm-el-highlight' });
const matchMark = Decoration.mark({ class: 'cm-match-highlight' });

/** Decorations for "the selected element" and "the search match", kept in place while editing. */
const marksField = StateField.define<{
  element: Range | null;
  match: Range | null;
  deco: DecorationSet;
}>({
  create: () => ({ element: null, match: null, deco: Decoration.none }),
  update(value, tr) {
    let { element, match } = value;
    if (tr.docChanged) {
      const map = (r: Range | null): Range | null => {
        if (!r) return null;
        const from = tr.changes.mapPos(r.from, 1);
        const to = tr.changes.mapPos(r.to, -1);
        return to > from ? { from, to } : null;
      };
      element = map(element);
      // A search match is a one-shot hint: editing clears it.
      match = null;
    }
    for (const e of tr.effects) {
      if (e.is(setMarks)) {
        if ('element' in e.value) element = e.value.element ?? null;
        if ('match' in e.value) match = e.value.match ?? null;
      }
    }
    if (element === value.element && match === value.match) return value;
    const ranges: Array<[number, number, Decoration]> = [];
    const len = tr.state.doc.length;
    if (element) ranges.push([Math.min(element.from, len), Math.min(element.to, len), elementMark]);
    if (match) ranges.push([Math.min(match.from, len), Math.min(match.to, len), matchMark]);
    ranges.sort((a, b) => a[0] - b[0]);
    const b = new RangeSetBuilder<Decoration>();
    for (const [from, to, d] of ranges) if (to > from) b.add(from, to, d);
    return { element, match, deco: b.finish() };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export const highlightStyle = HighlightStyle.define([
  { tag: t.tagName, color: 'var(--syn-tag)' },
  { tag: t.attributeName, color: 'var(--syn-attr)' },
  { tag: [t.attributeValue, t.string], color: 'var(--syn-string)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.angleBracket, t.punctuation, t.separator], color: 'var(--syn-punct)' },
  { tag: [t.processingInstruction, t.documentMeta, t.meta], color: 'var(--syn-meta)' },
  { tag: [t.typeName, t.keyword], color: 'var(--syn-meta)' },
  { tag: t.character, color: 'var(--syn-entity)' },
]);

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--editor-bg)',
    fontSize: 'var(--editor-font-size, 13px)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--text-faint)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-hover)',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    padding: '0 4px',
    margin: '0 2px',
  },
  '.cm-foldGutter span': { color: 'var(--text-faint)', cursor: 'pointer' },
  '.cm-panels': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--match-bg)',
    outline: '1px solid var(--match-border)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--match-selected-bg)' },
  '.cm-el-highlight': { backgroundColor: 'var(--el-highlight)' },
  '.cm-match-highlight': {
    backgroundColor: 'var(--match-selected-bg)',
    outline: '1px solid var(--match-border)',
  },
  '.cm-matchingBracket': { backgroundColor: 'var(--selection-match)', outline: 'none' },
});

export interface CodeEditorHandle {
  view(): EditorView | null;
  openFind(): void;
}

interface Props {
  value: string;
  onChange?: (text: string) => void;
  readOnly?: boolean;
  language?: 'xml' | 'plain';
  wrap?: boolean;
  fontSize?: number;
  /** Persistent highlight of the selected element (offsets into `value`-derived doc). */
  elementRange?: { range: Range | null; scroll: boolean; token: string } | null;
  /** One-shot reveal of a search hit / problem, by offset or by 1-based line/column. */
  reveal?: {
    offset?: number;
    line?: number;
    column?: number;
    length?: number;
    token: number;
  } | null;
  onCursor?: (offset: number, line: number, column: number) => void;
}

function replaceMinimal(view: EditorView, next: string): void {
  const cur = view.state.doc.toString();
  if (cur === next) return;
  let start = 0;
  const max = Math.min(cur.length, next.length);
  while (start < max && cur.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (
    endCur > start &&
    endNext > start &&
    cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCur--;
    endNext--;
  }
  view.dispatch({ changes: { from: start, to: endCur, insert: next.slice(start, endNext) } });
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const { value, readOnly = false, language = 'xml', wrap = false, fontSize = 13 } = props;
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const langC = useRef(new Compartment());
  const wrapC = useRef(new Compartment());
  const roC = useRef(new Compartment());
  const suppress = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      view: () => viewRef.current,
      openFind: () => viewRef.current && openSearchPanel(viewRef.current),
    }),
    [],
  );

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      foldGutter(),
      drawSelection(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(highlightStyle),
      marksField,
      editorTheme,
      // Undo/redo are handled by the app (model history), not by CodeMirror.
      keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
      langC.current.of(language === 'xml' ? xml() : []),
      wrapC.current.of(wrap ? EditorView.lineWrapping : []),
      roC.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !suppress.current) propsRef.current.onChange?.(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          propsRef.current.onCursor?.(head, line.number, head - line.from + 1);
        }
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current!,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per mount; props are applied by the effects below.
  }, []);

  // External value changes (undo/redo, tree edits, …) are applied as a minimal replacement.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || (view.state.doc.length === value.length && view.state.doc.toString() === value))
      return;
    suppress.current = true;
    try {
      replaceMinimal(view, value);
    } finally {
      suppress.current = false;
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langC.current.reconfigure(language === 'xml' ? xml() : []),
    });
  }, [language]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapC.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: roC.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  const el = props.elementRange;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const range = el?.range ?? null;
    view.dispatch({
      effects: [
        setMarks.of({ element: range }),
        ...(range && el?.scroll
          ? [EditorView.scrollIntoView(range.from, { y: 'start', yMargin: 48 })]
          : []),
      ],
    });
  }, [el?.token, el?.range?.from, el?.range?.to]);

  const reveal = props.reveal;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const doc = view.state.doc;
    let from = reveal.offset ?? 0;
    if (reveal.offset === undefined && reveal.line !== undefined) {
      const line = doc.line(Math.max(1, Math.min(reveal.line, doc.lines)));
      from = line.from + Math.max(0, Math.min((reveal.column ?? 1) - 1, line.length));
    }
    from = Math.min(from, doc.length);
    const to = Math.min(from + (reveal.length ?? 0), doc.length);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: [
        setMarks.of({ match: to > from ? { from, to } : null }),
        EditorView.scrollIntoView(from, { y: 'center' }),
      ],
    });
  }, [reveal]);

  return (
    <div
      ref={host}
      className="code-editor"
      style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
    />
  );
});
