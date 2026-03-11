import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useConfigStore } from './configStore';
import * as configService from '../services/config';
import type { PluginConfig } from '../types/config';

vi.mock('../services/config', () => ({
  loadPluginConfig: vi.fn(),
  DEFAULT_CONFIG: { version: '1.0', nodes: [] },
}));

describe('useConfigStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    vi.clearAllMocks();
    // Reset store to initial state
    useConfigStore.setState({
      config: null,
      isLoading: false,
      error: null,
      loadedAt: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldDisplayNode', () => {
    it('should return true if config is null (show all)', () => {
      useConfigStore.setState({ config: null });

      const result = useConfigStore.getState().shouldDisplayNode('KSampler');

      expect(result).toBe(true);
    });

    it('should return true if config has empty nodes array (show all)', () => {
      useConfigStore.setState({ config: { version: '1.0', nodes: [] } });

      const result = useConfigStore.getState().shouldDisplayNode('KSampler');

      expect(result).toBe(true);
    });

    it('should return true if node class_type is in config', () => {
      useConfigStore.setState({
        config: {
          version: '1.0',
          nodes: [
            { class_type: 'KSampler' },
            { class_type: 'CLIPTextEncode' },
          ],
        },
      });

      expect(useConfigStore.getState().shouldDisplayNode('KSampler')).toBe(true);
      expect(useConfigStore.getState().shouldDisplayNode('CLIPTextEncode')).toBe(true);
    });

    it('should return false if config has nodes but classType not found', () => {
      useConfigStore.setState({
        config: {
          version: '1.0',
          nodes: [{ class_type: 'KSampler' }],
        },
      });

      const result = useConfigStore.getState().shouldDisplayNode('EmptyLatentImage');

      expect(result).toBe(false);
    });
  });

  describe('getAllowedInputs', () => {
    it('should return null if config is null (show all inputs)', () => {
      useConfigStore.setState({ config: null });

      const result = useConfigStore.getState().getAllowedInputs('KSampler');

      expect(result).toBeNull();
    });

    it('should return null if config has empty nodes array (show all inputs)', () => {
      useConfigStore.setState({ config: { version: '1.0', nodes: [] } });

      const result = useConfigStore.getState().getAllowedInputs('KSampler');

      expect(result).toBeNull();
    });

    it('should return null if node not in config (show all inputs)', () => {
      useConfigStore.setState({
        config: {
          version: '1.0',
          nodes: [{ class_type: 'KSampler' }],
        },
      });

      const result = useConfigStore.getState().getAllowedInputs('EmptyLatentImage');

      expect(result).toBeNull();
    });

    it('should return inputs array if node has inputs specified', () => {
      useConfigStore.setState({
        config: {
          version: '1.0',
          nodes: [
            {
              class_type: 'KSampler',
              inputs: ['seed', 'steps', 'cfg'],
            },
          ],
        },
      });

      const result = useConfigStore.getState().getAllowedInputs('KSampler');

      expect(result).toEqual(['seed', 'steps', 'cfg']);
    });

    it('should return null if node in config but no inputs property (show all inputs)', () => {
      useConfigStore.setState({
        config: {
          version: '1.0',
          nodes: [{ class_type: 'KSampler' }],
        },
      });

      const result = useConfigStore.getState().getAllowedInputs('KSampler');

      expect(result).toBeNull();
    });
  });

  describe('loadConfig', () => {
    it('should populate store from service', async () => {
      const mockConfig = {
        version: '1.0',
        nodes: [{ class_type: 'KSampler' }],
      };
      vi.mocked(configService.loadPluginConfig).mockResolvedValue(mockConfig);

      await useConfigStore.getState().loadConfig();

      const state = useConfigStore.getState();
      expect(state.config).toEqual(mockConfig);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.loadedAt).not.toBeNull();
    });

    it('should set isLoading to true during load', async () => {
      let resolveFn: (value: PluginConfig) => void;
      vi.mocked(configService.loadPluginConfig).mockImplementation(
        () =>
          new Promise<PluginConfig>((resolve) => {
            resolveFn = resolve;
          })
      );

      const loadPromise = useConfigStore.getState().loadConfig();

      // Check isLoading is true during the load
      expect(useConfigStore.getState().isLoading).toBe(true);

      // Resolve the promise
      resolveFn!({ version: '1.0', nodes: [] });
      await loadPromise;

      // Check isLoading is false after load
      expect(useConfigStore.getState().isLoading).toBe(false);
    });

    it('should handle errors and set error state', async () => {
      vi.mocked(configService.loadPluginConfig).mockRejectedValue(new Error('Load failed'));

      await useConfigStore.getState().loadConfig();

      const state = useConfigStore.getState();
      expect(state.error).toBe('Load failed');
      expect(state.isLoading).toBe(false);
      expect(state.config).toEqual(configService.DEFAULT_CONFIG);
    });
  });

  describe('setConfig', () => {
    it('should update config and loadedAt', () => {
      const newConfig: configService.PluginConfig = {
        version: '2.0',
        nodes: [{ class_type: 'NewNode' }],
      };

      useConfigStore.getState().setConfig(newConfig);

      const state = useConfigStore.getState();
      expect(state.config).toEqual(newConfig);
      expect(state.loadedAt).not.toBeNull();
    });

    it('should clear loadedAt when setting null', () => {
      useConfigStore.setState({ loadedAt: '2024-01-01T00:00:00Z' });

      useConfigStore.getState().setConfig(null);

      const state = useConfigStore.getState();
      expect(state.config).toBeNull();
      expect(state.loadedAt).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      useConfigStore.setState({ error: 'Some error' });

      useConfigStore.getState().clearError();

      expect(useConfigStore.getState().error).toBeNull();
    });
  });
});
