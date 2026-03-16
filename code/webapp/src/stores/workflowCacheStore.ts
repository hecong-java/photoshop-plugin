import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkflowCacheEntry {
  inputValues: Record<string, string | number | boolean>;
  imageData: Record<string, string>;  // base64 data (without data URL prefix)
  imageFilenames: Record<string, string>;  // ComfyUI uploaded filenames
  lastModified: string;
}

interface WorkflowCacheState {
  caches: Record<string, WorkflowCacheEntry>;
  saveCache: (workflowKey: string, data: {
    inputValues: Record<string, string | number | boolean>;
    imageData: Record<string, string>;
    imageFilenames: Record<string, string>;
  }) => void;
  loadCache: (workflowKey: string) => WorkflowCacheEntry | null;
  clearCache: (workflowKey: string) => void;
  clearAllCaches: () => void;
}

const MAX_CACHED_WORKFLOWS = 20;
const MAX_IMAGE_SIZE = 500 * 1024; // 500KB per image

export const useWorkflowCacheStore = create<WorkflowCacheState>()(
  persist(
    (set, get) => ({
      caches: {},

      saveCache: (workflowKey, data) => {
        set((state) => {
          const newCaches = { ...state.caches };

          // Filter out images that are too large
          const filteredImageData: Record<string, string> = {};
          const filteredImageFilenames: Record<string, string> = {};

          for (const [inputName, base64] of Object.entries(data.imageData)) {
            if (base64.length <= MAX_IMAGE_SIZE) {
              filteredImageData[inputName] = base64;
              if (data.imageFilenames[inputName]) {
                filteredImageFilenames[inputName] = data.imageFilenames[inputName];
              }
            } else {
              console.warn(`[WorkflowCache] Skipping image ${inputName}: size ${Math.round(base64.length / 1024)}KB exceeds limit`);
            }
          }

          newCaches[workflowKey] = {
            inputValues: data.inputValues,
            imageData: filteredImageData,
            imageFilenames: filteredImageFilenames,
            lastModified: new Date().toISOString(),
          };

          // LRU cleanup: remove oldest entries if over limit
          if (Object.keys(newCaches).length > MAX_CACHED_WORKFLOWS) {
            const sortedKeys = Object.keys(newCaches).sort((a, b) => {
              const timeA = new Date(newCaches[a].lastModified).getTime();
              const timeB = new Date(newCaches[b].lastModified).getTime();
              return timeA - timeB;
            });

            const keysToRemove = sortedKeys.slice(0, sortedKeys.length - MAX_CACHED_WORKFLOWS);
            for (const key of keysToRemove) {
              delete newCaches[key];
              console.log(`[WorkflowCache] Removed old cache for: ${key}`);
            }
          }

          return { caches: newCaches };
        });
      },

      loadCache: (workflowKey) => {
        const state = get();
        const cache = state.caches[workflowKey];
        return cache || null;
      },

      clearCache: (workflowKey) => {
        set((state) => {
          const newCaches = { ...state.caches };
          delete newCaches[workflowKey];
          return { caches: newCaches };
        });
      },

      clearAllCaches: () => {
        set({ caches: {} });
      },
    }),
    {
      name: 'Ningleai-workflow-cache',
      partialize: (state) => ({
        caches: state.caches,
      }),
    }
  )
);

// Utility functions for image conversion
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 part after comma
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlobUrl(base64: string, mimeType: string = 'image/png'): string {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('[WorkflowCache] Failed to create blob URL:', error);
    return '';
  }
}
