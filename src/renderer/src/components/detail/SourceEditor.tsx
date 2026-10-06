import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Crosshair,
  Minimize2,
  Search,
  WandSparkles,
  WrapText,
} from 'lucide-react';
import { contentTypeOf } from '@core/package/opc';
import { partKind } from '@core/package/kinds';
import {
  elementAtOffset,
  elementAtPath,
  elementPath,
  tryParseXml,
  xpathOf,
} from '@core/xml/parser';
import { getAnalysis, useApp, useModelVersion } from '../../store/app';
import {
  formatPart,
  navigate,
  revealInSource,
  setPartText,
  updateSettings,
} from '../../store/actions';
import { useEditorStatus } from '../../store/editorStatus';
import { displayText, isXmlName } from '../../lib/display';
import { copyText } from '../../lib/clipboard';
import type { DocTab } from '../../store/types';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';

const MAX_LOCATE_CHARS = 4_000_000;
const LARGE_PART_CHARS = 1_500_000;

/** The editable (or read-only) source of the selected part, with the selected element highlighted. */
export function SourceEditor({ tab }: { tab: DocTab }) {
  const part = tab.selection.part!;
  const pretty = useApp((s) => s.settings.prettyPrint);
  if (!tab.model.has(part)) return <div className="empty">This part no longer exists.</div>;
  // Remount when the part or the pretty-print mode changes so the editor state starts clean.
  return (
    <SourceEditorInner key={`${tab.id}|${part}|${pretty}`} tab={tab} part={part} pretty={pretty} />
  );
}

