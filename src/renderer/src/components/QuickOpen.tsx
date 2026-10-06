import { useEffect, useMemo, useRef, useState } from 'react';
import { baseName, partKind } from '@core/package/kinds';
import { contentTypeOf } from '@core/package/opc';
import { fuzzyFilter } from '@core/search';
import { activeDoc, getAnalysis, setState, useApp } from '../store/app';
import { navigate } from '../store/actions';
import { PartIcon } from './common/Icons';

/** "Go to part" palette (Ctrl/Cmd+P). */
export function QuickOpen() {
  const open = useApp((s) => s.ui.quickOpen);
  const tab = useApp((s) => activeDoc(s));
  if (!open || !tab) return null;
  return <Palette key={tab.id} tabId={tab.id} />;
}

function Palette({ tabId }: { tabId: string }) {
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId && t.kind === 'doc'));
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = (): void => setState((s) => ({ ui: { ...s.ui, quickOpen: false } }));

  const names = useMemo(() => (tab?.kind === 'doc' ? tab.model.names() : []), [tab]);
  const results = useMemo(() => fuzzyFilter(query, names, 80), [query, names]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (tab?.kind !== 'doc') return null;
  const analysis = getAnalysis(tab.model);

  const choose = (name: string | undefined): void => {
    if (!name) return;
    close();
    navigate(tabId, { part: name }, { sidebar: true });
  };

  return (
    <div
      className="modal-backdrop top"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="palette" role="dialog" aria-label="Go to part">
        <input
          autoFocus
          className="palette-input"
          placeholder="Go to part… (type part of a name or path)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown')
              (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
            else if (e.key === 'Enter') choose(results[index]);
            else if (e.key === 'Escape') close();
          }}
        />
        <div ref={list} className="palette-list" role="listbox">
          {results.map((name, i) => (
            <div
              key={name}
              className={`palette-item ${i === index ? 'active' : ''}`}
              role="option"
              aria-selected={i === index}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(name)}
            >
              <PartIcon kind={partKind(name, contentTypeOf(analysis.contentTypes, name))} />
              <span className="pi-name">{baseName(name)}</span>
              <span className="pi-dir">{name.slice(0, name.lastIndexOf('/') + 1)}</span>
            </div>
          ))}
          {results.length === 0 && <div className="palette-empty">No matching parts.</div>}
        </div>
      </div>
    </div>
  );
}
