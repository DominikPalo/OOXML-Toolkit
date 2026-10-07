/** Flattens the (lazily expanded) explorer tree into rows for the virtualised list. */
import { baseName, partKind, type PartKind } from '@core/package/kinds';
import type { PartStatus } from '@core/package/model';
import {
  CONTENT_TYPES_PART,
  contentTypeOf,
  shortRelType,
  type PackageAnalysis,
  type Relationship,
} from '@core/package/opc';
import { buildFolderTree, folderLabel, type FolderNode } from '@core/package/tree';
import { ODF_MANIFEST_PART, ODF_MIMETYPE_PART, readManifest } from '@core/package/odf';
import { elementPath, type XmlElement } from '@core/xml/parser';
import { elementHint, type Hint } from './describe';
import type { DocTab } from '../store/types';

export const PAGE_SIZE = 200;

export interface TreeRow {
  id: string;
  depth: number;
  kind: 'root' | 'folder' | 'part' | 'element' | 'rel' | 'more' | 'error' | 'group';
  label: string;
  hint?: Hint;
  part?: string;
  path?: number[];
  folder?: string;
  partKind?: PartKind;
  status?: PartStatus;
  contentType?: string;
  expandable: boolean;
  expanded: boolean;
  rel?: Relationship;
  missing?: boolean;
  external?: boolean;
  cycle?: boolean;
  /** For `more` rows: id of the element whose child limit grows when clicked. */
  moreFor?: string;
  moreCount?: number;
}

export const elementRowId = (part: string, path: readonly number[]): string =>
  `e:${part}#${path.join('/')}`;
export const partRowId = (part: string): string => `p:${part}`;
export const folderRowId = (folder: string): string => `f:${folder}`;

export function buildRows(tab: DocTab, analysis: PackageAnalysis): TreeRow[] {
  return tab.treeMode === 'parts'
    ? buildPartRows(tab, analysis)
    : buildRelationshipRows(tab, analysis);
}

function rootRow(tab: DocTab): TreeRow {
  return {
    id: 'root',
    depth: 0,
    kind: 'root',
    label: tab.name,
    expandable: true,
    expanded: !!tab.expanded.root,
  };
}

function buildPartRows(tab: DocTab, analysis: PackageAnalysis): TreeRow[] {
  const { model, expanded } = tab;
  const rows: TreeRow[] = [rootRow(tab)];
  if (!expanded.root) return rows;

  const walkElement = (
    part: string,
    el: XmlElement,
    depth: number,
    doc: NonNullable<ReturnType<typeof model.getXml>['doc']>,
  ): void => {
    const path = elementPath(el);
    const id = elementRowId(part, path);
    const open = !!expanded[id];
    const expandable = el.elements.length > 0;
    rows.push({
      id,
      depth,
      kind: 'element',
      label: el.name,
      hint: elementHint(doc, el),
      part,
      path,
      expandable,
      expanded: open,
    });
    if (!open || !expandable) return;
    const limit = tab.childLimits[id] ?? PAGE_SIZE;
    const shown = Math.min(limit, el.elements.length);
    for (let i = 0; i < shown; i++) walkElement(part, el.elements[i], depth + 1, doc);
    if (el.elements.length > shown) {
      rows.push({
        id: `${id}…`,
        depth: depth + 1,
        kind: 'more',
        label: `${el.elements.length - shown} more…`,
        expandable: false,
        expanded: false,
        moreFor: id,
        moreCount: el.elements.length - shown,
      });
    }
  };

  const walkPart = (part: string, depth: number): void => {
    const contentType = contentTypeOf(analysis.contentTypes, part);
    const kind = partKind(part, contentType);
    const expandable = kind === 'xml' || kind === 'rels';
    const id = partRowId(part);
    const open = !!expanded[id];
    rows.push({
      id,
      depth,
      kind: 'part',
      label: baseName(part),
      part,
      partKind: kind,
      status: model.status(part),
      contentType,
      expandable,
      expanded: open,
    });
    if (!open || !expandable) return;
    const { doc, error } = model.getXml(part);
    if (doc) walkElement(part, doc.root, depth + 1, doc);
    else if (error) {
      rows.push({
        id: `${id}!`,
        depth: depth + 1,
        kind: 'error',
        label: error.reason,
        part,
        expandable: false,
        expanded: false,
        hint: { kind: 'text', text: `line ${error.line}, col ${error.column}` },
      });
    }
  };

  const walkFolder = (f: FolderNode, depth: number): void => {
    for (const sub of f.folders) {
      const { label, node } = folderLabel(sub);
      const id = folderRowId(node.path);
      const open = !!expanded[id];
      rows.push({
        id,
        depth,
        kind: 'folder',
        label,
        folder: node.path,
        expandable: true,
        expanded: open,
      });
      if (open) walkFolder(node, depth + 1);
    }
    for (const part of f.parts) walkPart(part, depth);
  };

  walkFolder(buildFolderTree(model.names()), 1);
  return rows;
}

