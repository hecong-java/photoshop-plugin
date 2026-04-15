import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listPresets,
  readPreset,
  savePreset,
  deletePreset,
  importPreset,
  exportPreset,
  getNextPresetName,
  validatePresetData,
} from '../preset';
import { sendBridgeMessage, hasBridgeTransport } from '../upload';

vi.mock('../upload', () => ({
  sendBridgeMessage: vi.fn(),
  hasBridgeTransport: vi.fn(),
}));

const mockSend = sendBridgeMessage as unknown as ReturnType<typeof vi.fn>;
const mockHasBridge = hasBridgeTransport as unknown as ReturnType<typeof vi.fn>;

const validPresetFile = {
  version: 1,
  name: 'Test Preset',
  workflowName: 'test-workflow',
  inputValues: { seed: 42, steps: 20, prompt: 'a cat' },
  imageFilenames: {},
  createdAt: '2026-04-15T00:00:00Z',
  updatedAt: '2026-04-15T00:00:00Z',
};

describe('preset service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPresets', () => {
    it('returns empty array when Bridge is not available', async () => {
      mockHasBridge.mockReturnValue(false);
      const result = await listPresets('test-workflow');
      expect(result).toEqual([]);
    });

    it('calls sendBridgeMessage with preset.list and correct payload', async () => {
      mockHasBridge.mockReturnValue(true);
      const mockPresets = [
        { filename: 'test.json', name: 'Test', workflowName: 'wf', updatedAt: '2026-04-15T00:00:00Z', createdAt: '2026-04-15T00:00:00Z' },
      ];
      mockSend.mockResolvedValue(mockPresets);

      const result = await listPresets('my-workflow');
      expect(mockSend).toHaveBeenCalledWith('preset.list', { workflowName: 'my-workflow' });
      expect(result).toEqual(mockPresets);
    });
  });

  describe('savePreset', () => {
    it('calls sendBridgeMessage with preset.write and filename + data', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue({ success: true, filename: 'preset.json' });

      const result = await savePreset('preset.json', validPresetFile as any);
      expect(mockSend).toHaveBeenCalledWith('preset.write', {
        filename: 'preset.json',
        data: validPresetFile,
      });
      expect(result).toEqual({ success: true, filename: 'preset.json' });
    });
  });

  describe('readPreset', () => {
    it('calls sendBridgeMessage with preset.read and filename', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue(validPresetFile);

      const result = await readPreset('test.json');
      expect(mockSend).toHaveBeenCalledWith('preset.read', { filename: 'test.json' });
      expect(result).toEqual(validPresetFile);
    });
  });

  describe('deletePreset', () => {
    it('calls sendBridgeMessage with preset.delete and filename', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue({ success: true });

      const result = await deletePreset('test.json');
      expect(mockSend).toHaveBeenCalledWith('preset.delete', { filename: 'test.json' });
      expect(result).toEqual({ success: true });
    });
  });

  describe('importPreset', () => {
    it('calls sendBridgeMessage with preset.import and returns parsed data', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue({
        cancelled: false,
        data: validPresetFile,
        sourceFilename: 'imported.json',
      });

      const result = await importPreset();
      expect(mockSend).toHaveBeenCalledWith('preset.import', {});
      expect(result).toEqual({
        cancelled: false,
        data: validPresetFile,
        sourceFilename: 'imported.json',
      });
    });

    it('handles cancelled response (user cancelled file picker)', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue({ cancelled: true });

      const result = await importPreset();
      expect(result).toEqual({ cancelled: true });
    });
  });

  describe('exportPreset', () => {
    it('calls sendBridgeMessage with preset.export and filename + data', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue({ success: true });

      const result = await exportPreset('export.json', validPresetFile as any);
      expect(mockSend).toHaveBeenCalledWith('preset.export', {
        filename: 'export.json',
        data: validPresetFile,
      });
      expect(result).toEqual({ success: true });
    });

    it('handles cancelled response (user cancelled save dialog)', async () => {
      mockHasBridge.mockReturnValue(true);
      mockSend.mockResolvedValue({ cancelled: true });

      const result = await exportPreset('export.json', validPresetFile as any);
      expect(result).toEqual({ cancelled: true });
    });
  });

  describe('getNextPresetName', () => {
    it('returns "预设 1" when no presets exist', () => {
      expect(getNextPresetName([])).toBe('预设 1');
    });

    it('returns "预设 N+1" based on highest N in existing names', () => {
      const presets = [
        { filename: 'a.json', name: '预设 1', workflowName: 'wf', updatedAt: '', createdAt: '' },
        { filename: 'b.json', name: '预设 2', workflowName: 'wf', updatedAt: '', createdAt: '' },
      ];
      expect(getNextPresetName(presets)).toBe('预设 3');
    });

    it('ignores names not matching "预设 N" pattern', () => {
      const presets = [
        { filename: 'a.json', name: '我的预设', workflowName: 'wf', updatedAt: '', createdAt: '' },
        { filename: 'b.json', name: '预设 5', workflowName: 'wf', updatedAt: '', createdAt: '' },
      ];
      expect(getNextPresetName(presets)).toBe('预设 6');
    });

    it('handles large numbers correctly', () => {
      const presets = [
        { filename: 'a.json', name: '预设 1', workflowName: 'wf', updatedAt: '', createdAt: '' },
        { filename: 'b.json', name: '预设 10', workflowName: 'wf', updatedAt: '', createdAt: '' },
      ];
      expect(getNextPresetName(presets)).toBe('预设 11');
    });
  });

  describe('validatePresetData', () => {
    it('returns valid for correct PresetFile structure', () => {
      const result = validatePresetData(validPresetFile);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test Preset');
      expect(result!.workflowName).toBe('test-workflow');
    });

    it('strips image base64 data from inputValues', () => {
      const dataWithBase64 = {
        ...validPresetFile,
        inputValues: {
          seed: 42,
          prompt: 'a cat',
          image_data: 'data:image/png;base64,' + 'A'.repeat(2000),
          another_image: 'iVBORw0KGgo' + 'B'.repeat(2000),
        },
      };
      const result = validatePresetData(dataWithBase64);
      expect(result).not.toBeNull();
      expect(result!.inputValues.seed).toBe(42);
      expect(result!.inputValues.prompt).toBe('a cat');
      // Base64-like long strings should be stripped
      expect(result!.inputValues.image_data).toBeUndefined();
      expect(result!.inputValues.another_image).toBeUndefined();
    });

    it('returns null for missing required fields', () => {
      const missing = { version: 1, name: 'test' }; // no workflowName, inputValues
      expect(validatePresetData(missing)).toBeNull();
    });

    it('returns null for non-object input', () => {
      expect(validatePresetData(null)).toBeNull();
      expect(validatePresetData('string')).toBeNull();
      expect(validatePresetData(42)).toBeNull();
      expect(validatePresetData(undefined)).toBeNull();
    });
  });
});
