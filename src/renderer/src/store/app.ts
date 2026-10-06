import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { PackageModel } from '@core/package/model';
import { analyzePackage, type PackageAnalysis } from '@core/package/opc';
import { DEFAULT_SETTINGS, type AppState, type CompareTab, type DocTab, type Tab } from './types';

export const useApp = create<AppState>(() => ({
  tabs: [],
  activeId: null,
  settings: DEFAULT_SETTINGS,
  history: [],
  bookmarks: [],
  ui: {
    sidebarView: 'explorer',
    sidebarOpen: true,
    sidebarWidth: 320,
    quickOpen: false,
    dragging: false,
  },
  dialog: null,
  toasts: [],
  loaded: false,
}));

export const getState = useApp.getState;
export const setState = useApp.setState;

export function activeTab(state: AppState = getState()): Tab | undefined {
  return state.tabs.find((t) => t.id === state.activeId);
}

export function activeDoc(state: AppState = getState()): DocTab | undefined {
  const t = activeTab(state);
  return t?.kind === 'doc' ? t : undefined;
}

export function updateTab<T extends Tab>(
  id: string,
  patch: Partial<T> | ((tab: T) => Partial<T>),
): void {
  setState((s) => ({
    tabs: s.tabs.map((t) => {
      if (t.id !== id) return t;
      const p = typeof patch === 'function' ? patch(t as T) : patch;
      return { ...t, ...p } as Tab;
    }),
  }));
}

export const updateDoc = (
  id: string,
  patch: Partial<DocTab> | ((t: DocTab) => Partial<DocTab>),
): void => updateTab<DocTab>(id, patch);
export const updateCompare = (
  id: string,
  patch: Partial<CompareTab> | ((t: CompareTab) => Partial<CompareTab>),
): void => updateTab<CompareTab>(id, patch);

/** Re-render when the model changes. Returns the model version. */
export function useModelVersion(model: PackageModel): number {
  return useSyncExternalStore(
    (cb) => model.subscribe(cb),
    () => model.version,
  );
}

const analysisCache = new WeakMap<PackageModel, PackageAnalysis>();

/** Content types / relationships of a package, cached until the package structure changes. */
export function getAnalysis(model: PackageModel): PackageAnalysis {
  const hit = analysisCache.get(model);
  if (hit && hit.structureVersion === model.structureVersion) return hit;
  const fresh = analyzePackage(model, model.structureVersion);
  analysisCache.set(model, fresh);
  return fresh;
}
