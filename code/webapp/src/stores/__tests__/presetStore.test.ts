import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePresetStore } from '../presetStore';
import * as presetService from '../../services/preset';
import type { PresetMeta, PresetFile } from '../../types/preset';

vi.mock('../../services/preset', () => ({
  listPresets: vi.fn(),
  readPreset: vi.fn(),
  savePreset: vi.fn(),
  deletePreset: vi.fn(),
  importPreset: vi.fn(),
  exportPreset: vi.fn(),
  getNextPresetName: vi.fn(),
  validatePresetData: vi.fn(),
}));

const mockListPresets = presetService.listPresets as unknown as ReturnType<typeof vi.fn>;
const mockReadPreset = presetService.readPreset as unknown as ReturnType<typeof vi.fn>;

const samplePresets: PresetMeta[] = [
  { filename: 'preset-2.json', name: '预设 2', workflowName: 'wf', updatedAt: '2026-04-15T01:00:00Z', createdAt: '2026-04-15T00:00:00Z' },
  { filename: 'preset-1.json', name: '预设 1', workflowName: 'wf', updatedAt: '2026-04-15T02:00:00Z', createdAt: '2026-04-15T00:00:00Z' },
];

const samplePresetData: PresetFile = {
  version: 1,
  name: '预设 1',
  workflowName: 'wf',
  inputValues: { seed: 42, steps: 20 },
  imageFilenames: {},
  createdAt: '2026-04-15T00:00:00Z',
  updatedAt: '2026-04-15T00:00:00Z',
};

describe('presetStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    usePresetStore.setState({
      presets: [],
      selectedPresetName: null,
      selectedPresetData: null,
      isLoading: false,
      error: null,
      lastAppliedInputValues: null,
      lastAppliedImageFilenames: null,
    });
  });

  it('initial state has empty presets array, null selectedPresetName, false isLoading', () => {
    const state = usePresetStore.getState();
    expect(state.presets).toEqual([]);
    expect(state.selectedPresetName).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('loadPresets calls service.listPresets and populates presets array sorted by updatedAt desc', async () => {
    mockListPresets.mockResolvedValue(samplePresets);

    await usePresetStore.getState().loadPresets('wf');

    expect(mockListPresets).toHaveBeenCalledWith('wf');
    const state = usePresetStore.getState();
    // Service returns sorted, store should preserve that order
    expect(state.presets).toEqual(samplePresets);
    expect(state.presets[0].name).toBe('预设 2');
  });

  it('loadPresets sets isLoading true during load, false after', async () => {
    let resolveLoad: () => void;
    const loadPromise = new Promise<void>((resolve) => { resolveLoad = resolve; });
    mockListPresets.mockImplementation(() => new Promise((r) => {
      // Resolve on next tick so we can check isLoading
      setTimeout(() => { r(samplePresets); resolveLoad(); }, 10);
    }));

    const loadResult = usePresetStore.getState().loadPresets('wf');

    // Check isLoading is true during load
    expect(usePresetStore.getState().isLoading).toBe(true);

    await loadResult;

    expect(usePresetStore.getState().isLoading).toBe(false);
  });

  it('selectPreset sets selectedPresetName and selectedPresetData', async () => {
    mockReadPreset.mockResolvedValue(samplePresetData);

    await usePresetStore.getState().selectPreset('preset-1.json');

    expect(mockReadPreset).toHaveBeenCalledWith('preset-1.json');
    const state = usePresetStore.getState();
    expect(state.selectedPresetName).toBe('preset-1.json');
    expect(state.selectedPresetData).toEqual(samplePresetData);
  });

  it('clearSelection sets selectedPresetName to null', () => {
    usePresetStore.setState({ selectedPresetName: 'preset-1.json', selectedPresetData: samplePresetData });

    usePresetStore.getState().clearSelection();

    const state = usePresetStore.getState();
    expect(state.selectedPresetName).toBeNull();
    expect(state.selectedPresetData).toBeNull();
  });

  it('setLastAppliedValues stores the values for dirty checking', () => {
    const inputValues = { seed: 42, steps: 20 };
    const imageFilenames = { image: 'photo.png' };

    usePresetStore.getState().setLastAppliedValues(inputValues, imageFilenames);

    const state = usePresetStore.getState();
    expect(state.lastAppliedInputValues).toEqual(inputValues);
    expect(state.lastAppliedImageFilenames).toEqual(imageFilenames);
  });

  it('hasUnsavedChanges returns false when no lastAppliedValues', () => {
    const state = usePresetStore.getState();
    expect(state.lastAppliedInputValues).toBeNull();
    expect(state.hasUnsavedChanges({ seed: 1 }, {})).toBe(false);
  });

  it('hasUnsavedChanges returns false when current values match last applied', () => {
    usePresetStore.getState().setLastAppliedValues({ seed: 42, steps: 20 }, { image: 'a.png' });

    const result = usePresetStore.getState().hasUnsavedChanges({ seed: 42, steps: 20 }, { image: 'a.png' });
    expect(result).toBe(false);
  });

  it('hasUnsavedChanges returns true when current values differ from last applied', () => {
    usePresetStore.getState().setLastAppliedValues({ seed: 42, steps: 20 }, { image: 'a.png' });

    // Different inputValues
    expect(usePresetStore.getState().hasUnsavedChanges({ seed: 99, steps: 20 }, { image: 'a.png' })).toBe(true);

    // Different imageFilenames
    expect(usePresetStore.getState().hasUnsavedChanges({ seed: 42, steps: 20 }, { image: 'b.png' })).toBe(true);

    // Missing key
    expect(usePresetStore.getState().hasUnsavedChanges({ seed: 42 }, { image: 'a.png' })).toBe(true);
  });

  it('clearDirtyState resets lastApplied values to null', () => {
    usePresetStore.getState().setLastAppliedValues({ seed: 42 }, { image: 'a.png' });

    usePresetStore.getState().clearDirtyState();

    const state = usePresetStore.getState();
    expect(state.lastAppliedInputValues).toBeNull();
    expect(state.lastAppliedImageFilenames).toBeNull();
  });
});
