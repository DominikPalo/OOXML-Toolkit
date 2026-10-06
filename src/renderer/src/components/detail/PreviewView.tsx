import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { contentTypeOf } from '@core/package/opc';
import { isMetafile, isPreviewableImage } from '@core/package/kinds';
import { readDocument, readDocumentText } from '@core/preview/docx';
import { columnName, listSheets, readSheet, type Cell } from '@core/preview/xlsx';
import { listSlides, readSlide, type SlideShape } from '@core/preview/pptx';
import { getAnalysis, useModelVersion } from '../../store/app';
import { navigate } from '../../store/actions';
import { copyText } from '../../lib/clipboard';
import { imageUrl, nativeImageUrl } from '../../lib/imageUrl';
import { previewKindOf } from '../../lib/previewKind';
import type { DocTab } from '../../store/types';

/** Rendered content of the selected part (worksheet grid, Word text outline, or slide). */
export function PreviewView({ tab }: { tab: DocTab }) {
  const version = useModelVersion(tab.model);
  const deferred = useDeferredValue(version);
  const part = tab.selection.part!;
  const kind = previewKindOf(contentTypeOf(getAnalysis(tab.model).contentTypes, part));
  if (!tab.model.has(part)) return <div className="empty">This part no longer exists.</div>;
  if (kind === 'sheet') return <SheetPreview tab={tab} part={part} version={deferred} />;
  if (kind === 'doc') return <DocPreview tab={tab} part={part} version={deferred} />;
  if (kind === 'slide') return <SlidePreview tab={tab} part={part} version={deferred} />;
  return <div className="empty">No preview is available for this part.</div>;
}

interface Props {
  tab: DocTab;
  part: string;
  version: number;
}

// ---------------------------------------------------------------------------------------------
// Worksheet
// ---------------------------------------------------------------------------------------------

