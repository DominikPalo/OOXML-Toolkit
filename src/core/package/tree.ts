/** Folder structure of a package's parts, for the "Parts" tree. */

export interface FolderNode {
  /** Folder name (last path segment); empty for the root. */
  name: string;
  /** Full path with a trailing slash; empty for the root. */
  path: string;
  folders: FolderNode[];
  /** Full part names of the files directly inside this folder. */
  parts: string[];
}

const FIRST_FILES = ['[Content_Types].xml'];
const FIRST_FOLDERS = ['_rels', 'docProps', 'customXml'];

function cmp(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function rank(list: string[], name: string): number {
  const i = list.indexOf(name);
  return i === -1 ? list.length : i;
}

export function buildFolderTree(names: readonly string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], parts: [] };
  const index = new Map<string, FolderNode>([['', root]]);

  const folderFor = (path: string): FolderNode => {
    const hit = index.get(path);
    if (hit) return hit;
    const trimmed = path.slice(0, -1);
    const slash = trimmed.lastIndexOf('/');
    const parent = folderFor(slash === -1 ? '' : trimmed.slice(0, slash + 1));
    const node: FolderNode = { name: trimmed.slice(slash + 1), path, folders: [], parts: [] };
    parent.folders.push(node);
    index.set(path, node);
    return node;
  };

  for (const name of names) {
    const slash = name.lastIndexOf('/');
    folderFor(slash === -1 ? '' : name.slice(0, slash + 1)).parts.push(name);
  }

  const sort = (f: FolderNode): void => {
    f.folders.sort(
      (a, b) => rank(FIRST_FOLDERS, a.name) - rank(FIRST_FOLDERS, b.name) || cmp(a.name, b.name),
    );
    f.parts.sort((a, b) => rank(FIRST_FILES, a) - rank(FIRST_FILES, b) || cmp(a, b));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** Collapse folders that contain exactly one sub-folder and no parts (`a/b/c` shown as one row). */
export function folderLabel(f: FolderNode): { label: string; node: FolderNode } {
  let node = f;
  let label = f.name;
  while (node.parts.length === 0 && node.folders.length === 1) {
    node = node.folders[0];
    label += '/' + node.name;
  }
  return { label, node };
}
