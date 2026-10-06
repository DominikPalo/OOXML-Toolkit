import { toast } from '../store/ui';

export async function copyText(text: string, message = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('info', message);
  } catch {
    // Fallback for contexts without the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('info', message);
    } catch {
      toast('error', 'Could not copy to the clipboard.');
    } finally {
      ta.remove();
    }
  }
}
