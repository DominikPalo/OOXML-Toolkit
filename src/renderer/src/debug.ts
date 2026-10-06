import { host } from './host';
import { openFile } from './store/actions';
import { getState } from './store/app';

/**
 * Development helpers for driving the app from the browser console / automated tests
 * (`window.__ooxml`). Not included in production builds.
 */
export function installDebugHooks(): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as { __ooxml: unknown }).__ooxml = {
    host,
    getState,
    async openUrl(url: string, name = url.split('/').pop() ?? 'file') {
      const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return openFile({ name, data });
    },
  };
}
