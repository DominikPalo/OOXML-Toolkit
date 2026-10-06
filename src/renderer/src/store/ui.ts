import { getState, setState } from './app';
import type { DialogButton, DialogState, Toast } from './types';

let toastId = 1;

export function toast(kind: Toast['kind'], text: string): void {
  const id = toastId++;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
  setTimeout(() => dismissToast(id), kind === 'error' ? 9000 : 3500);
}

export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function toastError(prefix: string, e: unknown): void {
  toast('error', `${prefix}${e instanceof Error ? e.message : String(e)}`);
}

function open<T extends DialogState>(dialog: T): void {
  setState({ dialog });
}

export function closeDialog(): void {
  setState({ dialog: null });
}

export function confirmDialog(opts: {
  title: string;
  message: string;
  detail?: string[];
  buttons: DialogButton[];
}): Promise<string> {
  return new Promise((resolve) => {
    // A confirm that is still pending is treated as cancelled when replaced.
    const prev = getState().dialog;
    if (prev?.kind === 'confirm') prev.resolve('cancel');
    open({ kind: 'confirm', ...opts, resolve: (v) => (closeDialog(), resolve(v)) });
  });
}

export function promptDialog(opts: {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  confirmLabel?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    open({
      kind: 'prompt',
      ...opts,
      value: opts.value ?? '',
      resolve: (v) => (closeDialog(), resolve(v)),
    });
  });
}

export function insertXmlDialog(
  target: string,
): Promise<{ xml: string; position: 'firstChild' | 'lastChild' | 'before' | 'after' } | undefined> {
  return new Promise((resolve) => {
    open({ kind: 'insertXml', target, resolve: (v) => (closeDialog(), resolve(v)) });
  });
}

export const openDialog = open;
