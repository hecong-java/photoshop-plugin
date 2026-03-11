import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadPluginConfig, validateConfig, DEFAULT_CONFIG } from './config';
import * as upload from './upload';

vi.mock('./upload', () => ({
  sendBridgeMessage: vi.fn(),
  hasBridgeTransport: vi.fn(),
}));

describe('loadPluginConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return DEFAULT_CONFIG when no bridge transport', async () => {
    vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(false);

    const result = await loadPluginConfig();

    expect(result).toEqual(DEFAULT_CONFIG);
    expect(upload.sendBridgeMessage).not.toHaveBeenCalled();
  });

  it('should return parsed config when file exists', async () => {
    vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(true);
    vi.spyOn(upload, 'sendBridgeMessage').mockResolvedValue({
      exists: true,
      data: JSON.stringify({
        version: '1.0',
        nodes: [{ class_type: 'KSampler' }, { class_type: 'CLIPTextEncode', inputs: ['text'] }],
      }),
    });

    const result = await loadPluginConfig();

    expect(result.version).toBe('1.0');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].class_type).toBe('KSampler');
    expect(result.nodes[1].inputs).toEqual(['text']);
  });

  it('should return DEFAULT_CONFIG when file does not exist', async () => {
    vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(true);
    vi.spyOn(upload, 'sendBridgeMessage').mockResolvedValue({
      exists: false,
    });

    const result = await loadPluginConfig();

    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('should return DEFAULT_CONFIG on parse error', async () => {
    vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(true);
    vi.spyOn(upload, 'sendBridgeMessage').mockResolvedValue({
      exists: true,
      data: 'invalid json',
    });

    const result = await loadPluginConfig();

    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('should return DEFAULT_CONFIG on bridge error', async () => {
    vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(true);
    vi.spyOn(upload, 'sendBridgeMessage').mockRejectedValue(new Error('Bridge error'));

    const result = await loadPluginConfig();

    expect(result).toEqual(DEFAULT_CONFIG);
  });
});

describe('validateConfig', () => {
  it('should return DEFAULT_CONFIG for null/undefined input', () => {
    expect(validateConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig('string')).toEqual(DEFAULT_CONFIG);
  });

  it('should return DEFAULT_CONFIG when nodes is not an array', () => {
    expect(validateConfig({ version: '1.0', nodes: 'not-array' })).toEqual(DEFAULT_CONFIG);
  });

  it('should filter invalid node entries', () => {
    const input = {
      version: '1.0',
      nodes: [
        { class_type: 'ValidNode' },
        { class_type: '' }, // Empty class_type - invalid
        { class_type: 123 }, // Non-string class_type - invalid
        { }, // Missing class_type - invalid
        null, // Null entry - invalid
        'not an object', // Not an object - invalid
      ],
    };

    const result = validateConfig(input);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].class_type).toBe('ValidNode');
  });

  it('should preserve valid class_type and inputs arrays', () => {
    const input = {
      version: '2.0',
      nodes: [
        { class_type: 'KSampler', inputs: ['seed', 'steps', 'cfg'] },
        { class_type: 'CLIPTextEncode' }, // No inputs = show all
      ],
    };

    const result = validateConfig(input);

    expect(result.version).toBe('2.0');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].inputs).toEqual(['seed', 'steps', 'cfg']);
    expect(result.nodes[1].inputs).toBeUndefined();
  });

  it('should filter non-string inputs from inputs array', () => {
    const input = {
      version: '1.0',
      nodes: [
        {
          class_type: 'KSampler',
          inputs: ['seed', 123, null, 'steps', '', 'cfg'],
        },
      ],
    };

    const result = validateConfig(input);

    expect(result.nodes[0].inputs).toEqual(['seed', 'steps', 'cfg']);
  });

  it('should use default version if missing', () => {
    const input = {
      nodes: [{ class_type: 'TestNode' }],
    };

    const result = validateConfig(input);

    expect(result.version).toBe('1.0');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have empty nodes array', () => {
    expect(DEFAULT_CONFIG.nodes).toEqual([]);
    expect(DEFAULT_CONFIG.version).toBe('1.0');
  });
});
