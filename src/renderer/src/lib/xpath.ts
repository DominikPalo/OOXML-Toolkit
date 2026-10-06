/** XPath 1.0 queries over the XML parts of a package, using the browser's evaluator. */
import { partKind } from '@core/package/kinds';
import { contentTypeOf } from '@core/package/opc';
import type { PackageModel } from '@core/package/model';
import { getAnalysis } from '../store/app';

export interface XPathHit {
  part: string;
  /** Element index path (matches `XmlElement` paths from the core parser). */
  path: number[];
  label: string;
  preview: string;
}

export interface XPathResultSet {
  hits: XPathHit[];
  truncated: boolean;
  partsSearched: number;
  error?: string;
}

const MAX_HITS = 1500;

function pathOf(el: Element): number[] {
  const path: number[] = [];
  for (let e: Element | null = el; e && e.parentElement; e = e.parentElement) {
    path.push(Array.prototype.indexOf.call(e.parentElement.children, e));
  }
  return path.reverse();
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Unprefixed names never match namespaced elements in XPath 1.0, so the root's default namespace is
 * also bound to the prefix `x` (e.g. `//x:row` in a worksheet).
 */
export async function evaluateXPath(
  model: PackageModel,
  expression: string,
  isCancelled: () => boolean,
  onlyPart?: string,
): Promise<XPathResultSet> {
  const result: XPathResultSet = { hits: [], truncated: false, partsSearched: 0 };
  if (!expression.trim()) return result;
  const analysis = getAnalysis(model);
  const parser = new DOMParser();
  let last = performance.now();

  for (const name of onlyPart ? [onlyPart] : model.names()) {
    if (isCancelled()) break;
    const kind = partKind(name, contentTypeOf(analysis.contentTypes, name));
    if (kind !== 'xml' && kind !== 'rels') continue;
    const dom = parser.parseFromString(model.getText(name).text, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length || !dom.documentElement) continue;
    result.partsSearched++;
    const root = dom.documentElement;
    const nsResolver = dom.createNSResolver(root);
    const resolver = (prefix: string | null): string | null =>
      prefix === 'x' && !nsResolver.lookupNamespaceURI('x')
        ? root.namespaceURI
        : nsResolver.lookupNamespaceURI(prefix);
    let snapshot: XPathResult;
    try {
      snapshot = dom.evaluate(
        expression,
        dom,
        resolver,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
    } catch (e) {
      return {
        ...result,
        error:
          e instanceof Error
            ? e.message.replace(/^Failed to execute 'evaluate' on 'Document': /, '')
            : String(e),
      };
    }
    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const node = snapshot.snapshotItem(i)!;
      let el: Element | null = null;
      let label = '';
      let preview = '';
      if (node.nodeType === Node.ELEMENT_NODE) {
        el = node as Element;
        label = `<${el.tagName}>`;
        preview = el.children.length
          ? `${el.children.length} children`
          : (el.textContent ?? '').slice(0, 80);
      } else if (node.nodeType === Node.ATTRIBUTE_NODE) {
        const attr = node as Attr;
        el = attr.ownerElement;
        label = `@${attr.name}`;
        preview = attr.value.slice(0, 80);
      } else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        el = node.parentElement;
        label = 'text()';
        preview = (node.nodeValue ?? '').slice(0, 80);
      }
      if (!el) continue;
      result.hits.push({ part: name, path: pathOf(el), label, preview });
      if (result.hits.length >= MAX_HITS) return { ...result, truncated: true };
    }
    if (performance.now() - last > 16) {
      await tick();
      last = performance.now();
    }
  }
  return result;
}
