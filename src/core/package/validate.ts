/** Structural checks for packages (not a schema validator). */
import type { PackageModel } from './model';
import { partKind } from './kinds';
import {
  CONTENT_TYPES_PART,
  PACKAGE_RELS_PART,
  analyzePackage,
  contentTypeOf,
  sourceOfRels,
} from './opc';
import { XmlParseError } from '../xml/parser';

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  severity: Severity;
  code: string;
  message: string;
  part?: string;
  line?: number;
  column?: number;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export async function validatePackage(
  model: PackageModel,
  onProgress?: (done: number, total: number) => void,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const names = model.names();
  const nameSet = new Set(names);
  const analysis = analyzePackage(model, model.structureVersion);
  const isOpc = nameSet.has(CONTENT_TYPES_PART) || nameSet.has(PACKAGE_RELS_PART);

  if (isOpc) {
    if (!nameSet.has(CONTENT_TYPES_PART)) {
      problems.push({
        severity: 'error',
        code: 'no-content-types',
        message: 'The package has no [Content_Types].xml part.',
      });
    }
    if (!nameSet.has(PACKAGE_RELS_PART)) {
      problems.push({
        severity: 'error',
        code: 'no-package-rels',
        message: 'The package has no _rels/.rels part.',
      });
    } else if (!analysis.mainPart) {
      problems.push({
        severity: 'warning',
        code: 'no-main-part',
        message: 'No "officeDocument" relationship in _rels/.rels points to an existing part.',
        part: PACKAGE_RELS_PART,
      });
    }
  }

  // Case-insensitive duplicates are illegal in OPC.
  const lower = new Map<string, string>();
  for (const n of names) {
    const key = n.toLowerCase();
    const prev = lower.get(key);
    if (prev) {
      problems.push({
        severity: 'error',
        code: 'duplicate-name',
        message: `Part names "${prev}" and "${n}" differ only by case.`,
        part: n,
      });
    } else lower.set(key, n);
  }

  // Well-formedness of every XML part.
  let done = 0;
  let last = performance.now();
  for (const n of names) {
    done++;
    const kind = partKind(n, contentTypeOf(analysis.contentTypes, n));
    if (kind === 'xml' || kind === 'rels') {
      try {
        const { error } = model.getXml(n);
        if (error instanceof XmlParseError) {
          problems.push({
            severity: 'error',
            code: 'malformed-xml',
            message: `Not well-formed XML: ${error.reason}`,
            part: n,
            line: error.line,
            column: error.column,
          });
        }
      } catch (e) {
        problems.push({
          severity: 'error',
          code: 'unreadable',
          message: `Cannot read part: ${(e as Error).message}`,
          part: n,
        });
      }
    }
    if (performance.now() - last > 16) {
      onProgress?.(done, names.length);
      await tick();
      last = performance.now();
    }
  }

  if (isOpc) {
    // Parts without a content type.
    for (const n of names) {
      if (n === CONTENT_TYPES_PART) continue;
      if (!contentTypeOf(analysis.contentTypes, n)) {
        problems.push({
          severity: 'warning',
          code: 'no-content-type',
          message: `No content type is defined for "${n}".`,
          part: n,
        });
      }
    }
    for (const part of analysis.contentTypes.overrides.keys()) {
      if (!nameSet.has(part)) {
        problems.push({
          severity: 'warning',
          code: 'override-missing',
          message: `[Content_Types].xml overrides missing part "${part}".`,
          part: CONTENT_TYPES_PART,
        });
      }
    }

    // Relationships.
    for (const [source, rels] of analysis.relationships) {
      const ids = new Set<string>();
      for (const r of rels) {
        if (ids.has(r.id)) {
          problems.push({
            severity: 'error',
            code: 'duplicate-rel-id',
            message: `Duplicate relationship id "${r.id}".`,
            part: r.relsPart,
          });
        }
        ids.add(r.id);
        if (r.resolved !== undefined && !nameSet.has(r.resolved)) {
          problems.push({
            severity: 'error',
            code: 'dangling-rel',
            message: `Relationship ${r.id} (${r.type.slice(r.type.lastIndexOf('/') + 1)}) targets missing part "${r.resolved}".`,
            part: r.relsPart,
          });
        }
      }
      if (source !== '' && !nameSet.has(source)) {
        problems.push({
          severity: 'warning',
          code: 'rels-without-source',
          message: `Relationships exist for missing part "${source}".`,
          part: analysis.relsParts.find((p) => sourceOfRels(p) === source),
        });
      }
    }

    // Reachability from the package root.
    const reachable = new Set<string>([CONTENT_TYPES_PART]);
    const queue: string[] = [''];
    const seen = new Set<string>();
    while (queue.length) {
      const src = queue.pop()!;
      if (seen.has(src)) continue;
      seen.add(src);
      for (const r of analysis.relationships.get(src) ?? []) {
        if (r.resolved === undefined || !nameSet.has(r.resolved)) continue;
        reachable.add(r.resolved);
        queue.push(r.resolved);
      }
    }
    for (const n of names) {
      if (n.endsWith('.rels') || reachable.has(n)) continue;
      problems.push({
        severity: 'info',
        code: 'orphan',
        message: `"${n}" is not referenced by any relationship.`,
        part: n,
      });
    }
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  return problems.sort((a, b) => order[a.severity] - order[b.severity]);
}
