import { create } from 'zustand';
import { ComfyUIClient, type ComfyUIHistoryEntry, type PrefixMode } from '../services/comfyui';

export interface HistoryItem {
  id: string;
  promptId: string;
  workflow: string;
  workflowName: string;
  imageName: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
  imageUrl?: string;
  thumbnailUrl?: string; // URL or path, NOT base64
  timestamp: number; // ms since epoch
  status: 'completed' | 'failed' | 'pending';
  localDownloads: string[];
  images: Array<{
    filename: string;
    subfolder?: string;
    type?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
  }>;
}

interface LocalDownload {
  promptId: string;
  filePath: string;
  downloadedAt: number;
}

interface HistoryState {
  items: HistoryItem[];
  localDownloads: LocalDownload[];
  isLoading: boolean;
  error: string | null;
  client: ComfyUIClient | null;
  prefixMode?: PrefixMode;

  setClient: (baseUrl: string, prefixMode?: PrefixMode) => void;
  fetchFromComfyUI: () => Promise<void>;
  addLocalDownload: (promptId: string, filePath: string) => void;
  removeLocalDownload: (promptId: string, filePath: string) => void;
  deleteItem: (id: string) => void;
  clearAll: () => void;
  loadLocalDownloads: () => void;
  loadFromStorage: () => void;
}

const LOCAL_DOWNLOADS_KEY = 'Ningleai-local-downloads';
const DELETED_PROMPTS_KEY = 'Ningleai-deleted-prompts';

const extractExecutionTimestamp = (entry: ComfyUIHistoryEntry): number => {
  const status = entry.status;
  if (!status || typeof status !== 'object') {
    return typeof entry.start_time === 'number' ? entry.start_time * 1000 : Date.now();
  }

  const statusRecord = status as Record<string, unknown>;
  const messages = statusRecord.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!Array.isArray(msg) || msg.length < 2) continue;
      const type = msg[0];
      const payload = msg[1];
      if (type !== 'execution_success' || !payload || typeof payload !== 'object') continue;
      const ts = (payload as Record<string, unknown>).timestamp;
      if (typeof ts === 'number') {
        return ts < 1e12 ? ts * 1000 : ts;
      }
    }
  }

  return typeof entry.start_time === 'number' ? entry.start_time * 1000 : Date.now();
};

const extractHistoryImage = (
  outputs: Record<string, unknown>,
  client: ComfyUIClient
): {
  imageName: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  images: Array<{
    filename: string;
    subfolder?: string;
    type?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
  }>;
} => {
  const images: Array<{
    filename: string;
    subfolder?: string;
    type?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
  }> = [];
  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId] as {
      images?: Array<{ filename: string; subfolder?: string; type?: string }>;
    };
    if (!Array.isArray(nodeOutput.images) || nodeOutput.images.length === 0) {
      continue;
    }

    nodeOutput.images.forEach((image) => {
      if (!image || !image.filename) return;
      const filename = image.filename;
      const subfolder = image.subfolder || '';
      const type = image.type || 'output';
      images.push({
        filename,
        subfolder,
        type,
        thumbnailUrl: client.getViewUrl({
          filename,
          type: type as 'output' | 'input' | 'temp',
          subfolder,
          preview: true,
        }),
        imageUrl: client.getViewUrl({
          filename,
          type: type as 'output' | 'input' | 'temp',
          subfolder,
          preview: false,
        }),
      });
    });
  }

  if (images.length === 0) {
    return { imageName: 'Unknown Image', images };
  }

  const first = images[0];
  const imageName = first.filename || 'Unknown Image';
  const type = (first.type as 'output' | 'input' | 'temp') || 'output';
  const subfolder = first.subfolder || '';

  return {
    imageName,
    thumbnailUrl: client.getViewUrl({
      filename: imageName,
      type,
      subfolder,
      preview: true,
    }),
    imageUrl: client.getViewUrl({
      filename: imageName,
      type,
      subfolder,
      preview: false,
    }),
    images,
  };
};

const isPromptNodesRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return false;
  }

  return entries.some(([, node]) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return false;
    }
    const record = node as Record<string, unknown>;
    return (
      typeof record.class_type === 'string' ||
      typeof record.type === 'string' ||
      (record.inputs && typeof record.inputs === 'object' && !Array.isArray(record.inputs))
    );
  });
};

const extractPromptNodes = (prompt: unknown): Record<string, unknown> => {
  if (isPromptNodesRecord(prompt)) {
    return prompt;
  }

  if (Array.isArray(prompt)) {
    for (const item of prompt) {
      if (isPromptNodesRecord(item)) {
        return item;
      }
    }
  }

  if (prompt && typeof prompt === 'object') {
    const record = prompt as Record<string, unknown>;
    const candidates: unknown[] = [record.prompt, record.workflow, record.nodes];
    for (const candidate of candidates) {
      if (isPromptNodesRecord(candidate)) {
        return candidate;
      }
    }
  }

  return {};
};

const convertEntryToItem = (
  promptId: string,
  entry: ComfyUIHistoryEntry,
  client: ComfyUIClient,
  localDownloads: string[]
): HistoryItem => {
  const outputs = entry.outputs || {};
  const imageInfo = extractHistoryImage(outputs, client);

  // ComfyUI history structure: prompt is a tuple [number, prompt_id, workflow_dict, extra_data, outputs_to_execute, sensitive]
  // - index 2: actual workflow dict (the API format JSON)
  // - index 3: extra_data (contains workflow_name, client_id, etc.)
  const promptTuple = entry.prompt;
  const workflowDict = Array.isArray(promptTuple) && promptTuple.length > 2
    ? promptTuple[2]
    : promptTuple; // fallback for old format
  const extraData = Array.isArray(promptTuple) && promptTuple.length > 3
    ? promptTuple[3]
    : undefined;

  const promptData = extractPromptNodes(workflowDict);
  // Use workflow name from extra_data if available, otherwise fall back to image name
  const hasExtraData = extraData && typeof extraData === 'object';
  const hasWorkflowName = hasExtraData && 'workflow_name' in extraData;
  const extractedWorkflowName = hasExtraData ? (extraData as Record<string, unknown>).workflow_name : undefined;
  const workflowName = hasWorkflowName
    ? String(extractedWorkflowName)
    : imageInfo.imageName;

  // Debug: log workflow name extraction with detailed info
  console.log('[historyStore] Converting entry to item:', {
    promptId,
    isArray: Array.isArray(promptTuple),
    tupleLength: Array.isArray(promptTuple) ? promptTuple.length : 0,
    hasExtraData,
    hasWorkflowName,
    extraDataKeys: hasExtraData ? Object.keys(extraData as Record<string, unknown>) : [],
    extractedWorkflowName,
    finalWorkflowName: workflowName,
    fallbackImageName: imageInfo.imageName,
    isUsingFallback: !hasWorkflowName,
  });

  return {
    id: promptId,
    promptId,
    workflow: promptId,
    workflowName,
    imageName: imageInfo.imageName,
    params: promptData as Record<string, unknown>,
    outputs,
    imageUrl: imageInfo.imageUrl,
    thumbnailUrl: imageInfo.thumbnailUrl,
    images: imageInfo.images,
    timestamp: extractExecutionTimestamp(entry),
    status: 'completed',
    localDownloads,
  };
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
  items: [],
  localDownloads: [],
  isLoading: false,
  error: null,
  client: null,
  prefixMode: undefined,

  setClient: (baseUrl: string, prefixMode?: PrefixMode) => {
    const client = new ComfyUIClient({ baseUrl });
    set({ client, prefixMode });
  },

  fetchFromComfyUI: async () => {
    const { client, localDownloads, prefixMode } = get();
    if (!client) {
      set({ error: 'ComfyUI not configured', items: [] });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const historyData = await client.getHistory(prefixMode);
      const localDownloadsMap = new Map<string, string[]>();
      const deletedPrompts = (() => {
        try {
          const raw = localStorage.getItem(DELETED_PROMPTS_KEY);
          return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
        } catch {
          return new Set<string>();
        }
      })();

      for (const download of localDownloads) {
        const existing = localDownloadsMap.get(download.promptId) || [];
        existing.push(download.filePath);
        localDownloadsMap.set(download.promptId, existing);
      }

      const items = Object.entries(historyData)
        .filter(([promptId]) => !deletedPrompts.has(promptId))
        .filter(([, entry]) => {
          // Filter out error entries - only show successful ones
          return entry.status_str !== 'error';
        })
        .map(([promptId, entry]) =>
          convertEntryToItem(promptId, entry, client, localDownloadsMap.get(promptId) || [])
        )
        .sort((a, b) => b.timestamp - a.timestamp);

      set({ items, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch history';
      set({ error: message, isLoading: false, items: [] });
    }
  },

  addLocalDownload: (promptId: string, filePath: string) => {
    set((state) => {
      const newDownload: LocalDownload = { promptId, filePath, downloadedAt: Date.now() };
      const updatedDownloads = [...state.localDownloads, newDownload];

      try {
        localStorage.setItem(LOCAL_DOWNLOADS_KEY, JSON.stringify(updatedDownloads));
      } catch (e) {
        console.error('Failed to save local downloads:', e);
      }

      const updatedItems = state.items.map((item) =>
        item.promptId === promptId
          ? { ...item, localDownloads: [...item.localDownloads, filePath] }
          : item
      );

      return { localDownloads: updatedDownloads, items: updatedItems };
    });
  },

  removeLocalDownload: (promptId: string, filePath: string) => {
    set((state) => {
      const updatedDownloads = state.localDownloads.filter(
        (d) => !(d.promptId === promptId && d.filePath === filePath)
      );

      try {
        localStorage.setItem(LOCAL_DOWNLOADS_KEY, JSON.stringify(updatedDownloads));
      } catch (e) {
        console.error('Failed to save local downloads:', e);
      }

      const updatedItems = state.items.map((item) =>
        item.promptId === promptId
          ? { ...item, localDownloads: item.localDownloads.filter((p) => p !== filePath) }
          : item
      );

      return { localDownloads: updatedDownloads, items: updatedItems };
    });
  },

  deleteItem: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) {
      return;
    }

    set((state) => {
      const updatedDownloads = state.localDownloads.filter((d) => d.promptId !== item.promptId);
      const deletedPromptIds = (() => {
        try {
          const raw = localStorage.getItem(DELETED_PROMPTS_KEY);
          const ids = raw ? (JSON.parse(raw) as string[]) : [];
          return Array.from(new Set([...ids, item.promptId]));
        } catch {
          return [item.promptId];
        }
      })();

      try {
        localStorage.setItem(LOCAL_DOWNLOADS_KEY, JSON.stringify(updatedDownloads));
        localStorage.setItem(DELETED_PROMPTS_KEY, JSON.stringify(deletedPromptIds));
      } catch (e) {
        console.error('Failed to save local downloads:', e);
      }

      const updatedItems = state.items.filter((i) => i.id !== id);

      return { localDownloads: updatedDownloads, items: updatedItems };
    });
  },

  clearAll: () => {
    try {
      localStorage.removeItem(LOCAL_DOWNLOADS_KEY);
      localStorage.removeItem(DELETED_PROMPTS_KEY);
    } catch (e) {
      console.error('Failed to clear local downloads:', e);
    }
    set({ items: [], localDownloads: [] });
  },

  loadLocalDownloads: () => {
    try {
      const stored = localStorage.getItem(LOCAL_DOWNLOADS_KEY);
      if (stored) {
        const downloads = JSON.parse(stored) as LocalDownload[];
        set({ localDownloads: downloads });
      }
    } catch (e) {
      console.error('Failed to load local downloads:', e);
    }
  },

  loadFromStorage: () => {
    get().loadLocalDownloads();
  },
}));
