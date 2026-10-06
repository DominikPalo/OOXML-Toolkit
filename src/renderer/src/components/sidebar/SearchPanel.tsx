import { useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord } from 'lucide-react';
import { baseName, partKind } from '@core/package/kinds';
import { contentTypeOf } from '@core/package/opc';
import { searchPackage, type SearchHit, type SearchResult } from '@core/search';
import { getAnalysis, useApp, useModelVersion } from '../../store/app';
import { navigate, revealInSource } from '../../store/actions';
import { prettySource } from '../../lib/display';
import { evaluateXPath, type XPathHit, type XPathResultSet } from '../../lib/xpath';
import type { DocTab } from '../../store/types';
import { PartIcon } from '../common/Icons';

type Mode = 'text' | 'xpath';

function HitPreview({ hit }: { hit: SearchHit }) {
  const before = hit.preview.slice(0, hit.previewStart);
  const match = hit.preview.slice(hit.previewStart, hit.previewStart + hit.length);
  const after = hit.preview.slice(hit.previewStart + hit.length);
  return (
    <span className="hit-preview mono">
      {before.trimStart()}
      <mark>{match}</mark>
      {after}
    </span>
  );
}

/**
 * The panel is remounted per document (results always belong to the document on screen), but the
 * query and options carry over, so switching tabs re-runs the same search on the new document.
 */
const remembered = {
  mode: 'text' as Mode,
  query: '',
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  currentOnly: false,
};

export function SearchPanel({ tab }: { tab: DocTab }) {
  const version = useModelVersion(tab.model);
  const prettyPrint = useApp((s) => s.settings.prettyPrint);
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(remembered.mode);
  const [query, setQuery] = useState(remembered.query);
  const [caseSensitive, setCase] = useState(remembered.caseSensitive);
  const [regex, setRegex] = useState(remembered.regex);
  const [wholeWord, setWord] = useState(remembered.wholeWord);
  const [currentOnly, setCurrentOnly] = useState(remembered.currentOnly);
  Object.assign(remembered, { mode, query, caseSensitive, regex, wholeWord, currentOnly });
  const [text, setText] = useState<SearchResult>();
  const [xp, setXp] = useState<XPathResultSet>();
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const run = useRef(0);

  useEffect(() => {
    const focus = (): void => input.current?.select();
    window.addEventListener('ooxml:focus-search', focus);
    input.current?.focus();
    return () => window.removeEventListener('ooxml:focus-search', focus);
  }, []);

  // Re-run when the query, options or (debounced) package contents change.
  useEffect(() => {
    const id = ++run.current;
    if (!query) {
      setText(undefined);
      setXp(undefined);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      const cancelled = (): boolean => id !== run.current;
      const analysis = getAnalysis(tab.model);
      const only = currentOnly ? tab.selection.part : undefined;
      if (mode === 'text') {
        const ct = (n: string): string | undefined => contentTypeOf(analysis.contentTypes, n);
        const src = prettyPrint ? prettySource(tab.model, ct) : tab.model;
        const scoped = only
          ? { ...src, names: () => src.names().filter((n) => n === only), label: src.label }
          : src;
        const r = await searchPackage(
          scoped,
          { query, caseSensitive, regex, wholeWord },
          cancelled,
          ct,
        );
        if (!cancelled()) {
          setText(r);
          setXp(undefined);
        }
      } else {
        const r = await evaluateXPath(tab.model, query, cancelled, only);
        if (!cancelled()) {
          setXp(r);
          setText(undefined);
        }
      }
      if (!cancelled()) setBusy(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [
    query,
    mode,
    caseSensitive,
    regex,
    wholeWord,
    currentOnly,
    prettyPrint,
    tab.model,
    version,
    tab.selection.part,
  ]);

  const groups = useMemo(() => {
    const map = new Map<string, Array<SearchHit | XPathHit>>();
    for (const h of text?.hits ?? xp?.hits ?? []) {
      const list = map.get(h.part) ?? [];
      list.push(h);
      map.set(h.part, list);
    }
    return [...map];
  }, [text, xp]);

  const total = text?.hits.length ?? xp?.hits.length ?? 0;
  const error = text?.error ?? xp?.error;

  return (
    <div className="panel search-panel">
      <div className="search-box">
        <div className="search-input-wrap">
          <input
            ref={input}
            className="input"
            placeholder={mode === 'text' ? 'Search all parts' : 'XPath, e.g. //w:p[@w:rsidR]'}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search query"
          />
          {mode === 'text' && (
            <div className="input-toggles">
              <button
                className={caseSensitive ? 'on' : ''}
                onClick={() => setCase(!caseSensitive)}
                title="Match case"
                aria-pressed={caseSensitive}
              >
                <CaseSensitive size={14} />
              </button>
              <button
                className={wholeWord ? 'on' : ''}
                onClick={() => setWord(!wholeWord)}
                title="Whole word"
                aria-pressed={wholeWord}
              >
                <WholeWord size={14} />
              </button>
              <button
                className={regex ? 'on' : ''}
                onClick={() => setRegex(!regex)}
                title="Regular expression"
                aria-pressed={regex}
              >
                <Regex size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="search-options">
          <div className="segmented">
            <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
              Text
            </button>
            <button
              className={mode === 'xpath' ? 'active' : ''}
              onClick={() => setMode('xpath')}
              title="XPath 1.0. Use the prefix x: for a default namespace."
            >
              XPath
            </button>
          </div>
          <label className="check small">
            <input
              type="checkbox"
              checked={currentOnly}
              onChange={(e) => setCurrentOnly(e.target.checked)}
              disabled={!tab.selection.part}
            />
            Current part only
          </label>
        </div>
      </div>

      <div className="search-status">
        {error ? (
          <span className="ic-error">{error}</span>
        ) : busy ? (
          'Searching…'
        ) : query ? (
          `${total.toLocaleString()} result${total === 1 ? '' : 's'} in ${groups.length} part${groups.length === 1 ? '' : 's'}${text?.truncated || xp?.truncated ? ' (limited)' : ''}`
        ) : (
          'Type to search the whole package.'
        )}
      </div>

      <div className="results">
        {groups.map(([part, hits]) => {
          const open = !collapsed[part];
          const kind = partKind(part, contentTypeOf(getAnalysis(tab.model).contentTypes, part));
          return (
            <div key={part} className="result-group">
              <button
                className="result-head"
                onClick={() => setCollapsed({ ...collapsed, [part]: open })}
                title={part}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <PartIcon kind={kind} size={14} />
                <span className="result-name">{baseName(part)}</span>
                <span className="result-dir">{part.slice(0, part.lastIndexOf('/') + 1)}</span>
                <span className="count">{hits.length}</span>
              </button>
              {open &&
                hits.map((h, i) =>
                  'line' in h ? (
                    <button
                      key={i}
                      className="result-hit"
                      onClick={() =>
                        revealInSource(tab.id, {
                          part,
                          offset: h.offset,
                          length: h.length,
                          line: h.line,
                          column: h.column,
                        })
                      }
                    >
                      <span className="hit-loc">
                        {h.line}:{h.column}
                      </span>
                      <HitPreview hit={h} />
                    </button>
                  ) : (
                    <button
                      key={i}
                      className="result-hit"
                      onClick={() =>
                        navigate(tab.id, { part, path: h.path }, { detailTab: 'source' })
                      }
                    >
                      <span className="hit-loc mono">{h.label}</span>
                      <span className="hit-preview mono">{h.preview}</span>
                    </button>
                  ),
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
