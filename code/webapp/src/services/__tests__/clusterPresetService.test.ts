import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock lemongridStore and lemongrid-auth before importing the service
vi.mock('../../stores/lemongridStore', () => ({
  useLemonGridStore: {
    getState: vi.fn(() => ({ serverUrl: 'https://lemongrid.test' })),
  },
}));

vi.mock('../../services/lemongrid-auth', () => ({
  lemongridFetch: vi.fn(),
  ensureValidToken: vi.fn(),
}));

import { listPresets, createPreset, updatePreset, deletePreset } from '../clusterPresetService';
import { lemongridFetch, ensureValidToken } from '../../services/lemongrid-auth';

const mockedFetch = vi.mocked(lemongridFetch);
const mockedEnsureToken = vi.mocked(ensureValidToken);

function mockResponse(ok: boolean, status: number, data: unknown): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

describe('clusterPresetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedEnsureToken.mockResolvedValue('valid-token');
  });

  describe('listPresets', () => {
    it('returns array from response.items', async () => {
      const presets = [
        {
          id: 'p1',
          template_id: 'tmpl-1',
          name: 'Preset A',
          parameters: { seed: 42 },
          scope: 'personal',
          owner_id: 'user-1',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];
      mockedFetch.mockResolvedValue(mockResponse(true, 200, { items: presets, total: 1 }));

      const result = await listPresets('tmpl-1');
      expect(result).toEqual(presets);
      expect(result).toHaveLength(1);
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://lemongrid.test/api/v1/templates/tmpl-1/presets?page_size=100'
      );
    });

    it('returns empty array when response has no items', async () => {
      mockedFetch.mockResolvedValue(mockResponse(true, 200, { total: 0 }));

      const result = await listPresets('tmpl-1');
      expect(result).toEqual([]);
    });

    it('throws on non-ok response', async () => {
      mockedFetch.mockResolvedValue(mockResponse(false, 500, null));

      await expect(listPresets('tmpl-1')).rejects.toThrow('List presets failed: 500');
    });
  });

  describe('createPreset', () => {
    it('POSTs with correct body and returns result', async () => {
      const created = {
        id: 'p-new',
        template_id: 'tmpl-1',
        name: 'New Preset',
        parameters: { prompt: 'a cat' },
        scope: 'personal',
        owner_id: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      mockedFetch.mockResolvedValue(mockResponse(true, 200, created));

      const result = await createPreset('tmpl-1', 'New Preset', { prompt: 'a cat' });

      expect(result).toEqual(created);
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://lemongrid.test/api/v1/templates/tmpl-1/presets',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: 'tmpl-1',
            name: 'New Preset',
            parameters: { prompt: 'a cat' },
            scope: 'personal',
          }),
        }
      );
    });

    it('throws PRESET_NAME_CONFLICT on status 409', async () => {
      mockedFetch.mockResolvedValue(mockResponse(false, 409, { detail: 'Conflict' }));

      await expect(createPreset('tmpl-1', 'Dupe', {})).rejects.toThrow('PRESET_NAME_CONFLICT');
    });

    it('throws on other non-ok status', async () => {
      mockedFetch.mockResolvedValue(mockResponse(false, 500, null));

      await expect(createPreset('tmpl-1', 'Test', {})).rejects.toThrow('Create preset failed: 500');
    });

    it('defaults scope to personal', async () => {
      mockedFetch.mockResolvedValue(mockResponse(true, 200, {}));

      await createPreset('tmpl-1', 'Test', { k: 'v' });

      const callBody = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(callBody.scope).toBe('personal');
    });
  });

  describe('updatePreset', () => {
    it('PUTs with correct body and returns result', async () => {
      const updated = {
        id: 'p1',
        template_id: 'tmpl-1',
        name: 'Updated Name',
        parameters: { seed: 99 },
        scope: 'personal',
        owner_id: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      };
      mockedFetch.mockResolvedValue(mockResponse(true, 200, updated));

      const result = await updatePreset('tmpl-1', 'p1', { name: 'Updated Name', parameters: { seed: 99 } });

      expect(result).toEqual(updated);
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://lemongrid.test/api/v1/templates/tmpl-1/presets/p1',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Name', parameters: { seed: 99 } }),
        }
      );
    });

    it('throws on non-ok response', async () => {
      mockedFetch.mockResolvedValue(mockResponse(false, 404, null));

      await expect(updatePreset('tmpl-1', 'p1', {})).rejects.toThrow('Update preset failed: 404');
    });
  });

  describe('deletePreset', () => {
    it('DELETEs and resolves on success', async () => {
      mockedFetch.mockResolvedValue(mockResponse(true, 200, null));

      await expect(deletePreset('tmpl-1', 'p1')).resolves.toBeUndefined();
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://lemongrid.test/api/v1/templates/tmpl-1/presets/p1',
        { method: 'DELETE' }
      );
    });

    it('resolves silently on 204 status', async () => {
      mockedFetch.mockResolvedValue(mockResponse(false, 204, null));

      await expect(deletePreset('tmpl-1', 'p1')).resolves.toBeUndefined();
    });

    it('throws on non-ok non-204 status', async () => {
      mockedFetch.mockResolvedValue(mockResponse(false, 404, null));

      await expect(deletePreset('tmpl-1', 'p1')).rejects.toThrow('Delete preset failed: 404');
    });
  });
});
