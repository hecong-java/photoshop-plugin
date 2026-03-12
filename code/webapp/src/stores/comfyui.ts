import { create } from 'zustand';
import {
  ComfyUIClient,
  type ComfyUICapabilities,
  type ComfyUIError,
  type ComfyUIWorkflowInfo,
  type ComfyUIQueueStatus,
  isComfyUIError,
  normalizeBaseUrl,
} from '../services/comfyui';

interface ComfyUIStoreState {
  baseUrl: string;
  capabilities: ComfyUICapabilities | null;
  workflows: ComfyUIWorkflowInfo[];
  selectedWorkflowName: string | null;
  selectedWorkflowContent: unknown | null;
  isProbing: boolean;
  isLoadingWorkflows: boolean;
  isLoadingWorkflow: boolean;
  error: ComfyUIError | null;
  queueRunning: ComfyUIQueueStatus['queueRunning'];
  queuePending: ComfyUIQueueStatus['queuePending'];
  isLoadingQueue: boolean;
  setBaseUrl: (url: string) => void;
  clearError: () => void;
  probeEndpoints: () => Promise<ComfyUICapabilities>;
  listWorkflows: () => Promise<ComfyUIWorkflowInfo[]>;
  readWorkflow: (name: string) => Promise<unknown>;
  fetchQueue: () => Promise<ComfyUIQueueStatus>;
}

const toStoreError = (error: unknown): ComfyUIError => {
  if (isComfyUIError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return {
      type: 'unknown',
      message: error.message,
    };
  }
  return {
    type: 'unknown',
    message: 'Unknown ComfyUI error.',
  };
};

const withCorsGuidance = (error: ComfyUIError): ComfyUIError => {
  if (error.type !== 'cors') {
    return error;
  }
  return {
    ...error,
    message:
      `${error.message} ` +
      'Please enable CORS on ComfyUI (for example: --enable-cors-header "*") and retry.',
  };
};

const getClient = (baseUrl: string): ComfyUIClient => {
  return new ComfyUIClient({ baseUrl: normalizeBaseUrl(baseUrl) });
};

export const useComfyUIStore = create<ComfyUIStoreState>((set, get) => ({
  baseUrl: '',
  capabilities: null,
  workflows: [],
  selectedWorkflowName: null,
  selectedWorkflowContent: null,
  isProbing: false,
  isLoadingWorkflows: false,
  isLoadingWorkflow: false,
  error: null,
  queueRunning: [],
  queuePending: [],
  isLoadingQueue: false,

  setBaseUrl: (url) => {
    set({ baseUrl: url, error: null });
  },

  clearError: () => {
    set({ error: null });
  },

  probeEndpoints: async () => {
    set({ isProbing: true, error: null });
    try {
      const { baseUrl } = get();
      const client = getClient(baseUrl);
      const capabilities = await client.probeEndpoints();
      set({ capabilities, isProbing: false });
      return capabilities;
    } catch (error) {
      const storeError = withCorsGuidance(toStoreError(error));
      set({ isProbing: false, error: storeError });
      throw storeError;
    }
  },

  listWorkflows: async () => {
    set({ isLoadingWorkflows: true, error: null });
    try {
      const { baseUrl, capabilities } = get();
      const client = getClient(baseUrl);
      const workflows = await client.listWorkflows(
        capabilities?.prefixMode === 'api' || capabilities?.prefixMode === 'oss'
          ? capabilities.prefixMode
          : undefined
      );
      set({ workflows, isLoadingWorkflows: false });
      return workflows;
    } catch (error) {
      const storeError = withCorsGuidance(toStoreError(error));
      set({ isLoadingWorkflows: false, error: storeError, workflows: [] });
      throw storeError;
    }
  },

  readWorkflow: async (name) => {
    set({ isLoadingWorkflow: true, error: null });
    try {
      const { baseUrl, capabilities } = get();
      const client = getClient(baseUrl);
      const workflow = await client.readWorkflow(
        name,
        capabilities?.prefixMode === 'api' || capabilities?.prefixMode === 'oss'
          ? capabilities.prefixMode
          : undefined
      );
      set({
        selectedWorkflowName: name,
        selectedWorkflowContent: workflow,
        isLoadingWorkflow: false,
      });
      return workflow;
    } catch (error) {
      const storeError = withCorsGuidance(toStoreError(error));
      set({ isLoadingWorkflow: false, error: storeError });
      throw storeError;
    }
  },

  fetchQueue: async () => {
    set({ isLoadingQueue: true, error: null });
    try {
      const { baseUrl, capabilities } = get();
      console.log('[fetchQueue] baseUrl:', baseUrl, 'capabilities:', capabilities);
      const client = getClient(baseUrl);
      const queue = await client.getQueue(
        capabilities?.prefixMode === 'api' || capabilities?.prefixMode === 'oss'
          ? capabilities.prefixMode
          : undefined
      );
      console.log('[fetchQueue] queue result:', queue);
      set({
        queueRunning: queue.queueRunning,
        queuePending: queue.queuePending,
        isLoadingQueue: false,
      });
      return queue;
    } catch (error) {
      console.error('[fetchQueue] error:', error);
      const storeError = withCorsGuidance(toStoreError(error));
      set({ isLoadingQueue: false, error: storeError });
      throw storeError;
    }
  },
}));
