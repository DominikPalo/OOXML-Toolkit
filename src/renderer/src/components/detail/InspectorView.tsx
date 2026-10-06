import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Copy,
  CopyPlus,
  FileCode,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteElement,
  duplicateElement,
  insertFragment,
  moveElement,
  removeAttribute,
  setAttribute,
  setElementText,
} from '@core/xml/edit';
import {
  elementAtPath,
  lineColumn,
  lookupNamespace,
  textContent,
  xpathOf,
  type XmlAttr,
  type XmlElement,
} from '@core/xml/parser';
import { navigate, toggleBookmark } from '../../store/actions';
import { insertXmlDialog, toast } from '../../store/ui';
import { mutateElement } from '../../lib/edits';
import { copyText } from '../../lib/clipboard';
import { useApp, useModelVersion } from '../../store/app';
import type { DocTab } from '../../store/types';

const ATTR_NAME = /^[A-Za-z_:][\w:.-]*$/;

/** Attribute / text editor for the selected element. All edits are text splices on the part. */
export function InspectorView({ tab }: { tab: DocTab }) {
  useModelVersion(tab.model);
  const bookmarks = useApp((s) => s.bookmarks);
  const part = tab.selection.part!;
  const path = tab.selection.path!;
  const { doc, error } = tab.model.getXml(part);
  const el = doc && elementAtPath(doc, path);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');

  if (!doc || !el) {
    return (
      <div className="empty">
        {error
          ? `This part is not well-formed XML (${error.reason}).`
          : 'The element no longer exists.'}
      </div>
    );
  }

  const editable = !tab.readOnly;
  const apply = (label: string, build: Parameters<typeof mutateElement>[4]): boolean =>
    mutateElement(tab.model, part, path, label, build);
  const xpath = xpathOf(el);
  const isBookmarked = bookmarks.some(
    (b) => b.fileKey === (tab.path ?? tab.name) && b.part === part && b.xpath === xpath,
  );
  const ns = lookupNamespace(el, el.prefix);
  const startLine = lineColumn(doc.source, el.start).line;
  const endLine = lineColumn(doc.source, el.end).line;

  const declarations = el.attrs.filter((a) => a.name === 'xmlns' || a.name.startsWith('xmlns:'));
  const attrs = el.attrs.filter((a) => !declarations.includes(a));

  const childCounts = new Map<string, number>();
  for (const c of el.elements) childCounts.set(c.name, (childCounts.get(c.name) ?? 0) + 1);

  const commitAttr = (a: XmlAttr, value: string): void => {
    if (value !== a.value) apply(`Set ${a.name}`, (d, e) => setAttribute(d, e, a.name, value));
  };

  const addAttr = (): void => {
    const name = newName.trim();
    if (!ATTR_NAME.test(name))
      return void toast('error', 'Enter a valid attribute name (for example “w:val”).');
    if (el.attrs.some((a) => a.name === name))
      return void toast('error', `The element already has an attribute “${name}”.`);
    if (apply(`Add ${name}`, (d, e) => setAttribute(d, e, name, newValue))) {
      setNewName('');
      setNewValue('');
    }
  };

  const leaf = el.elements.length === 0;
  const text = leaf ? textContent(doc, el) : '';

  return (
    <div className="inspector">
      <section className="insp-head">
        <div className="insp-title">
          <FileCode size={16} className="ic ic-element" />
          <span className="mono big">{el.name}</span>
          {el.selfClosing && <span className="chip">self-closing</span>}
        </div>
        <dl className="kv">
          <dt>XPath</dt>
          <dd className="mono">
            {xpath}{' '}
            <button
              className="icon-btn"
              onClick={() => void copyText(xpath)}
              title="Copy XPath"
              aria-label="Copy XPath"
            >
              <Copy size={13} />
            </button>
          </dd>
          <dt>Namespace</dt>
          <dd className="mono">
            {ns ?? (el.prefix ? `(undeclared prefix “${el.prefix}”)` : '(none)')}
          </dd>
          <dt>Source</dt>
          <dd>
            {startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`} ·{' '}
            {(el.end - el.start).toLocaleString()} characters
          </dd>
        </dl>
        <div className="actions">
          <button
            className="btn"
            disabled={!editable || !el.parent}
            onClick={() => apply(`Duplicate ${el.name}`, (d, e) => duplicateElement(d, e))}
          >
            <CopyPlus size={14} /> Duplicate
          </button>
          <button
            className="btn"
            disabled={!editable || !el.parent || el.index === 0}
            onClick={() => {
              if (apply(`Move ${el.name} up`, (d, e) => moveElement(d, e, -1)))
                navigate(
                  tab.id,
                  { part, path: [...path.slice(0, -1), path[path.length - 1] - 1] },
                  { record: false },
                );
            }}
          >
            <ArrowUp size={14} /> Move up
          </button>
          <button
            className="btn"
            disabled={!editable || !el.parent || el.index >= el.parent.elements.length - 1}
            onClick={() => {
              if (apply(`Move ${el.name} down`, (d, e) => moveElement(d, e, 1)))
                navigate(
                  tab.id,
                  { part, path: [...path.slice(0, -1), path[path.length - 1] + 1] },
                  { record: false },
                );
            }}
          >
            <ArrowDown size={14} /> Move down
          </button>
          <button
            className="btn"
            disabled={!editable}
            onClick={async () => {
              const r = await insertXmlDialog(el.name);
              if (r)
                apply(`Insert into ${el.name}`, (d, e) => insertFragment(d, e, r.position, r.xml));
            }}
          >
            <Plus size={14} /> Insert XML…
          </button>
          <button
            className="btn"
            onClick={() => void copyText(doc.source.slice(el.start, el.end), 'XML copied')}
          >
            <Copy size={14} /> Copy XML
          </button>
          <button
            className={`btn ${isBookmarked ? 'active' : ''}`}
            onClick={() => toggleBookmark(tab.id)}
          >
            <Bookmark size={14} /> {isBookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          <button
            className="btn danger"
            disabled={!editable || !el.parent}
            onClick={() => {
              if (apply(`Delete ${el.name}`, (d, e) => deleteElement(d, e)))
                navigate(tab.id, { part, path: path.slice(0, -1) }, { record: false });
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </section>

      <section>
        <h3>
          Attributes <span className="count">{attrs.length}</span>
        </h3>
        {attrs.length === 0 && <p className="muted">No attributes.</p>}
        {attrs.length > 0 && (
          <table className="grid">
            <tbody>
              {attrs.map((a) => (
                <tr key={`${a.name}=${a.value}`}>
                  <td className="mono attr-name">{a.name}</td>
                  <td className="attr-value">
                    <input
                      className="input mono"
                      defaultValue={a.value}
                      readOnly={!editable}
                      spellCheck={false}
                      onBlur={(e) => commitAttr(a, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          e.currentTarget.value = a.value;
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </td>
                  <td className="attr-actions">
                    <button
                      className="icon-btn"
                      disabled={!editable}
                      title={`Remove ${a.name}`}
                      aria-label={`Remove ${a.name}`}
                      onClick={() =>
                        apply(`Remove ${a.name}`, (d, e) => removeAttribute(d, e, a.name))
                      }
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editable && (
          <div className="add-attr">
            <input
              className="input mono"
              placeholder="name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              spellCheck={false}
            />
            <input
              className="input mono"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && addAttr()}
            />
            <button className="btn" onClick={addAttr} disabled={!newName.trim()}>
              <Plus size={14} /> Add
            </button>
          </div>
        )}
      </section>

      {declarations.length > 0 && (
        <section>
          <h3>
            Namespace declarations <span className="count">{declarations.length}</span>
          </h3>
          <table className="grid compact">
            <tbody>
              {declarations.map((a) => (
                <tr key={a.name}>
                  <td className="mono attr-name">{a.name}</td>
                  <td className="mono muted">{a.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Content</h3>
        {leaf ? (
          <TextContent
            key={text}
            text={text}
            editable={editable}
            onCommit={(value) =>
              apply(`Edit text of ${el.name}`, (d, e) => setElementText(d, e, value))
            }
          />
        ) : (
          <ChildSummary el={el} counts={childCounts} />
        )}
      </section>
    </div>
  );
}

function TextContent({
  text,
  editable,
  onCommit,
}: {
  text: string;
  editable: boolean;
  onCommit: (value: string) => void;
}) {
  return (
    <textarea
      className="input mono text-area"
      defaultValue={text}
      readOnly={!editable}
      rows={Math.min(10, Math.max(2, text.split('\n').length))}
      spellCheck={false}
      placeholder="(empty)"
      onBlur={(e) => e.currentTarget.value !== text && onCommit(e.currentTarget.value)}
    />
  );
}

function ChildSummary({ el, counts }: { el: XmlElement; counts: Map<string, number> }) {
  return (
    <>
      <p className="muted">
        Contains {el.elements.length.toLocaleString()} child element
        {el.elements.length === 1 ? '' : 's'}. Expand the node in the tree to browse them.
      </p>
      <div className="chips">
        {[...counts].slice(0, 40).map(([name, n]) => (
          <span key={name} className="chip mono">
            {name} <b>×{n}</b>
          </span>
        ))}
      </div>
    </>
  );
}
