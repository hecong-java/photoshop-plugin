import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PSImportMode = 'pixel' | 'smartObject';

export interface DashScopeSettings {
  apiKey: string;
  model: string;
}

export interface ComfyUISettings {
  baseUrl: string;
  isConnected: boolean;
  lastChecked: string | null;
  prefixMode: 'api' | 'oss' | null;
  capabilities: {
    canGenerate: boolean;
    canUpload: boolean;
    canListWorkflows: boolean;
    canReadWorkflows: boolean;
  } | null;
}

interface SettingsState {
  theme: 'light' | 'dark';
  autoSave: boolean;
  psImportMode: PSImportMode;
  comfyUI: ComfyUISettings;
  dashScope: DashScopeSettings;
  setTheme: (theme: 'light' | 'dark') => void;
  setAutoSave: (enabled: boolean) => void;
  setPsImportMode: (mode: PSImportMode) => void;
  setComfyUIBaseUrl: (url: string) => void;
  setComfyUIConnected: (connected: boolean, prefixMode?: 'api' | 'oss', capabilities?: ComfyUISettings['capabilities']) => void;
  setDashScopeApiKey: (apiKey: string) => void;
  setDashScopeModel: (model: string) => void;
}

const DEFAULT_COMFYUI_SETTINGS: ComfyUISettings = {
  baseUrl: 'http://192.168.0.50:8188',
  isConnected: false,
  lastChecked: null,
  prefixMode: null,
  capabilities: null,
};

const DEFAULT_DASHSCOPE_SETTINGS: DashScopeSettings = {
  apiKey: '',
  model: 'qwen-vl-plus',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      autoSave: true,
      psImportMode: 'pixel',
      comfyUI: DEFAULT_COMFYUI_SETTINGS,
      dashScope: DEFAULT_DASHSCOPE_SETTINGS,
      setTheme: (theme) => set({ theme }),
      setAutoSave: (enabled) => set({ autoSave: enabled }),
      setPsImportMode: (mode) => set({ psImportMode: mode }),
      setComfyUIBaseUrl: (baseUrl) =>
        set((state) => ({
          comfyUI: { ...state.comfyUI, baseUrl, isConnected: false, capabilities: null },
        })),
      setComfyUIConnected: (connected, prefixMode, capabilities) =>
        set((state) => ({
          comfyUI: {
            ...state.comfyUI,
            isConnected: connected,
            lastChecked: new Date().toISOString(),
            prefixMode: prefixMode ?? state.comfyUI.prefixMode,
            capabilities: capabilities ?? state.comfyUI.capabilities,
          },
        })),
      setDashScopeApiKey: (apiKey) =>
        set((state) => ({ dashScope: { ...state.dashScope, apiKey } })),
      setDashScopeModel: (model) =>
        set((state) => ({ dashScope: { ...state.dashScope, model } })),
    }),
    {
      name: 'Ningleai-settings',
      partialize: (state) => ({
        theme: state.theme,
        autoSave: state.autoSave,
        psImportMode: state.psImportMode,
        comfyUI: state.comfyUI,
        dashScope: state.dashScope,
      }),
    }
  )
);
