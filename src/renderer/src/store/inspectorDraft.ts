import { create } from 'zustand';

interface InspectorDraft {
  tabId: string;
  field: string;
  commit: () => void;
}

// Inspector inputs commit on blur. Retain the focused draft so commands and
// native close checks see unsaved input before the model has been updated.
export const useInspectorDraft = create<{ pending: InspectorDraft | null }>(() => ({
  pending: null,
}));

export function setInspectorDraft(tabId: string, field: string, commit: (() => void) | null): void {
  if (commit) useInspectorDraft.setState({ pending: { tabId, field, commit } });
  else {
    const { pending } = useInspectorDraft.getState();
    if (pending?.tabId === tabId && pending.field === field)
      useInspectorDraft.setState({ pending: null });
  }
}

export function commitInspectorDraft(tabId?: string): void {
  const { pending } = useInspectorDraft.getState();
  if (!pending || (tabId && pending.tabId !== tabId)) return;
  useInspectorDraft.setState({ pending: null });
  pending.commit();
}
