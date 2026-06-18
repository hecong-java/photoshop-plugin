// Zustand store for configuration state management

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loadPluginConfig, DEFAULT_CONFIG, type PluginConfig } from '../services/config';
import { shouldDisplayNode, getAllowedInputs } from '../services/configLogic';

interface ConfigState {
  config: PluginConfig | null;
  isLoading: boolean;
  error: string | null;
  loadedAt: string | null;

  // Computed helpers (called as functions, not getters)
  shouldDisplayNode: (classType: string) => boolean;
  getAllowedInputs: (classType: string) => string[] | null;

  // Actions
  loadConfig: () => Promise<void>;
  setConfig: (config: PluginConfig | null) => void;
  clearError: () => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      isLoading: false,
      error: null,
      loadedAt: null,

      shouldDisplayNode: (classType: string): boolean => {
        return shouldDisplayNode(get().config, classType);
      },

      getAllowedInputs: (classType: string): string[] | null => {
        return getAllowedInputs(get().config, classType);
      },

      loadConfig: async (): Promise<void> => {
        console.log('[ConfigStore] loadConfig called');
        set({ isLoading: true, error: null });

        try {
          const config = await loadPluginConfig();
          console.log('[ConfigStore] Config loaded:', JSON.stringify(config, null, 2));
          set({
            config,
            isLoading: false,
            loadedAt: new Date().toISOString(),
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load config';
          console.error('[ConfigStore] Error loading config:', error);
          set({
            error: errorMessage,
            isLoading: false,
            config: DEFAULT_CONFIG, // Fallback to default config
          });
        }
      },

      setConfig: (config: PluginConfig | null): void => {
        set({
          config,
          loadedAt: config ? new Date().toISOString() : null,
        });
      },

      clearError: (): void => {
        set({ error: null });
      },
    }),
    {
      name: 'LemonGrid-config',
      partialize: (state) => ({
        config: state.config,
        loadedAt: state.loadedAt,
      }),
    }
  )
);