function SheetPreview({ tab, part, version }: Props) {
  const { model } = tab;
  const sheets = useMemo(() => listSheets(model), [model, version]);
  const grid = useMemo(
    () => readSheet(model, part, { maxRows: 1000, maxCols: 80 }),
    [model, part, version],
  );
  const [selected, setSelected] = useState<Cell | undefined>();
  useEffect(() => setSelected(undefined), [part]);

  const columns = Array.from({ length: grid.columnCount }, (_, i) => i);
  return (
    <div className="preview">
      <div className="preview-toolbar">
        <div className="sheet-tabs" role="tablist">
          {sheets.map((s) => (
            <button
              key={s.part}
              role="tab"
              aria-selected={s.part === part}
              className={`sheet-tab ${s.part === part ? 'active' : ''}`}
              onClick={() => navigate(tab.id, { part: s.part })}
              title={s.state === 'visible' ? s.part : `${s.part} (${s.state})`}
            >
              {s.name}
              {s.state !== 'visible' && ' ·hidden'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="muted small">
          {grid.dimension ? `${grid.dimension} · ` : ''}
          raw values, no number formats
        </span>
      </div>
      <div className="formula-bar">
        <span className="ref mono">{selected?.ref ?? ''}</span>
        <span className="mono muted">{selected?.formula ? 'fx' : ''}</span>
        <span className="mono">
          {selected ? (selected.formula ? `=${selected.formula}` : selected.value) : ''}
        </span>
        {selected?.formula && <span className="muted mono">→ {selected.value}</span>}
      </div>
      {grid.rows.length === 0 ? (
        <div className="empty">This sheet is empty.</div>
      ) : (
        <div className="sheet-scroll">
          <div className="sheet-head" style={{ width: 52 + grid.columnCount * 110 }}>
            <div className="sheet-corner" />
            {columns.map((c) => (
              <div key={c} className="sheet-col">
                {columnName(c)}
              </div>
            ))}
          </div>
          {grid.rows.map((row) => {
            const byCol = new Map(row.cells.map((c) => [c.col, c]));
            return (
              <div key={row.row} className="sheet-row">
                <div className="sheet-rownum">{row.row}</div>
                {columns.map((c) => {
                  const cell = byCol.get(c);
                  const cls = [
                    'sheet-cell',
                    cell?.type === 'number' ? 'num' : '',
                    cell?.type === 'boolean' ? 'bool' : '',
                    cell?.type === 'error' ? 'error' : '',
                    selected && cell && selected.ref === cell.ref ? 'selected' : '',
                  ].join(' ');
                  return (
                    <div
                      key={c}
                      className={cls}
                      title={cell?.formula ? `=${cell.formula}` : cell?.value}
                      onClick={() => cell && setSelected(cell)}
                    >
                      {cell?.value}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {grid.truncated && (
            <div className="banner">
              Showing the first {grid.rows.length.toLocaleString()} rows and {grid.columnCount}{' '}
              columns of {grid.rowCount.toLocaleString()} rows. Use the Source tab for everything.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Word document
// ---------------------------------------------------------------------------------------------

function DocPreview({ tab, part, version }: Props) {
  const { model } = tab;
  const content = useMemo(() => readDocument(model, part), [model, part, version]);
  return (
    <div className="preview">
      <div className="preview-toolbar">
        <span className="muted small">
          Text outline — fonts, images and layout are not rendered.
        </span>
        <span className="spacer" />
        <button
          className="btn-ghost"
          onClick={() => void copyText(readDocumentText(model, part), 'Text copied')}
        >
          <Copy size={14} /> Copy text
        </button>
      </div>
      <div className="doc-preview">
        <div className="doc-page">
          {content.blocks.map((b, i) => {
            if (b.type === 'table') {
              return (
                <table key={i}>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            }
            const level = b.headingLevel ? Math.min(b.headingLevel, 6) : 0;
            const style = b.style && !level ? <span className="doc-style">{b.style}</span> : null;
            if (level) {
              const H = `h${level}` as 'h1';
              return <H key={i}>{b.text || ' '}</H>;
            }
            return (
              <p key={i} className={b.list ? 'li' : ''}>
                {style}
                {b.text}
              </p>
            );
          })}
          {content.truncated && (
            <p className="muted">
              … (preview limited to the first {content.blocks.length.toLocaleString()} blocks)
            </p>
          )}
          {content.blocks.length === 0 && <p className="muted">The document body is empty.</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Slide
// ---------------------------------------------------------------------------------------------

const EMU_PER_PT = 12700;

function useImageUrls(tab: DocTab, parts: string[]): Record<string, string> {
  const key = parts.join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    const next: Record<string, string> = {};
    for (const p of parts) {
      if (!tab.model.has(p) || !isPreviewableImage(p)) continue;
      const bytes = tab.model.getBytes(p);
      if (!isMetafile(p)) {
        made.push((next[p] = nativeImageUrl(p, bytes)));
        continue;
      }
      // EMF/WMF are converted to SVG, which takes a moment: the picture fills in when ready.
      void imageUrl(p, bytes).then((u) => {
        if (!u) return;
        if (!live) return URL.revokeObjectURL(u);
        made.push(u);
        setUrls((cur) => ({ ...cur, [p]: u }));
      });
    }
    setUrls(next);
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [tab.model, key]);
  return urls;
}

function SlidePreview({ tab, part, version }: Props) {
  const { model } = tab;
  const slides = useMemo(() => listSlides(model), [model, version]);
  const slide = useMemo(() => readSlide(model, part), [model, part, version]);
  const images = useImageUrls(
    tab,
    slide.shapes.flatMap((s) => (s.imagePart ? [s.imagePart] : [])),
  );
  const idx = slides.findIndex((s) => s.part === part);
  const { width, height } = slide.size;
  const go = (delta: number): void => {
    const target = slides[idx + delta];
    if (target) navigate(tab.id, { part: target.part });
  };

  const shapeStyle = (s: SlideShape): React.CSSProperties => ({
    left: `${(s.x / width) * 100}%`,
    top: `${(s.y / height) * 100}%`,
    width: `${(s.cx / width) * 100}%`,
    height: `${(s.cy / height) * 100}%`,
    fontSize: `${(((s.fontSizePt ?? (s.placeholder === 'title' || s.placeholder === 'ctrTitle' ? 32 : 18)) * EMU_PER_PT) / width) * 100}cqw`,
    transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined,
  });

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <button
          className="icon-btn"
          disabled={idx <= 0}
          onClick={() => go(-1)}
          aria-label="Previous slide"
        >
          <ChevronLeft size={16} />
        </button>
        <span>{idx >= 0 ? `Slide ${idx + 1} of ${slides.length}` : 'Slide'}</span>
        <button
          className="icon-btn"
          disabled={idx < 0 || idx >= slides.length - 1}
          onClick={() => go(1)}
          aria-label="Next slide"
        >
          <ChevronRight size={16} />
        </button>
        <span className="muted small">
          {idx >= 0 && slides[idx].title ? `· ${slides[idx].title}` : ''}
        </span>
        <span className="spacer" />
        <span className="muted small">Simplified rendering: positions and text only.</span>
      </div>
      <div className="slide-stage">
        <div className="slide" style={{ aspectRatio: `${width} / ${height}` }}>
          {slide.shapes.map((s, i) => (
            <div key={i} className={`slide-shape ${s.kind}`} style={shapeStyle(s)} title={s.name}>
              {s.kind === 'picture' &&
                (s.imagePart && images[s.imagePart] ? (
                  <img src={images[s.imagePart]} alt={s.name} />
                ) : (
                  <div className="ph">{s.name || 'Picture'}</div>
                ))}
              {s.kind === 'chart' && <div className="ph">{s.name || 'Chart'}</div>}
              {s.kind === 'text' && s.paragraphs.map((p, j) => <p key={j}>{p || ' '}</p>)}
              {s.kind === 'table' && (
                <table>
                  <tbody>
                    {s.paragraphs.map((row, r) => (
                      <tr key={r}>
                        {row.split(' | ').map((c, k) => (
                          <td key={k}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
        {slide.notes && (
          <div className="slide-notes">
            <b className="muted small">Notes</b>
            <div>{slide.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
