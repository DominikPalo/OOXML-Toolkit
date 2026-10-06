/** Applies element-level edits (as text splices) to a part of a package model. */
import type { PackageModel } from '@core/package/model';
import { applyEdits, type TextEdit } from '@core/xml/edit';
import { elementAtPath, type XmlDocument, type XmlElement } from '@core/xml/parser';

export function mutateElement(
  model: PackageModel,
  part: string,
  path: readonly number[],
  label: string,
  build: (doc: XmlDocument, el: XmlElement) => TextEdit | TextEdit[] | undefined,
): boolean {
  const { doc } = model.getXml(part);
  if (!doc) return false;
  const el = elementAtPath(doc, path);
  if (!el) return false;
  const edit = build(doc, el);
  if (!edit) return false;
  const next = applyEdits(doc.source, Array.isArray(edit) ? edit : [edit]);
  if (next === doc.source) return false;
  model.setText(part, next, { label, coalesceKey: undefined });
  return true;
}
