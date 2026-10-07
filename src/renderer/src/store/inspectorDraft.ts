import { create } from 'zustand';
import { setAttribute, setElementText } from '@core/xml/edit';
import { mutateElement } from '../lib/edits';
import { getState } from './app';
import { toastError } from './ui';

/** An uncommitted Inspector edit. Plain data, so nothing from the render that typed it is retained. */
export interface InspectorDraft {
  tabId: string;
  part: string;
  path: readonly number[];
  /** Attribute name, or `null` for the element's text. */
  attr: string | null;
  value: string;
  /** Undo-history label. */
  label: string;
}

// Inspector inputs commit on blur. Retain the focused draft so commands and
// native close checks see unsaved input before the model has been updated.
export const useInspectorDraft = create<{ pending: InspectorDraft | null }>(() => ({
  pending: null,
}));

export function setInspectorDraft(draft: InspectorDraft): void {
  useInspectorDraft.setState({ pending: draft });
}

/** Drop the draft of one field (it went back to its stored value, or was cancelled). */
export function clearInspectorDraft(tabId: string, attr: string | null): void {
  const { pending } = useInspectorDraft.getState();
  if (pending?.tabId === tabId && pending.attr === attr)
    useInspectorDraft.setState({ pending: null });
}

export function hasInspectorDraft(tabId: string): boolean {
  return useInspectorDraft.getState().pending?.tabId === tabId;
}

/** Apply the pending draft (of `tabId`, or of any tab) to its document. */
export function commitInspectorDraft(tabId?: string): void {
  const { pending } = useInspectorDraft.getState();
  if (!pending || (tabId && pending.tabId !== tabId)) return;
  useInspectorDraft.setState({ pending: null });
  const tab = getState().tabs.find((t) => t.id === pending.tabId);
  if (tab?.kind !== 'doc') return;
  try {
    mutateElement(tab.model, pending.part, pending.path, pending.label, (doc, el) =>
      pending.attr === null
        ? setElementText(doc, el, pending.value)
        : setAttribute(doc, el, pending.attr, pending.value),
    );
  } catch (e) {
    toastError('Could not apply the edit: ', e);
  }
}
