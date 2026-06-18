// History Store — thin orchestration layer.
//
// Responsibilities are now split across:
//   - services/historyParser.ts — pure functions for entry → HistoryItem conversion
//   - services/downloadTracker.ts — localStorage CRUD for downloads and deleted prompts
//   - this file — Zustand state, fetch orchestration, store updates
//
// The store imports the pure helpers and delegates all parsing and
// localStorage work to them.

import { create } from 'zustand';
import { ComfyUIClient, type PrefixMode } from '../services/comfyui';
import { LemonGridClient } from '../services/lemongrid';
import {
  convertEntryToItem,
  convertClusterTaskToItem,
  isHistoryEntrySuccessful,
  buildLocalDownloadsMap,
} from '../services/historyParser';
import {
  loadLocalDownloads as loadDownloadsFromStorage,
  loadDeletedPrompts,
  addLocalDownload as addLocalDownloadToStorage,
  removeLocalDownloadEntry as removeLocalDownloadFromStorage,
  removeDownloadsForPrompt,
  addDeletedPrompt,
  clearAllHistoryStorage,
} from '../services/downloadTracker';
import type { HistoryItem, LocalDownload } from './historyTypes';

// Re-export for backward compatibility (other files import these types from here)
export type { HistoryItem, LocalDownload };

interface HistoryState {
  items: HistoryItem[];
  localDownloads: LocalDownload[];
  isLoading: boolean;
  error: string | null;
  client: ComfyUIClient | null;
  prefixMode?: PrefixMode;

  setClient: (baseUrl: string, prefixMode?: PrefixMode) => void;
  fetchFromComfyUI: () => Promise<void>;
  clusterItems: HistoryItem[];
  fetchFromCluster: (serverUrl: string) => Promise<void>;
  addLocalDownload: (promptId: string, filePath: string) => void;
  removeLocalDownload: (promptId: string, filePath: string) => void;
  deleteItem: (id: string) => void;
  clearAll: () => void;
  loadLocalDownloads: () => void;
  loadFromStorage: () => void;
}

const PAGE_SIZE = 50;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  items: [],
  clusterItems: [],
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
      const localDownloadsMap = buildLocalDownloadsMap(localDownloads);
      const deletedPrompts = loadDeletedPrompts();

      const items = Object.entries(historyData)
        .filter(([promptId]) => !deletedPrompts.has(promptId))
        .filter(([, entry]) => isHistoryEntrySuccessful(entry))
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

  fetchFromCluster: async (serverUrl: string) => {
    set({ isLoading: true, error: null });
    try {
      const client = new LemonGridClient({ serverUrl });

      // Fetch first page to get total count
      const firstPage = await client.getTaskHistory({ page: 1, pageSize: PAGE_SIZE });
      const allTasks = [...firstPage.items];
      const totalPages = Math.ceil(firstPage.total / PAGE_SIZE);
      for (let page = 2; page <= totalPages; page++) {
        const pageResp = await client.getTaskHistory({ page, pageSize: PAGE_SIZE });
        allTasks.push(...pageResp.items);
      }

      const items = allTasks.map((task) => convertClusterTaskToItem(task, client));
      set({ clusterItems: items, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch cluster history';
      console.warn('[historyStore] Cluster history fetch failed:', message);
      set({ isLoading: false });
    }
  },

  addLocalDownload: (promptId: string, filePath: string) => {
    set((state) => {
      const updatedDownloads = addLocalDownloadToStorage(state.localDownloads, promptId, filePath);
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
      const updatedDownloads = removeLocalDownloadFromStorage(state.localDownloads, promptId, filePath);
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
      const updatedDownloads = removeDownloadsForPrompt(state.localDownloads, item.promptId);
      addDeletedPrompt(item.promptId);

      const updatedItems = state.items.filter((i) => i.id !== id);
      return { localDownloads: updatedDownloads, items: updatedItems };
    });
  },

  clearAll: () => {
    clearAllHistoryStorage();
    set({ items: [], localDownloads: [] });
  },

  loadLocalDownloads: () => {
    const downloads = loadDownloadsFromStorage();
    if (downloads.length > 0) {
      set({ localDownloads: downloads });
    }
  },

  loadFromStorage: () => {
    get().loadLocalDownloads();
  },
}));
