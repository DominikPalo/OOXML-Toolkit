import { create } from 'zustand';

/** Caret position of the focused source editor, shown in the status bar. */
export const useEditorStatus = create<{ line: number; column: number }>(() => ({
  line: 1,
  column: 1,
}));
