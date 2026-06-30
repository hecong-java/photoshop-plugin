import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TemplateType, TaskQueueSummary } from '../services/lemongrid';
import { setLockedUrl } from '../services/lemongrid-url';

export interface LemonGridTaskState {
  taskId: string;
  templateId: string;
  templateName: string;
  templateType: TemplateType;
  status: 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  statusLocked: boolean;
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
  refreshTokenExpiresAt: number | null; // Unix timestamp ms
  username: string | null;
  userRole: string | null;
  isConnected: boolean;

  // Remember me
  encryptedPassword: string | null;
  rememberMe: boolean;

  // User-provided server URL override. Higher priority than the built-in
  // PRIMARY/FALLBACK candidates when present. Persisted like the other
  // user-preference fields so it survives across sessions.
  customServerUrl: string | null;

  // Task tracking (transient - not persisted) per D-102
  tasks: Record<string, LemonGridTaskState>;
  clusterOutputImages: ClusterOutputImage[];

  // Global login modal trigger (transient - not persisted)
  showLoginModal: boolean;

  // Boot-time auth restoration gate. Starts false; flipped to true by App.tsx
  // after `loadAuthFromBridge` + `validateStoredAuth` resolve. While false,
  // AuthGuard suppresses the login modal so a fast-restoring session isn't
  // interrupted by a brief "looks disconnected" flash. Once true, normal
  // guard logic applies. Transient - never persisted.
  isAuthReady: boolean;

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
    refreshExpiresIn?: number;
  }, provider?: 'password' | 'dingtalk') => void;
  clearAuth: () => void;
  setConnected: (connected: boolean) => void;
  setServerUrl: (url: string) => void;
  updateTask: (taskId: string, update: Partial<LemonGridTaskState>) => void;
  removeTask: (taskId: string) => void;
  setEncryptedPassword: (pwd: string | null) => void;
  setRememberMe: (enabled: boolean) => void;
  setCustomServerUrl: (url: string | null) => void;
  addClusterOutputImage: (image: ClusterOutputImage) => void;
  clearClusterOutputImages: () => void;
  setShowLoginModal: (show: boolean) => void;
  setAuthReady: (ready: boolean) => void;
  setQueueSummary: (summary: TaskQueueSummary | null) => void;
  setAuthProvider: (provider: 'password' | 'dingtalk' | null) => void;
}

function createDefaultTaskState(taskId: string): LemonGridTaskState {
  return {
    taskId,
    templateId: '',
    templateName: '',
    templateType: 'COMFYUI',
    status: 'PENDING',
    statusLocked: false,
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
  };
}

function areTaskFieldValuesEqual(previousValue: unknown, nextValue: unknown): boolean {
  if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
    return previousValue.length === nextValue.length
      && previousValue.every((value, index) => Object.is(value, nextValue[index]));
  }

  return Object.is(previousValue, nextValue);
}

