/** Full-text search across package parts and fuzzy part-name matching. */
import type { PartSource } from './package/model';
import { partKind } from './package/kinds';

export interface SearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
}

export interface SearchHit {
  part: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** Offset into the part text. */
  offset: number;
  length: number;
  /** The line (trimmed around the match) with the match position inside it. */
  preview: string;
  previewStart: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True if the hit limit was reached. */
  truncated: boolean;
  partsSearched: number;
  error?: string;
}

const MAX_HITS = 2000;
const MAX_HITS_PER_PART = 300;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function buildMatcher(opts: SearchOptions): RegExp {
  let source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
}

export async function searchPackage(
  src: PartSource,
  opts: SearchOptions,
  isCancelled: () => boolean = () => false,
  contentTypeOf?: (name: string) => string | undefined,
): Promise<SearchResult> {
  const result: SearchResult = { hits: [], truncated: false, partsSearched: 0 };
  if (!opts.query) return result;
  let re: RegExp;
  try {
    re = buildMatcher(opts);
  } catch (e) {
    return { ...result, error: (e as Error).message };
  }

  let last = performance.now();
  for (const name of src.names()) {
    if (isCancelled()) break;
    const kind = partKind(name, contentTypeOf?.(name));
    if (kind !== 'xml' && kind !== 'rels' && kind !== 'text') continue;
    let text: string;
    try {
      text = src.getText(name).text;
    } catch {
      continue;
    }
    result.partsSearched++;
    re.lastIndex = 0;
    let perPart = 0;
    let lineNo = 1;
    let lineStart = 0;
    let scanned = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      // Advance the line counter up to the match.
      for (
        let nl = text.indexOf('\n', scanned);
        nl !== -1 && nl < m.index;
        nl = text.indexOf('\n', scanned)
      ) {
        lineNo++;
        lineStart = nl + 1;
        scanned = nl + 1;
      }
      let lineEnd = text.indexOf('\n', m.index);
      if (lineEnd === -1) lineEnd = text.length;
      const from = Math.max(lineStart, m.index - 50);
      const to = Math.min(lineEnd, m.index + m[0].length + 90);
      result.hits.push({
        part: name,
        line: lineNo,
        column: m.index - lineStart + 1,
        offset: m.index,
        length: m[0].length,
        preview: text.slice(from, to).replace(/\r$/, ''),
        previewStart: m.index - from,
      });
      if (++perPart >= MAX_HITS_PER_PART) break;
      if (result.hits.length >= MAX_HITS) {
        result.truncated = true;
        return result;
      }
    }
    if (perPart >= MAX_HITS_PER_PART) result.truncated = true;
    if (performance.now() - last > 16) {
      await tick();
      last = performance.now();
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Fuzzy matching (quick open)
// ---------------------------------------------------------------------------------------------

/** Subsequence match with bonuses for word starts and contiguous runs. Returns -1 for no match. */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let score = 0;
  let ti = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return -1;
    const prev = t[found - 1];
    const wordStart =
      found === 0 || prev === '/' || prev === '.' || prev === '_' || prev === '-' || prev === ' ';
    run = found === ti && qi > 0 ? run + 1 : 0;
    score += 1 + (wordStart ? 8 : 0) + run * 3 - Math.min(found - ti, 10) * 0.1;
    ti = found + 1;
  }
  // Prefer matches in the file name and shorter paths.
  const base = t.slice(t.lastIndexOf('/') + 1);
  if (base.includes(q)) score += 15;
  return score - t.length * 0.02;
}

export function fuzzyFilter(query: string, items: readonly string[], limit = 100): string[] {
  if (!query) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(query, item) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
