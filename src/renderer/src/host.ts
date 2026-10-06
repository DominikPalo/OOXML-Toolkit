import type { HostApi } from '@shared/api';
import { createWebHost } from './hostWeb';

declare global {
  interface Window {
    host?: HostApi;
  }
}

/** The Electron preload bridge when available, otherwise a browser implementation. */
export const host: HostApi = window.host ?? createWebHost();
export const isMac = host.os === 'darwin' || (host.os === 'web' && /Mac/i.test(navigator.platform));