export const useLemonGridStore = create<LemonGridState>()(
  persist(
    (set) => ({
      // Auth defaults
      serverUrl: '',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      username: null,
      userRole: null,
      isConnected: false,

      // Remember me defaults
      encryptedPassword: null,
      rememberMe: false,

      // User-provided server URL override (default: none).
      customServerUrl: null,

      // Task tracking defaults
      tasks: {},
      clusterOutputImages: [],

      // Global login modal defaults
      showLoginModal: false,

      // Auth restoration hasn't run yet on cold boot
      isAuthReady: false,

      // Queue summary defaults
      queueSummary: null,

      // Auth provider tracking per D-13
      authProvider: null,

      // Actions
      setAuth: (data, provider) => {
        set({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken ?? null,
          tokenExpiresAt: Date.now() + data.expiresIn * 1000,
          refreshTokenExpiresAt: data.refreshExpiresIn
            ? Date.now() + data.refreshExpiresIn * 1000
            : null,
          username: data.username,
          userRole: data.role,
          isConnected: true,
          authProvider: provider ?? 'password',
        });
        import('../services/lemongrid-auth').then(m => m.startTokenRefreshTimer());
      },

      clearAuth: () => {
        import('../services/lemongrid-auth').then(m => m.stopTokenRefreshTimer());
        set({
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          userRole: null,
          isConnected: false,
          // Deliberately NOT clearing encryptedPassword / rememberMe / username /
          // serverUrl / customServerUrl here — those are user preferences,
          // not session state. Clearing encryptedPassword on logout would
          // defeat the whole point of "记住密码" since clearAuth is invoked
          // on every manual logout. Same goes for customServerUrl — the
          // user's manual server override should survive logout.
          authProvider: null,
          tasks: {},
          clusterOutputImages: [],
        });
      },

      setConnected: (connected) => set({ isConnected: connected }),

      setServerUrl: (url) => {
        const normalized = url.trim().replace(/\/+$/, '');
        // Keep the URL failover module in sync so subsequent requests
        // route to the same server the user has selected.
        setLockedUrl(normalized);
        set({ serverUrl: normalized });
      },

      updateTask: (taskId, update) =>
        set((state) => {
          const currentTask = state.tasks[taskId];
          const baseTask = currentTask || createDefaultTaskState(taskId);
          const normalizedUpdate: Partial<LemonGridTaskState> = { ...update };

          if (
            baseTask.statusLocked
            && typeof normalizedUpdate.status === 'string'
            && normalizedUpdate.status !== baseTask.status
          ) {
            delete normalizedUpdate.status;
          }

          if (
            baseTask.statusLocked
            && normalizedUpdate.statusLocked === false
          ) {
            delete normalizedUpdate.statusLocked;
          }

          const hasChanges = !currentTask || Object.entries(normalizedUpdate).some(([key, value]) => (
            !areTaskFieldValuesEqual(baseTask[key as keyof LemonGridTaskState], value)
          ));

          if (!hasChanges) {
            return state;
          }

          return {
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...baseTask,
                ...normalizedUpdate,
              },
            },
          };
        }),

      removeTask: (taskId) =>
        set((state) => {
          const { [taskId]: _, ...rest } = state.tasks;
          return { tasks: rest };
        }),

      setEncryptedPassword: (pwd) => set({ encryptedPassword: pwd }),

      setRememberMe: (enabled) => set({ rememberMe: enabled }),

      setCustomServerUrl: (url) => {
        // Trim trailing slashes and normalize empty strings to null so the
        // server-URL module treats "user cleared the field" the same as
        // "user never set a field" (falls back to PRIMARY/FALLBACK).
        const normalized = typeof url === 'string' && url.trim()
          ? url.trim().replace(/\/+$/, '')
          : null;
        set({ customServerUrl: normalized });
      },

      addClusterOutputImage: (image) =>
        set((state) => ({
          clusterOutputImages: [...state.clusterOutputImages, image],
        })),

      clearClusterOutputImages: () => set({ clusterOutputImages: [] }),

      setShowLoginModal: (show) => set({ showLoginModal: show }),

      setAuthReady: (ready) => set({ isAuthReady: ready }),

      setQueueSummary: (summary) => set({ queueSummary: summary }),

      setAuthProvider: (provider) => set({ authProvider: provider }),
    }),
    {
      name: 'LemonGrid-lemongrid',
      version: 4,
      migrate: (persistedState: unknown, version: number) => {
        const persisted = (persistedState ?? {}) as Record<string, unknown>;
        if (version === 0) {
          return {
            serverUrl: '',
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            refreshTokenExpiresAt: null,
            username: null,
            userRole: null,
            encryptedPassword: null,
            rememberMe: false,
          };
        }
        if (version === 1) {
          return {
            ...persisted,
            refreshTokenExpiresAt: null,
            authProvider: persisted.encryptedPassword ? 'password' : null,
          };
        }
        if (version === 2) {
          return {
            ...persisted,
            refreshTokenExpiresAt: null,
          };
        }
        if (version === 3) {
          return {
            ...persisted,
            customServerUrl: null,
          };
        }
        return persisted;
      },
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        refreshTokenExpiresAt: state.refreshTokenExpiresAt,
        username: state.username,
        userRole: state.userRole,
        encryptedPassword: state.encryptedPassword,
        rememberMe: state.rememberMe,
        customServerUrl: state.customServerUrl,
        authProvider: state.authProvider,
      }),
    }
  )
);
