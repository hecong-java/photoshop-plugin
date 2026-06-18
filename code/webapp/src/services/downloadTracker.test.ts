// Unit tests for the Download Tracker module.
// Uses a mock localStorage so tests run in any environment.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  LOCAL_DOWNLOADS_KEY,
  DELETED_PROMPTS_KEY,
  loadLocalDownloads,
  loadDeletedPrompts,
  addLocalDownload,
  removeLocalDownloadEntry,
  removeDownloadsForPrompt,
  addDeletedPrompt,
  clearAllHistoryStorage,
} from './downloadTracker';
import type { LocalDownload } from '../stores/historyTypes';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
(globalThis as any).localStorage = localStorageMock;

beforeEach(() => {
  store.clear();
});

// ---------------------------------------------------------------------------
// loadLocalDownloads
// ---------------------------------------------------------------------------

describe('loadLocalDownloads', () => {
  it('returns an empty array when localStorage is empty', () => {
    expect(loadLocalDownloads()).toEqual([]);
  });

  it('parses stored JSON correctly', () => {
    const downloads: LocalDownload[] = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
    ];
    store.set(LOCAL_DOWNLOADS_KEY, JSON.stringify(downloads));
    expect(loadLocalDownloads()).toEqual(downloads);
  });

  it('returns an empty array on corrupt JSON', () => {
    store.set(LOCAL_DOWNLOADS_KEY, 'not valid json{');
    expect(loadLocalDownloads()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadDeletedPrompts
// ---------------------------------------------------------------------------

describe('loadDeletedPrompts', () => {
  it('returns an empty set when localStorage is empty', () => {
    expect(loadDeletedPrompts().size).toBe(0);
  });

  it('returns a Set of deleted prompt IDs', () => {
    store.set(DELETED_PROMPTS_KEY, JSON.stringify(['a', 'b', 'c']));
    const set = loadDeletedPrompts();
    expect(set.size).toBe(3);
    expect(set.has('b')).toBe(true);
  });

  it('returns an empty set on corrupt JSON', () => {
    store.set(DELETED_PROMPTS_KEY, 'corrupt');
    expect(loadDeletedPrompts().size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addLocalDownload
// ---------------------------------------------------------------------------

describe('addLocalDownload', () => {
  it('appends a new download and persists', () => {
    const result = addLocalDownload([], 'prompt-1', '/path/to/file.png');
    expect(result).toHaveLength(1);
    expect(result[0].promptId).toBe('prompt-1');
    expect(result[0].filePath).toBe('/path/to/file.png');
    expect(typeof result[0].downloadedAt).toBe('number');
    // Verify persistence
    const stored = JSON.parse(store.get(LOCAL_DOWNLOADS_KEY)!);
    expect(stored).toEqual(result);
  });

  it('appends to an existing list without losing entries', () => {
    const initial: LocalDownload[] = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
    ];
    const result = addLocalDownload(initial, 'b', '/b/1.png');
    expect(result).toHaveLength(2);
    expect(result[1].promptId).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// removeLocalDownloadEntry
// ---------------------------------------------------------------------------

describe('removeLocalDownloadEntry', () => {
  it('removes a matching download and persists', () => {
    const initial: LocalDownload[] = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
      { promptId: 'a', filePath: '/a/2.png', downloadedAt: 2 },
    ];
    const result = removeLocalDownloadEntry(initial, 'a', '/a/1.png');
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('/a/2.png');
  });

  it('keeps other prompt IDs untouched', () => {
    const initial: LocalDownload[] = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
      { promptId: 'b', filePath: '/b/1.png', downloadedAt: 2 },
    ];
    const result = removeLocalDownloadEntry(initial, 'a', '/a/1.png');
    expect(result).toHaveLength(1);
    expect(result[0].promptId).toBe('b');
  });

  it('returns the list unchanged when no match found', () => {
    const initial: LocalDownload[] = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
    ];
    const result = removeLocalDownloadEntry(initial, 'a', '/not-matching.png');
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeDownloadsForPrompt
// ---------------------------------------------------------------------------

describe('removeDownloadsForPrompt', () => {
  it('removes all downloads for a given prompt ID', () => {
    const initial: LocalDownload[] = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
      { promptId: 'a', filePath: '/a/2.png', downloadedAt: 2 },
      { promptId: 'b', filePath: '/b/1.png', downloadedAt: 3 },
    ];
    const result = removeDownloadsForPrompt(initial, 'a');
    expect(result).toHaveLength(1);
    expect(result[0].promptId).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// addDeletedPrompt
// ---------------------------------------------------------------------------

describe('addDeletedPrompt', () => {
  it('adds a new prompt ID and persists', () => {
    const result = addDeletedPrompt('prompt-1');
    expect(result).toContain('prompt-1');
    const stored = JSON.parse(store.get(DELETED_PROMPTS_KEY)!);
    expect(stored).toContain('prompt-1');
  });

  it('is idempotent — adding the same ID twice keeps only one entry', () => {
    addDeletedPrompt('prompt-1');
    const result = addDeletedPrompt('prompt-1');
    expect(result.filter((id) => id === 'prompt-1')).toHaveLength(1);
  });

  it('preserves existing deleted IDs', () => {
    store.set(DELETED_PROMPTS_KEY, JSON.stringify(['existing']));
    const result = addDeletedPrompt('new');
    expect(result).toContain('existing');
    expect(result).toContain('new');
  });
});

// ---------------------------------------------------------------------------
// clearAllHistoryStorage
// ---------------------------------------------------------------------------

describe('clearAllHistoryStorage', () => {
  it('removes both keys from localStorage', () => {
    store.set(LOCAL_DOWNLOADS_KEY, '[]');
    store.set(DELETED_PROMPTS_KEY, '[]');
    clearAllHistoryStorage();
    expect(store.has(LOCAL_DOWNLOADS_KEY)).toBe(false);
    expect(store.has(DELETED_PROMPTS_KEY)).toBe(false);
  });
});
