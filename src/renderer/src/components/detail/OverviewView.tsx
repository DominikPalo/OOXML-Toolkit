import { useMemo } from 'react';
import { CheckCircle2, FolderSearch, GitCompare, ShieldCheck, TriangleAlert } from 'lucide-react';
import { baseName, partKind } from '@core/package/kinds';
import { contentTypeOf } from '@core/package/opc';
import { formatBytes } from '@core/text';
import { odfOverviewRows, packageCheckSummary, readOdfMeta } from '@core/package/odf';
import { host } from '../../host';
import { getAnalysis, useModelVersion } from '../../store/app';
import {
  compareWithFile,
  navigate,
  reviewChanges,
  runValidation,
  showSidebar,
} from '../../store/actions';
import { formatDate } from '../../lib/describe';
import type { DocTab } from '../../store/types';
import { DocBadge, PartIcon } from '../common/Icons';

const CORE_FIELDS: Array<[string, string]> = [
  ['title', 'Title'],
  ['subject', 'Subject'],
  ['creator', 'Author'],
  ['keywords', 'Keywords'],
  ['description', 'Comments'],
  ['lastModifiedBy', 'Last modified by'],
  ['revision', 'Revision'],
  ['created', 'Created'],
  ['modified', 'Modified'],
];
const APP_FIELDS: Array<[string, string]> = [
  ['Application', 'Application'],
  ['AppVersion', 'Version'],
  ['Company', 'Company'],
  ['Pages', 'Pages'],
  ['Words', 'Words'],
  ['Slides', 'Slides'],
  ['Notes', 'Notes'],
  ['TotalTime', 'Editing time (min)'],
];

