// Download Tracker — localStorage CRUD for history-related persistence.
// Extracted from historyStore.ts so the localStorage shape and key strings
// are owned by one focused module. The store calls into here for reads/writes.

import type { LocalDownload } from '../stores/historyTypes';

export const LOCAL_DOWNLOADS_KEY = 'LemonGrid-local-downloads';
export const DELETED_PROMPTS_KEY = 'LemonGrid-deleted-prompts';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Load the list of local downloads from localStorage.
 * Returns an empty array on any error (corrupt JSON, missing key, etc).
 */
export const loadLocalDownloads = (): LocalDownload[] => {
  try {
    const stored = localStorage.getItem(LOCAL_DOWNLOADS_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as LocalDownload[];
  } catch (e) {
    console.error('Failed to load local downloads:', e);
    return [];
  }
};

/**
 * Load the set of deleted prompt IDs from localStorage.
 * Returns an empty set on any error.
 */
export const loadDeletedPrompts = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DELETED_PROMPTS_KEY);
    if (!raw) return new Set();
    return new Set<string>(JSON.parse(raw) as string[]);
  } catch (e) {
    console.error('Failed to load deleted prompts:', e);
    return new Set();
  }
};

// ---------------------------------------------------------------------------
// Writes (return updated state; caller is responsible for store updates)
// ---------------------------------------------------------------------------

/**
 * Add a new local download and persist the updated list.
 * Returns the updated downloads array.
 */
export const addLocalDownload = (
  currentDownloads: LocalDownload[],
  promptId: string,
  filePath: string
): LocalDownload[] => {
  const newDownload: LocalDownload = { promptId, filePath, downloadedAt: Date.now() };
  const updated = [...currentDownloads, newDownload];
  saveLocalDownloads(updated);
  return updated;
};

/**
 * Remove a specific local download and persist the updated list.
 * Returns the updated downloads array.
 */
export const removeLocalDownloadEntry = (
  currentDownloads: LocalDownload[],
  promptId: string,
  filePath: string
): LocalDownload[] => {
  const updated = currentDownloads.filter(
    (d) => !(d.promptId === promptId && d.filePath === filePath)
  );
  saveLocalDownloads(updated);
  return updated;
};

/**
 * Remove all local downloads for a given prompt (used when deleting a history item).
 * Returns the updated downloads array.
 */
export const removeDownloadsForPrompt = (
  currentDownloads: LocalDownload[],
  promptId: string
): LocalDownload[] => {
  const updated = currentDownloads.filter((d) => d.promptId !== promptId);
  saveLocalDownloads(updated);
  return updated;
};

/**
 * Mark a prompt as deleted and persist. Returns the updated set of deleted prompt IDs.
 */
export const addDeletedPrompt = (promptId: string): string[] => {
  const current = loadDeletedPrompts();
  current.add(promptId);
  const updated = Array.from(current);
  saveDeletedPrompts(updated);
  return updated;
};

/**
 * Clear all history-related localStorage state.
 */
export const clearAllHistoryStorage = (): void => {
  try {
    localStorage.removeItem(LOCAL_DOWNLOADS_KEY);
    localStorage.removeItem(DELETED_PROMPTS_KEY);
  } catch (e) {
    console.error('Failed to clear local downloads:', e);
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const saveLocalDownloads = (downloads: LocalDownload[]): void => {
  try {
    localStorage.setItem(LOCAL_DOWNLOADS_KEY, JSON.stringify(downloads));
  } catch (e) {
    console.error('Failed to save local downloads:', e);
  }
};

const saveDeletedPrompts = (promptIds: string[]): void => {
  try {
    localStorage.setItem(DELETED_PROMPTS_KEY, JSON.stringify(promptIds));
  } catch (e) {
    console.error('Failed to save deleted prompts:', e);
  }
};