function SourceEditorInner({ tab, part, pretty }: { tab: DocTab; part: string; pretty: boolean }) {
  const { model } = tab;
  useModelVersion(model);
  const settings = useApp((s) => s.settings);
  const editor = useRef<CodeEditorHandle>(null);
  const contentType = contentTypeOf(getAnalysis(model).contentTypes, part);
  const isXml = isXmlName(part, contentType) || partKind(part, contentType) === 'xml';
  const modelText = model.getText(part).text;

  // `emitted` is the last text this editor wrote to the model, so we can tell our own edits
  // from external ones (undo, tree edits) and only push the latter back into the editor.
  const emitted = useRef<string | null>(null);
  // Big parts are formatted after the first paint so the UI can show a progress message instead of freezing silently.
  const [display, setDisplay] = useState<string | null>(() =>
    modelText.length > LARGE_PART_CHARS ? null : displayText(model, part, pretty, contentType),
  );
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (emitted.current === modelText) return;
    emitted.current = null;
    setDisplay(displayText(model, part, pretty, contentType));
  }, [modelText, model, part, pretty, contentType]);
  useEffect(() => {
    if (display !== null) return;
    const t = setTimeout(() => setDisplay(displayText(model, part, pretty, contentType)), 30);
    return () => clearTimeout(t);
  }, [display, model, part, pretty, contentType]);

  const onChange = (text: string): void => {
    emitted.current = text;
    if (!tab.readOnly) setPartText(tab.id, part, text);
  };

  // --- selected element highlight ---------------------------------------------------------
  const pathKey = tab.selection.path?.join('/');
  const [elementRange, setElementRange] = useState<{
    range: { from: number; to: number } | null;
    scroll: boolean;
    token: string;
  } | null>(null);
  useEffect(() => {
    if (!tab.selection.path) {
      setElementRange(null);
      return;
    }
    const text = editor.current?.view()?.state.doc.toString() ?? display ?? '';
    const r = tryParseXml(text);
    const el = r.doc && elementAtPath(r.doc, tab.selection.path);
    setElementRange({
      range: el ? { from: el.start, to: el.end } : null,
      scroll: true,
      token: `${part}:${pathKey}`,
    });
    // Re-evaluate when the selection moves, not on every keystroke.
  }, [pathKey, part]);

  // --- reveal requests (search hits, problems) --------------------------------------------
  const reveal = tab.reveal?.part === part ? tab.reveal : undefined;
  const revealProp = useMemo(
    () =>
      reveal
        ? {
            offset: reveal.offset,
            line: reveal.line,
            column: reveal.column,
            length: reveal.length,
            token: reveal.token,
          }
        : null,
    [reveal],
  );

  // --- caret → XPath ----------------------------------------------------------------------
  const [caretPath, setCaretPath] = useState<{ xpath: string; path: number[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCursor = (offset: number, line: number, column: number): void => {
    useEditorStatus.setState({ line, column });
    if (!isXml) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const text = editor.current?.view()?.state.doc.toString();
      if (!text || text.length > MAX_LOCATE_CHARS) return setCaretPath(null);
      const r = tryParseXml(text);
      const el = r.doc && elementAtOffset(r.doc, offset);
      setCaretPath(el ? { xpath: xpathOf(el), path: elementPath(el) } : null);
    }, 200);
  };
  useEffect(() => {
    useEditorStatus.setState({ line: 1, column: 1 }); // a fresh editor starts at the top
    return () => clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    const onFind = (): void => editor.current?.openFind();
    window.addEventListener('ooxml:find', onFind);
    return () => window.removeEventListener('ooxml:find', onFind);
  }, []);

  const parse = isXml ? model.getXml(part) : undefined;
  const error = parse?.error;

  return (
    <div className="source">
      <div className="source-toolbar">
        {isXml &&
          (error ? (
            <button
              className="badge error"
              title="Jump to the error"
              onClick={() =>
                revealInSource(tab.id, { part, line: error.line, column: error.column, length: 1 })
              }
            >
              <AlertTriangle size={13} /> Line {error.line}, col {error.column}: {error.reason}
            </button>
          ) : (
            <span className="badge ok">
              <CheckCircle2 size={13} /> Well-formed
            </span>
          ))}
        {tab.readOnly && <span className="badge">Read-only</span>}
        <span className="spacer" />
        {isXml && (
          <>
            <button
              className={`btn-ghost ${pretty ? 'active' : ''}`}
              onClick={() => updateSettings({ prettyPrint: !pretty })}
              title="Show XML re-indented. The package is only changed when you edit."
            >
              <WandSparkles size={14} /> Pretty
            </button>
            <button
              className="btn-ghost"
              onClick={() => formatPart(tab.id, part)}
              disabled={tab.readOnly || !!error}
              title="Re-indent the part (changes the file)"
            >
              Format
            </button>
            <button
              className="btn-ghost"
              onClick={() => formatPart(tab.id, part, true)}
              disabled={tab.readOnly || !!error}
              title="Remove ignorable whitespace (changes the file)"
            >
              <Minimize2 size={14} /> Minify
            </button>
          </>
        )}
        <button
          className={`btn-ghost ${settings.wrapLines ? 'active' : ''}`}
          onClick={() => updateSettings({ wrapLines: !settings.wrapLines })}
          title="Toggle word wrap"
        >
          <WrapText size={14} />
        </button>
        <button
          className="btn-ghost"
          onClick={() => editor.current?.openFind()}
          title="Find in this part (Ctrl/Cmd+F)"
        >
          <Search size={14} />
        </button>
        <button
          className="btn-ghost"
          onClick={() =>
            void copyText(
              editor.current?.view()?.state.doc.toString() ?? display ?? '',
              'Source copied',
            )
          }
          title="Copy the source"
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="source-body">
        {display === null ? (
          <div className="empty">Preparing {(modelText.length / 1e6).toFixed(1)} MB of XML…</div>
        ) : (
          <CodeEditor
            ref={editor}
            value={display}
            onChange={onChange}
            readOnly={tab.readOnly}
            language={isXml ? 'xml' : 'plain'}
            wrap={settings.wrapLines}
            fontSize={settings.editorFontSize}
            elementRange={elementRange}
            reveal={revealProp}
            onCursor={onCursor}
          />
        )}
      </div>
      {isXml && (
        <div className="source-footer">
          <span className="mono caret-path" title={caretPath?.xpath}>
            {caretPath?.xpath ?? '—'}
          </span>
          <button
            className="btn-ghost"
            disabled={!caretPath}
            onClick={() =>
              caretPath &&
              navigate(
                tab.id,
                { part, path: caretPath.path },
                { record: true, detailTab: 'source' },
              )
            }
            title="Select the element at the caret in the tree"
          >
            <Crosshair size={14} /> Locate in tree
          </button>
        </div>
      )}
    </div>
  );
}