/** ISO timestamps become readable dates; everything else is shown as it is. */
function displayValue(text: string): string {
  if (!/^\d{4}-\d\d-\d\dT/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : formatDate(date);
}

function readProps(
  tab: DocTab,
  part: string,
  fields: Array<[string, string]>,
): Array<[string, string]> {
  if (!tab.model.has(part)) return [];
  const { doc } = tab.model.getXml(part);
  if (!doc) return [];
  const out: Array<[string, string]> = [];
  for (const [local, label] of fields) {
    const el = doc.root.elements.find((e) => e.local === local);
    if (!el) continue;
    const text = doc.source
      .slice(el.startTagEnd, el.closeStart === -1 ? el.startTagEnd : el.closeStart)
      .trim();
    if (!text) continue;
    out.push([label, displayValue(text)]);
  }
  return out;
}

export function OverviewView({ tab }: { tab: DocTab }) {
  const version = useModelVersion(tab.model);
  const { model } = tab;
  const analysis = getAnalysis(model);
  const names = model.names();

  const stats = useMemo(() => {
    let total = 0;
    let xml = 0;
    let media = 0;
    const sizes: Array<{ name: string; size: number }> = [];
    for (const n of names) {
      const size = model.size(n);
      total += size;
      sizes.push({ name: n, size });
      const kind = partKind(n, contentTypeOf(analysis.contentTypes, n));
      if (kind === 'xml' || kind === 'rels') xml++;
      else if (kind === 'image') media++;
    }
    sizes.sort((a, b) => b.size - a.size);
    return { total, xml, media, largest: sizes.slice(0, 8) };
  }, [model, version, analysis]);

  const odf = useMemo(() => {
    if (analysis.type.family !== 'odf') return undefined;
    const meta = readOdfMeta(model);
    return meta ? odfOverviewRows(meta, analysis.type.extension) : undefined;
  }, [model, analysis, version]);
  const core = odf
    ? odf.properties.map(([k, v]): [string, string] => [k, displayValue(v)])
    : readProps(tab, 'docProps/core.xml', CORE_FIELDS);
  const app = odf ? odf.application : readProps(tab, 'docProps/app.xml', APP_FIELDS);
  const changed = model.changedParts();
  const { problems } = tab;
  const errors = problems.items.filter((p) => p.severity === 'error').length;
  const warnings = problems.items.filter((p) => p.severity === 'warning').length;
  const stale = problems.status === 'done' && problems.atVersion !== version;
  const max = stats.largest[0]?.size || 1;

  return (
    <div className="pad overview">
      <header className="ov-head">
        <DocBadge family={analysis.type.family} size={44} />
        <div>
          <h1>{tab.name}</h1>
          <p className="muted">
            {analysis.type.label}
            {analysis.type.extension && ` (.${analysis.type.extension})`}
            {tab.path && <span className="mono"> · {tab.path}</span>}
          </p>
        </div>
        <span className="spacer" />
        {tab.path && host.kind !== 'web' && (
          <button className="btn" onClick={() => void host.revealInFolder(tab.path!)}>
            <FolderSearch size={14} /> Reveal
          </button>
        )}
        <button className="btn" onClick={() => void compareWithFile(tab.id)}>
          <GitCompare size={14} /> Compare…
        </button>
      </header>

      <div className="stat-row">
        <div className="stat">
          <b>{names.length.toLocaleString()}</b>
          <span>parts</span>
        </div>
        <div className="stat">
          <b>{stats.xml.toLocaleString()}</b>
          <span>XML parts</span>
        </div>
        <div className="stat">
          <b>{stats.media.toLocaleString()}</b>
          <span>images</span>
        </div>
        <div className="stat">
          <b>{formatBytes(stats.total)}</b>
          <span>uncompressed</span>
        </div>
        <div className={`stat ${changed.length ? 'warn' : ''}`}>
          <b>{changed.length}</b>
          <span>unsaved change{changed.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {changed.length > 0 && (
        <section>
          <h3>Unsaved changes</h3>
          <div className="chips">
            {changed.slice(0, 12).map((c) => (
              <button
                key={c.name}
                className="chip clickable"
                onClick={() =>
                  model.has(c.name) && navigate(tab.id, { part: c.name }, { sidebar: false })
                }
              >
                <span className={`dot ${c.status}`} /> {baseName(c.name)}
              </button>
            ))}
            {changed.length > 12 && <span className="chip">+{changed.length - 12} more</span>}
          </div>
          <div className="actions">
            <button className="btn" onClick={() => reviewChanges(tab.id)}>
              <GitCompare size={14} /> Review changes
            </button>
          </div>
        </section>
      )}

      <div className="cols">
        <section>
          <h3>Package check</h3>
          {problems.status === 'idle' && (
            <p className="muted">{packageCheckSummary(analysis.type.family)}</p>
          )}
          {problems.status === 'running' && <p className="muted">Checking…</p>}
          {problems.status === 'done' && (
            <p className={errors ? 'ic-error' : warnings ? 'ic-warn' : 'ic-ok'}>
              {errors === 0 && warnings === 0 ? (
                <CheckCircle2 size={15} className="inline-ic" />
              ) : (
                <TriangleAlert size={15} className="inline-ic" />
              )}{' '}
              {errors === 0 && warnings === 0
                ? 'No problems found.'
                : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`}
              {stale && <span className="muted"> (outdated — package changed)</span>}
            </p>
          )}
          <div className="actions">
            <button
              className="btn"
              onClick={() => void runValidation(tab.id)}
              disabled={problems.status === 'running'}
            >
              <ShieldCheck size={14} /> {problems.status === 'idle' ? 'Run check' : 'Check again'}
            </button>
            {problems.status === 'done' && (
              <button className="btn" onClick={() => showSidebar('problems')}>
                Show details
              </button>
            )}
          </div>
        </section>

        <section>
          <h3>Largest parts</h3>
          <div className="bars">
            {stats.largest.map((p) => (
              <button
                key={p.name}
                className="bar-row"
                onClick={() => navigate(tab.id, { part: p.name }, { sidebar: false })}
                title={p.name}
              >
                <span className="bar-label">
                  <PartIcon
                    kind={partKind(p.name, contentTypeOf(analysis.contentTypes, p.name))}
                    size={13}
                  />{' '}
                  {baseName(p.name)}
                </span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ width: `${Math.max(2, (p.size / max) * 100)}%` }}
                  />
                </span>
                <span className="bar-size">{formatBytes(p.size)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {(core.length > 0 || app.length > 0) && (
        <div className="cols">
          {core.length > 0 && (
            <section>
              <h3>Document properties</h3>
              <dl className="kv wide">
                {core.map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {app.length > 0 && (
            <section>
              <h3>Application</h3>
              <dl className="kv wide">
                {app.map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      {analysis.mainPart && (
        <section>
          <h3>Main part</h3>
          <button
            className="chip clickable mono"
            onClick={() => navigate(tab.id, { part: analysis.mainPart }, { sidebar: false })}
          >
            {analysis.mainPart}
          </button>
        </section>
      )}
    </div>
  );
}
