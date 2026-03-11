// Zustand store for configuration state management

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loadPluginConfig, DEFAULT_CONFIG, type PluginConfig } from '../services/config';

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
        const { config } = get();

        // If config is null or nodes array is empty, show all nodes
        if (!config || !config.nodes || config.nodes.length === 0) {
          console.log(`[ConfigStore] shouldDisplayNode("${classType}"): true (no config or empty nodes)`);
          return true;
        }

        // Return true if any node.class_type matches classType
        const result = config.nodes.some((node) => node.class_type === classType);
        console.log(`[ConfigStore] shouldDisplayNode("${classType}"): ${result}`);
        return result;
      },

      getAllowedInputs: (classType: string): string[] | null => {
        const { config } = get();

        // If config is null or nodes array is empty, return null (all inputs)
        if (!config || !config.nodes || config.nodes.length === 0) {
          return null;
        }

        // Find node with matching class_type
        const node = config.nodes.find((n) => n.class_type === classType);

        // If not found, return null (all inputs)
        if (!node) {
          return null;
        }

        // If found and has inputs array, return it
        // If found but no inputs property, return null (all inputs)
        return node.inputs ?? null;
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
      name: 'Ningleai-config',
      partialize: (state) => ({
        config: state.config,
        loadedAt: state.loadedAt,
      }),
    }
  )
);
