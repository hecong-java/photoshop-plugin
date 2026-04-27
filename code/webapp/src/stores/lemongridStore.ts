import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LemonGridTaskState {
  taskId: string;
  templateId: string;
  templateName: string;
  status: 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  progressDetail: string | null;
  queuePosition: number | null;
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

  // Actions
  setAuth: (data: {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    username: string;
    role: string;
  }) => void;
  clearAuth: () => void;
  setConnected: (connected: boolean) => void;
  setServerUrl: (url: string) => void;
  updateTask: (taskId: string, update: Partial<LemonGridTaskState>) => void;
  removeTask: (taskId: string) => void;
  setEncryptedPassword: (pwd: string | null) => void;
  setRememberMe: (enabled: boolean) => void;
  addClusterOutputImage: (image: ClusterOutputImage) => void;
  clearClusterOutputImages: () => void;
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

      // Actions
      setAuth: (data) =>
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? null,
          tokenExpiresAt: Date.now() + data.expiresIn * 1000,
          username: data.username,
          userRole: data.role,
          isConnected: true,
        }),

      clearAuth: () =>
        set({
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          userRole: null,
          isConnected: false,
          encryptedPassword: null,
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
                status: 'PENDING' as const,
                progress: 0,
                progressDetail: null,
                queuePosition: null,
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
    }),
    {
      name: 'Ningleai-lemongrid',
      version: 1,
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
      }),
    }
  )
);
