export type PromptLibraryKind = 'history' | 'custom';

export interface PromptLibraryEntry {
  text: string;
  updatedAt: number;
}

interface PromptLibraryState {
  history: Record<string, PromptLibraryEntry[]>;
  custom: Record<string, PromptLibraryEntry[]>;
}

export const PROMPT_LIBRARY_STORAGE_KEY = 'LemonGrid-prompt-library';
export const PROMPT_HISTORY_LIMIT = 20;
export const PROMPT_CUSTOM_LIMIT = 50;

const EMPTY_STATE: PromptLibraryState = {
  history: {},
  custom: {},
};

const normalizeText = (text: string): string => text.trim();

const safeCloneState = (state: PromptLibraryState): PromptLibraryState => ({
  history: { ...state.history },
  custom: { ...state.custom },
});

const isPromptLibraryEntry = (value: unknown): value is PromptLibraryEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.text === 'string' && typeof candidate.updatedAt === 'number';
};

const sanitizeEntryList = (value: unknown): PromptLibraryEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPromptLibraryEntry)
    .map((entry) => ({
      text: normalizeText(entry.text),
      updatedAt: entry.updatedAt,
    }))
    .filter((entry) => entry.text !== '');
};

const sanitizeEntryMap = (value: unknown): Record<string, PromptLibraryEntry[]> => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const result: Record<string, PromptLibraryEntry[]> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entryList]) => {
    const sanitized = sanitizeEntryList(entryList);
    if (sanitized.length > 0) {
      result[key] = sanitized;
    }
  });
  return result;
};

export const loadPromptLibraryState = (): PromptLibraryState => {
  try {
    const raw = localStorage.getItem(PROMPT_LIBRARY_STORAGE_KEY);
    if (!raw) {
      return safeCloneState(EMPTY_STATE);
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      history: sanitizeEntryMap(parsed.history),
      custom: sanitizeEntryMap(parsed.custom),
    };
  } catch (error) {
    console.warn('[promptLibrary] Failed to load prompt library:', error);
    return safeCloneState(EMPTY_STATE);
  }
};

const persistPromptLibraryState = (state: PromptLibraryState): void => {
  try {
    localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[promptLibrary] Failed to persist prompt library:', error);
  }
};

const upsertPromptEntry = (
  entries: PromptLibraryEntry[],
  text: string,
  limit: number
): PromptLibraryEntry[] => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return entries;
  }

  const nextEntries = [
    { text: normalized, updatedAt: Date.now() },
    ...entries.filter((entry) => normalizeText(entry.text) !== normalized),
  ];

  return nextEntries.slice(0, limit);
};

export const getPromptLibraryEntries = (
  key: string,
  kind: PromptLibraryKind
): PromptLibraryEntry[] => {
  if (!key.trim()) {
    return [];
  }

  const state = loadPromptLibraryState();
  return [...(state[kind][key] ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
};

export const addPromptLibraryEntry = (
  key: string,
  kind: PromptLibraryKind,
  text: string
): PromptLibraryEntry[] => {
  const normalizedKey = key.trim();
  const normalizedText = normalizeText(text);
  if (!normalizedKey || !normalizedText) {
    return getPromptLibraryEntries(normalizedKey, kind);
  }

  const state = loadPromptLibraryState();
  const nextState = safeCloneState(state);
  const limit = kind === 'history' ? PROMPT_HISTORY_LIMIT : PROMPT_CUSTOM_LIMIT;
  const nextEntries = upsertPromptEntry(nextState[kind][normalizedKey] ?? [], normalizedText, limit);
  nextState[kind][normalizedKey] = nextEntries;
  persistPromptLibraryState(nextState);
  return nextEntries;
};

export const removePromptLibraryEntry = (
  key: string,
  kind: PromptLibraryKind,
  text: string
): PromptLibraryEntry[] => {
  const normalizedKey = key.trim();
  const normalizedText = normalizeText(text);
  if (!normalizedKey || !normalizedText) {
    return getPromptLibraryEntries(normalizedKey, kind);
  }

  const state = loadPromptLibraryState();
  const nextState = safeCloneState(state);
  const currentEntries = nextState[kind][normalizedKey] ?? [];
  const nextEntries = currentEntries.filter((entry) => normalizeText(entry.text) !== normalizedText);

  if (nextEntries.length > 0) {
    nextState[kind][normalizedKey] = nextEntries;
  } else {
    delete nextState[kind][normalizedKey];
  }

  persistPromptLibraryState(nextState);
  return getPromptLibraryEntries(normalizedKey, kind);
};

export const addPromptHistoryEntries = (
  items: Array<{ key: string; text: string }>
): PromptLibraryState['history'] => {
  if (items.length === 0) {
    return loadPromptLibraryState().history;
  }

  const state = loadPromptLibraryState();
  const nextState = safeCloneState(state);

  items.forEach(({ key, text }) => {
    const normalizedKey = key.trim();
    const normalizedText = normalizeText(text);
    if (!normalizedKey || !normalizedText) {
      return;
    }
    nextState.history[normalizedKey] = upsertPromptEntry(
      nextState.history[normalizedKey] ?? [],
      normalizedText,
      PROMPT_HISTORY_LIMIT
    );
  });

  persistPromptLibraryState(nextState);
  return nextState.history;
};
