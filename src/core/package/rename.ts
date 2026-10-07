import type { PackageModel } from './model';
import {
  analyzePackage,
  CONTENT_TYPES_PART,
  encodePartUri,
  partNameProblem,
  relativeTarget,
  relsPartFor,
  renameOverride,
} from './opc';
import { ODF_MANIFEST_PART, manifestWithRenamedEntry } from './odf';
import { applyEdits, setAttribute } from '../xml/edit';
import { getAttr, tryParseXml } from '../xml/parser';

/** Rename an OPC part together with its relationships, or update an ODF manifest entry. */
export function renamePackagePart(model: PackageModel, from: string, to: string): void {
  if (from === to) return;
  const problem = partNameProblem(to);
  if (problem) throw new Error(problem);
  if (!model.has(from)) throw new Error(`Part "${from}" does not exist.`);
  const taken = (name: string): boolean =>
    model.names().some((n) => n.toLowerCase() === name.toLowerCase());
  if (taken(to)) throw new Error(`Part "${to}" already exists.`);

  const analysis = analyzePackage(model);
  const oldRels = relsPartFor(from);
  const newRels = relsPartFor(to);
  const moveRels = model.has(oldRels);
  if (moveRels && taken(newRels)) throw new Error(`Relationship part "${newRels}" already exists.`);

  // Plan text splices before mutating, using the original resolved targets.
  const updates = new Map<string, string>();
  for (const [source, relationships] of analysis.relationships) {
    const relevant = relationships.filter(
      (r) => r.resolved && (source === from || r.resolved === from),
    );
    if (!relevant.length) continue;
    const relsPart = relevant[0].relsPart;
    const { doc } = model.getXml(relsPart);
    if (!doc) throw new Error(`Cannot update malformed relationships in "${relsPart}".`);
    const edits = [];
    for (const r of relevant) {
      const el = doc.root.elements.find((e) => getAttr(e, 'Id') === r.id);
      if (!el) continue;
      const target = r.resolved === from ? to : r.resolved!;
      const owner = source === from ? to : source;
      const hash = r.target.indexOf('#');
      const fragment = hash === -1 ? '' : r.target.slice(hash);
      const value =
        encodePartUri(r.target.startsWith('/') ? '/' + target : relativeTarget(owner, target)) +
        fragment;
      if (value !== r.target) edits.push(setAttribute(doc, el, 'Target', value));
    }
    if (edits.length) updates.set(relsPart, applyEdits(doc.source, edits));
  }

  const renames = [[from, to], ...(moveRels ? [[oldRels, newRels]] : [])];
  if (model.has(CONTENT_TYPES_PART)) {
    let text = model.getText(CONTENT_TYPES_PART).text;
    for (const [a, b] of renames) {
      // Each splice changes offsets, so parse the latest text before the next one.
      const { doc } = tryParseXml(text);
      if (doc) text = renameOverride(doc, a, b) ?? text;
    }
    if (text !== model.getText(CONTENT_TYPES_PART).text) updates.set(CONTENT_TYPES_PART, text);
  }
  if (analysis.type.family === 'odf' && model.has(ODF_MANIFEST_PART)) {
    let text = model.getText(ODF_MANIFEST_PART).text;
    for (const [a, b] of renames) text = manifestWithRenamedEntry(text, a, b) ?? text;
    if (text !== model.getText(ODF_MANIFEST_PART).text) updates.set(ODF_MANIFEST_PART, text);
  }

  model.transaction(`Rename ${from}`, () => {
    for (const [name, text] of updates)
      model.setText(name, text, { coalesceKey: undefined, label: `Update references in ${name}` });
    model.renamePart(from, to);
    if (moveRels) model.renamePart(oldRels, newRels);
  });
}