/** ODF has no relationships; its parts are described by META-INF/manifest.xml, so list those instead. */
function buildManifestRows(tab: DocTab, analysis: PackageAnalysis): TreeRow[] {
  const { model, expanded } = tab;
  const rows: TreeRow[] = [rootRow(tab)];
  if (!expanded.root) return rows;
  const names = new Set(model.names());
  const kindOf = (part: string): PartKind =>
    partKind(part, contentTypeOf(analysis.contentTypes, part));

  for (const part of [ODF_MIMETYPE_PART, ODF_MANIFEST_PART]) {
    if (!names.has(part)) continue;
    rows.push({
      id: partRowId(part),
      depth: 1,
      kind: 'part',
      label: part,
      part,
      partKind: kindOf(part),
      status: model.status(part),
      expandable: false,
      expanded: false,
    });
  }

  const listed = new Set<string>();
  for (const entry of readManifest(model)?.entries ?? []) {
    if (entry.isDirectory) continue;
    listed.add(entry.fullPath);
    const exists = names.has(entry.fullPath);
    const media = entry.mediaType || 'no media type';
    rows.push({
      id: `man:${entry.fullPath}`,
      depth: 1,
      kind: 'rel',
      label: entry.fullPath,
      hint: { kind: 'attrs', text: entry.encrypted ? `${media} · encrypted` : media },
      // A listed part that does not exist opens the manifest, where the entry is declared.
      part: exists ? entry.fullPath : ODF_MANIFEST_PART,
      partKind: exists ? kindOf(entry.fullPath) : undefined,
      status: exists ? model.status(entry.fullPath) : undefined,
      missing: !exists,
      expandable: false,
      expanded: false,
    });
  }

  const unlisted = [...names]
    .filter((n) => !listed.has(n) && n !== ODF_MIMETYPE_PART && !n.startsWith('META-INF/'))
    .sort();
  if (unlisted.length) {
    const open = !!expanded.orphans;
    rows.push({
      id: 'orphans',
      depth: 1,
      kind: 'group',
      label: `Not in manifest (${unlisted.length})`,
      expandable: true,
      expanded: open,
    });
    if (open) {
      for (const part of unlisted) {
        rows.push({
          id: `orphan:${part}`,
          depth: 2,
          kind: 'part',
          label: part,
          part,
          partKind: kindOf(part),
          status: model.status(part),
          expandable: false,
          expanded: false,
        });
      }
    }
  }
  return rows;
}

function buildRelationshipRows(tab: DocTab, analysis: PackageAnalysis): TreeRow[] {
  if (analysis.type.family === 'odf') return buildManifestRows(tab, analysis);
  const { model, expanded } = tab;
  const rows: TreeRow[] = [rootRow(tab)];
  if (!expanded.root) return rows;
  const names = new Set(model.names());

  if (names.has(CONTENT_TYPES_PART)) {
    rows.push({
      id: partRowId(CONTENT_TYPES_PART),
      depth: 1,
      kind: 'part',
      label: CONTENT_TYPES_PART,
      part: CONTENT_TYPES_PART,
      partKind: 'xml',
      status: model.status(CONTENT_TYPES_PART),
      expandable: false,
      expanded: false,
    });
  }

  const reachable = new Set<string>([CONTENT_TYPES_PART]);
  const addRels = (
    source: string,
    depth: number,
    parentId: string,
    ancestors: ReadonlySet<string>,
  ): void => {
    for (const rel of analysis.relationships.get(source) ?? []) {
      const id = `${parentId}>${rel.id}`;
      const target = rel.resolved;
      const exists = target !== undefined && names.has(target);
      if (exists) reachable.add(target);
      const cycle = exists && ancestors.has(target);
      const expandable = exists && !cycle && (analysis.relationships.get(target)?.length ?? 0) > 0;
      const open = !!expanded[id];
      rows.push({
        id,
        depth,
        kind: 'rel',
        label: exists ? baseName(target) : rel.target,
        hint: { kind: 'attrs', text: `${rel.id} · ${shortRelType(rel.type)}` },
        part: exists ? target : undefined,
        partKind: exists
          ? partKind(target, contentTypeOf(analysis.contentTypes, target))
          : undefined,
        status: exists ? model.status(target) : undefined,
        rel,
        missing: target !== undefined && !exists,
        external: target === undefined,
        cycle,
        expandable,
        expanded: open,
      });
      if (open && expandable) addRels(target, depth + 1, id, new Set([...ancestors, target]));
    }
  };
  addRels('', 1, 'root', new Set());

  // Parts that no relationship chain reaches. Walk everything so the group is accurate even when collapsed.
  const seen = new Set<string>();
  const queue = [''];
  while (queue.length) {
    const src = queue.pop()!;
    if (seen.has(src)) continue;
    seen.add(src);
    for (const rel of analysis.relationships.get(src) ?? []) {
      if (rel.resolved !== undefined && names.has(rel.resolved)) {
        reachable.add(rel.resolved);
        queue.push(rel.resolved);
      }
    }
  }
  const orphans = [...names].filter((n) => !reachable.has(n) && !n.endsWith('.rels')).sort();
  if (orphans.length) {
    const open = !!expanded.orphans;
    rows.push({
      id: 'orphans',
      depth: 1,
      kind: 'group',
      label: `Unreferenced parts (${orphans.length})`,
      expandable: true,
      expanded: open,
    });
    if (open) {
      for (const part of orphans) {
        rows.push({
          id: `orphan:${part}`,
          depth: 2,
          kind: 'part',
          label: part,
          part,
          partKind: partKind(part, contentTypeOf(analysis.contentTypes, part)),
          status: model.status(part),
          expandable: false,
          expanded: false,
        });
      }
    }
  }
  return rows;
}

/** Row ids that must be expanded for `selection` to be visible in parts mode. */
export function ancestorIds(
  part: string | undefined,
  path: readonly number[] | undefined,
  folder?: string,
): string[] {
  const ids = ['root'];
  const addFolders = (name: string, isFolder: boolean): void => {
    const segs = name.split('/').filter(Boolean);
    if (!isFolder) segs.pop();
    let acc = '';
    for (const s of segs) {
      acc += s + '/';
      ids.push(folderRowId(acc));
    }
  };
  if (folder) addFolders(folder, true);
  if (part) {
    addFolders(part, false);
    if (path?.length) {
      ids.push(partRowId(part));
      for (let i = 0; i < path.length; i++) ids.push(elementRowId(part, path.slice(0, i)));
    }
  }
  return ids;
}
