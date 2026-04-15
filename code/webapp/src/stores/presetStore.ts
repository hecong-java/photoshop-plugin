// Zustand store for preset state management
// No persist middleware - filesystem is source of truth

import { create } from 'zustand';
import * as presetService from '../services/preset';
import type { PresetMeta, PresetFile } from '../types/preset';

interface PresetState {
  presets: PresetMeta[];
  selectedPresetName: string | null;
  selectedPresetData: PresetFile | null;
  isLoading: boolean;
  error: string | null;
  lastAppliedInputValues: Record<string, string | number | boolean> | null;
  lastAppliedImageFilenames: Record<string, string> | null;

  loadPresets: (workflowName: string) => Promise<void>;
  selectPreset: (filename: string) => Promise<void>;
  clearSelection: () => void;
  setLastAppliedValues: (inputValues: Record<string, string | number | boolean>, imageFilenames: Record<string, string>) => void;
  hasUnsavedChanges: (currentInputValues: Record<string, string | number | boolean>, currentImageFilenames: Record<string, string>) => boolean;
  clearDirtyState: () => void;
  setError: (error: string | null) => void;
}

export const usePresetStore = create<PresetState>()((set, get) => ({
  presets: [],
  selectedPresetName: null,
  selectedPresetData: null,
  isLoading: false,
  error: null,
  lastAppliedInputValues: null,
  lastAppliedImageFilenames: null,

  loadPresets: async (workflowName: string): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      const presets = await presetService.listPresets(workflowName);
      set({ presets, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load presets';
      set({ error: errorMessage, isLoading: false });
    }
  },

  selectPreset: async (filename: string): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      const data = await presetService.readPreset(filename);
      set({ selectedPresetName: filename, selectedPresetData: data, isLoading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to read preset';
      set({ error: errorMessage, isLoading: false });
    }
  },

  clearSelection: (): void => {
    set({ selectedPresetName: null, selectedPresetData: null });
  },

  setLastAppliedValues: (inputValues: Record<string, string | number | boolean>, imageFilenames: Record<string, string>): void => {
    set({ lastAppliedInputValues: inputValues, lastAppliedImageFilenames: imageFilenames });
  },

  hasUnsavedChanges: (currentInputValues: Record<string, string | number | boolean>, currentImageFilenames: Record<string, string>): boolean => {
    const { lastAppliedInputValues, lastAppliedImageFilenames } = get();

    // No baseline to compare against
    if (!lastAppliedInputValues && !lastAppliedImageFilenames) {
      return false;
    }

    // Compare inputValues
    const allInputKeys = new Set([
      ...Object.keys(lastAppliedInputValues || {}),
      ...Object.keys(currentInputValues),
    ]);
    for (const key of allInputKeys) {
      const applied = (lastAppliedInputValues as Record<string, unknown>)?.[key];
      const current = currentInputValues[key];
      if (applied !== current) return true;
    }

    // Compare imageFilenames
    const allImageKeys = new Set([
      ...Object.keys(lastAppliedImageFilenames || {}),
      ...Object.keys(currentImageFilenames),
    ]);
    for (const key of allImageKeys) {
      const applied = (lastAppliedImageFilenames as Record<string, unknown>)?.[key];
      const current = currentImageFilenames[key];
      if (applied !== current) return true;
    }

    return false;
  },

  clearDirtyState: (): void => {
    set({ lastAppliedInputValues: null, lastAppliedImageFilenames: null });
  },

  setError: (error: string | null): void => {
    set({ error });
  },
}));
