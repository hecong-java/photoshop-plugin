import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROMPT_CUSTOM_LIMIT,
  PROMPT_HISTORY_LIMIT,
  PROMPT_LIBRARY_STORAGE_KEY,
  addPromptHistoryEntries,
  addPromptLibraryEntry,
  getPromptLibraryEntries,
  loadPromptLibraryState,
  removePromptLibraryEntry,
} from '../promptLibrary';

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() { return store.size; },
};

(globalThis as { localStorage?: typeof localStorageMock }).localStorage = localStorageMock;

beforeEach(() => {
  store.clear();
});

describe('promptLibrary service', () => {
  it('returns an empty state when storage is empty', () => {
    expect(loadPromptLibraryState()).toEqual({
      history: {},
      custom: {},
    });
  });

  it('adds custom prompts and keeps newest duplicate at the top', () => {
    addPromptLibraryEntry('direct:text_1', 'custom', '第一条提示词');
    addPromptLibraryEntry('direct:text_1', 'custom', '第二条提示词');
    const entries = addPromptLibraryEntry('direct:text_1', 'custom', '第一条提示词');

    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe('第一条提示词');
    expect(entries[1].text).toBe('第二条提示词');
  });

  it('writes prompt history entries per key and ignores blank text', () => {
    addPromptHistoryEntries([
      { key: 'direct:text_1', text: '  正向提示词  ' },
      { key: 'direct:text_2', text: '   ' },
      { key: 'cluster:100.prompt', text: '集群提示词' },
    ]);

    expect(getPromptLibraryEntries('direct:text_1', 'history')).toHaveLength(1);
    expect(getPromptLibraryEntries('direct:text_2', 'history')).toEqual([]);
    expect(getPromptLibraryEntries('cluster:100.prompt', 'history')[0].text).toBe('集群提示词');
  });

  it('enforces history and custom entry limits', () => {
    for (let index = 0; index < PROMPT_HISTORY_LIMIT + 3; index += 1) {
      addPromptLibraryEntry('direct:text_1', 'history', `history-${index}`);
    }
    for (let index = 0; index < PROMPT_CUSTOM_LIMIT + 4; index += 1) {
      addPromptLibraryEntry('direct:text_1', 'custom', `custom-${index}`);
    }

    expect(getPromptLibraryEntries('direct:text_1', 'history')).toHaveLength(PROMPT_HISTORY_LIMIT);
    expect(getPromptLibraryEntries('direct:text_1', 'custom')).toHaveLength(PROMPT_CUSTOM_LIMIT);
  });

  it('removes a single prompt entry and cleans up empty keys', () => {
    addPromptLibraryEntry('direct:text_1', 'custom', '保留项');
    addPromptLibraryEntry('direct:text_1', 'custom', '删除项');

    const remaining = removePromptLibraryEntry('direct:text_1', 'custom', '删除项');
    expect(remaining.map((entry) => entry.text)).toEqual(['保留项']);

    const emptied = removePromptLibraryEntry('direct:text_1', 'custom', '保留项');
    expect(emptied).toEqual([]);
    expect(loadPromptLibraryState().custom['direct:text_1']).toBeUndefined();
  });

  it('falls back to empty state for corrupt storage', () => {
    store.set(PROMPT_LIBRARY_STORAGE_KEY, 'invalid-json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(loadPromptLibraryState()).toEqual({
        history: {},
        custom: {},
      });
    } finally {
      warnSpy.mockRestore();
    }
  });
});
