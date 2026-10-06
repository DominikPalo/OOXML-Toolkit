import { useMemo, useState } from 'react';
import { Search, Tag } from 'lucide-react';
import type { DocumentTags, TagEntry, TagSource } from '@core/package/tags';
import { navigate } from '../../store/actions';
import { truncate } from '../../lib/describe';
import type { DocTab } from '../../store/types';

const FILTER_FROM = 12;
const COLLAPSED_ROWS = 10;

type Column = 'scope' | 'name' | 'value' | 'type';

const matches = (e: TagEntry, q: string): boolean =>
  !q || [e.scope, e.name, e.value, e.type].some((v) => v?.toLowerCase().includes(q));

function TagChips({
  label,
  values,
  source,
  tab,
  q,
}: {
  label: string;
  values: string[];
  source?: TagSource;
  tab: DocTab;
  q: string;
}) {
  const shown = values.filter(
    (v) => !q || v.toLowerCase().includes(q) || label.toLowerCase().includes(q),
  );
  if (!shown.length) return null;
  return (
    <div className="tag-group">
      <h4>{label}</h4>
      <div className="chips">
        {shown.map((v) => (
          <button
            key={v}
            className="chip tag"
            title={source ? `Show in ${source.part}` : undefined}
            onClick={() =>
              source &&
              navigate(
                tab.id,
                { part: source.part, path: source.path },
                { detailTab: 'source', sidebar: false },
              )
            }
          >
            <Tag size={11} /> {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function TagTable({
  title,
  hint,
  entries,
  columns,
  tab,
}: {
  title: string;
  hint: string;
  entries: TagEntry[];
  columns: Column[];
  tab: DocTab;
}) {
  const [all, setAll] = useState(false);
  if (!entries.length) return null;
  const rows = all ? entries : entries.slice(0, COLLAPSED_ROWS);
  const head: Record<Column, string> = {
    scope: 'Applies to',
    name: 'Name',
    value: 'Value',
    type: 'Type',
  };
  return (
    <div className="tag-group">
      <h4>
        {title} <span className="count">{entries.length}</span>
        <span className="muted small tag-hint">{hint}</span>
      </h4>
      <table className="grid compact tag-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{head[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr
              key={`${e.part}:${e.path.join('/')}:${i}`}
              className="clickable"
              title={`Show in ${e.part}`}
              onClick={() =>
                navigate(
                  tab.id,
                  { part: e.part, path: e.path },
                  { detailTab: 'source', sidebar: false },
                )
              }
            >
              {columns.map((c) => (
                <td
                  key={c}
                  className={
                    c === 'name' || c === 'value' ? 'mono wrap-any' : c === 'type' ? 'muted' : ''
                  }
                  title={c === 'value' ? e.value : undefined}
                >
                  {c === 'value' ? truncate(e.value, 300) : (e[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > COLLAPSED_ROWS && (
        <button className="btn-ghost" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * Everything that is attached to the document as metadata: keywords, custom properties,
 * PowerPoint tags and Word document variables. Clicking an item shows it in the XML.
 */
export function TagsSection({ tab, tags }: { tab: DocTab; tags: DocumentTags }) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const filtered = useMemo(
    () => ({
      customProperties: tags.customProperties.filter((e) => matches(e, q)),
      presentationTags: tags.presentationTags.filter((e) => matches(e, q)),
      documentVariables: tags.documentVariables.filter((e) => matches(e, q)),
    }),
    [tags, q],
  );
  const visible =
    (q
      ? tags.keywords.filter((k) => k.toLowerCase().includes(q)).length +
        tags.categories.filter((k) => k.toLowerCase().includes(q)).length
      : tags.keywords.length + tags.categories.length) +
    filtered.customProperties.length +
    filtered.presentationTags.length +
    filtered.documentVariables.length;

  if (tags.total === 0) return null;
  return (
    <section className="tags-section">
      <div className="tags-head">
        <h3>
          Document tags <span className="count">{tags.total}</span>
        </h3>
        {tags.total > FILTER_FROM && (
          <label className="tag-filter">
            <Search size={13} />
            <input
              className="input"
              placeholder="Filter tags"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter tags"
              spellCheck={false}
            />
          </label>
        )}
      </div>

      <TagChips
        label="Keywords"
        values={tags.keywords}
        source={tags.keywordsSource}
        tab={tab}
        q={q}
      />
      <TagChips
        label="Categories"
        values={tags.categories}
        source={tags.categoriesSource}
        tab={tab}
        q={q}
      />
      <TagTable
        title="PowerPoint tags"
        hint="added by add-ins, per presentation and slide"
        entries={filtered.presentationTags}
        columns={['scope', 'name', 'value']}
        tab={tab}
      />
      <TagTable
        title="Custom properties"
        hint="docProps/custom.xml"
        entries={filtered.customProperties}
        columns={['name', 'value', 'type']}
        tab={tab}
      />
      <TagTable
        title="Document variables"
        hint="word/settings.xml"
        entries={filtered.documentVariables}
        columns={['name', 'value']}
        tab={tab}
      />

      {q && visible === 0 && <p className="muted">No tag matches “{filter}”.</p>}
      {tags.truncated && (
        <p className="muted small">
          Only the first tags are listed; open the tag parts in the tree to see the rest.
        </p>
      )}
    </section>
  );
}
