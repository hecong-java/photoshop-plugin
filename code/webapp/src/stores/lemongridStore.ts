import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TemplateType, TaskQueueSummary } from '../services/lemongrid';

export interface LemonGridTaskState {
  taskId: string;
  templateId: string;
  templateName: string;
  templateType: TemplateType;
  status: 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  progressDetail: string | null;
  queuePosition: number | null;
  etaMinutes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  outputAssetIds: string[];
  submittedAt: number;
  completedAt: number | null;
  durationSeconds: number | null;
  params: Record<string, unknown>;
  thumbnail: string | null;
}

export interface ClusterOutputImage {
  url: string;
  blob: Blob | null;
  filename: string;
  assetId: string;
}

interface LemonGridState {
  // Auth
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null; // Unix timestamp ms
  username: string | null;
  userRole: string | null;
  isConnected: boolean;

  // Remember me
  encryptedPassword: string | null;
  rememberMe: boolean;

  // Task tracking (transient - not persisted) per D-102
  tasks: Record<string, LemonGridTaskState>;
  clusterOutputImages: ClusterOutputImage[];

  // Global login modal trigger (transient - not persisted)
  showLoginModal: boolean;

  // Queue summary state (transient - not persisted)
  queueSummary: TaskQueueSummary | null;

  // Auth provider tracking per D-13
  authProvider: 'password' | 'dingtalk' | null;

  // Actions
  setAuth: (data: {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    username: string;
    role: string;
  }, provider?: 'password' | 'dingtalk') => void;
  clearAuth: () => void;
  setConnected: (connected: boolean) => void;
  setServerUrl: (url: string) => void;
  updateTask: (taskId: string, update: Partial<LemonGridTaskState>) => void;
  removeTask: (taskId: string) => void;
  setEncryptedPassword: (pwd: string | null) => void;
  setRememberMe: (enabled: boolean) => void;
  addClusterOutputImage: (image: ClusterOutputImage) => void;
  clearClusterOutputImages: () => void;
  setShowLoginModal: (show: boolean) => void;
  setQueueSummary: (summary: TaskQueueSummary | null) => void;
  setAuthProvider: (provider: 'password' | 'dingtalk' | null) => void;
}

export const useLemonGridStore = create<LemonGridState>()(
  persist(
    (set) => ({
      // Auth defaults
      serverUrl: '',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      username: null,
      userRole: null,
      isConnected: false,

      // Remember me defaults
      encryptedPassword: null,
      rememberMe: false,

      // Task tracking defaults
      tasks: {},
      clusterOutputImages: [],

      // Global login modal
      showLoginModal: false,

      // Queue summary defaults
      queueSummary: null,

      // Auth provider tracking per D-13
      authProvider: null,

      // Actions
      setAuth: (data, provider) =>
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? null,
          tokenExpiresAt: Date.now() + data.expiresIn * 1000,
          username: data.username,
          userRole: data.role,
          isConnected: true,
          authProvider: provider ?? 'password', // Default to password per D-13
        }),

      clearAuth: () =>
        set({
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          userRole: null,
          isConnected: false,
          encryptedPassword: null,
          authProvider: null,
          tasks: {},
          clusterOutputImages: [],
        }),

      setConnected: (connected) => set({ isConnected: connected }),

      setServerUrl: (url) => set({ serverUrl: url }),

      updateTask: (taskId, update) =>
        set((state) => ({
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...(state.tasks[taskId] || {
                taskId,
                templateId: '',
                templateName: '',
                templateType: 'COMFYUI' as const,
                status: 'PENDING' as const,
                progress: 0,
                progressDetail: null,
                queuePosition: null,
                etaMinutes: null,
                errorCode: null,
                errorMessage: null,
                outputAssetIds: [],
                submittedAt: Date.now(),
                completedAt: null,
                durationSeconds: null,
                params: {},
                thumbnail: null,
              }),
              ...update,
            },
          },
        })),

      removeTask: (taskId) =>
        set((state) => {
          const { [taskId]: _, ...rest } = state.tasks;
          return { tasks: rest };
        }),

      setEncryptedPassword: (pwd) => set({ encryptedPassword: pwd }),

      setRememberMe: (enabled) => set({ rememberMe: enabled }),

      addClusterOutputImage: (image) =>
        set((state) => ({
          clusterOutputImages: [...state.clusterOutputImages, image],
        })),

      clearClusterOutputImages: () => set({ clusterOutputImages: [] }),

      setShowLoginModal: (show) => set({ showLoginModal: show }),

      setQueueSummary: (summary) => set({ queueSummary: summary }),

      setAuthProvider: (provider) => set({ authProvider: provider }),
    }),
    {
      name: 'Ningleai-lemongrid',
      version: 2,
      migrate: (persisted: Record<string, unknown>, version: number) => {
        if (version === 0) {
          return {
            serverUrl: '',
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            username: null,
            userRole: null,
            encryptedPassword: null,
            rememberMe: false,
          };
        }
        if (version === 1) {
          return {
            ...persisted,
            authProvider: persisted.encryptedPassword ? 'password' : null,
          };
        }
        return persisted;
      },
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        username: state.username,
        userRole: state.userRole,
        encryptedPassword: state.encryptedPassword,
        rememberMe: state.rememberMe,
        authProvider: state.authProvider,
      }),
    }
  )
);
