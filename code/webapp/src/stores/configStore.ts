/**
 * Zustand store for configuration state.
 * This is a stub file for TDD - implementation will be added in Wave 2.
 */

import { create } from 'zustand';
import type { PluginConfig, ConfigNode } from '../types/config';

interface ConfigStoreState {
  config: PluginConfig;
  shouldDisplayNode: (classType: string) => boolean;
  getAllowedInputs: (classType: string) => string[] | null;
  loadConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigStoreState>(() => ({
  config: { version: '1.0', nodes: [] },
  shouldDisplayNode: (_classType: string) => true,
  getAllowedInputs: (_classType: string) => null,
  loadConfig: async () => {
    // Placeholder - will be implemented in Wave 2
  },
}));
