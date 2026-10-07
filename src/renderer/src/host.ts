import type { HostApi } from '@shared/api';
import { createTauriHost, isTauri } from './hostTauri';
import { createWebHost } from './hostWeb';

declare global {
  interface Window {
    host?: HostApi;
  }
}

/** The Electron preload bridge, the Tauri bridge, or a browser implementation. */
export const host: HostApi = window.host ?? (isTauri() ? createTauriHost() : createWebHost());
export const isMac = host.os === 'darwin' || (host.os === 'web' && /Mac/i.test(navigator.platform));
