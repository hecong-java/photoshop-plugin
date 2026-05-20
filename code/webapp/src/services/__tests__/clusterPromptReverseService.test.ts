import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the service
vi.mock('../../stores/lemongridStore', () => ({
  useLemonGridStore: {
    getState: vi.fn(() => ({ serverUrl: 'https://lemongrid.test' })),
  },
}));

vi.mock('../../services/lemongrid-auth', () => ({
  lemongridFetch: vi.fn(),
  ensureValidToken: vi.fn(),
}));

// Create the mock uploadAsset function inside a module-level variable.
// vi.mock factories are hoisted, so we use vi.hoisted to create shared mock references.
const { mockUploadAsset, mockConstructor } = vi.hoisted(() => {
  const mockUploadAsset = vi.fn().mockResolvedValue({ id: 'mock-asset-id', filename: 'mock.png' });
  const mockConstructor = vi.fn(function (this: { uploadAsset: typeof mockUploadAsset }, _opts: { serverUrl: string }) {
    this.uploadAsset = mockUploadAsset;
  });
  return { mockUploadAsset, mockConstructor };
});

vi.mock('../../services/lemongrid', () => ({
  LemonGridClient: mockConstructor,
}));

import {
  reversePromptFromAsset,
  uploadForReversePrompt,
} from '../clusterPromptReverseService';
import { lemongridFetch } from '../../services/lemongrid-auth';

const mockedFetch = vi.mocked(lemongridFetch);

function mockResponse(ok: boolean, status: number, data: unknown): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

describe('clusterPromptReverseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reversePromptFromAsset', () => {
    it('POSTs with { asset_id } and returns structured result', async () => {
      const expectedResult = {
        prompt: 'A beautiful sunset over mountains',
        prompt_cn: '山间美丽的日落',
        negative_prompt: 'blurry, low quality',
        analysis: {
          subject: 'mountain sunset',
          composition: 'rule of thirds',
          lighting: 'golden hour',
          color_palette: 'warm oranges and purples',
          mood: 'peaceful',
          style: 'photorealistic',
          technical: 'high resolution',
        },
      };
      mockedFetch.mockResolvedValue(mockResponse(true, 200, expectedResult));

      const result = await reversePromptFromAsset('asset-123');

      expect(result).toEqual(expectedResult);
      expect(mockedFetch).toHaveBeenCalledWith(
        'https://lemongrid.test/api/v1/assets/library/reverse-prompt',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset_id: 'asset-123' }),
        }
      );
    });

    it('throws on non-ok response with status and error text', async () => {
      mockedFetch.mockResolvedValue(
        mockResponse(false, 422, 'Asset not found')
      );

      await expect(reversePromptFromAsset('bad-id')).rejects.toThrow(
        'Reverse prompt failed: 422 - Asset not found'
      );
    });
  });

  describe('uploadForReversePrompt', () => {
    it('creates File, calls uploadAsset with REFERENCE, and returns asset id', async () => {
      mockUploadAsset.mockResolvedValueOnce({ id: 'uploaded-asset-1', filename: 'reverse-input.png' });

      const blob = new Blob(['image-data'], { type: 'image/png' });
      const result = await uploadForReversePrompt(blob);

      expect(result).toBe('uploaded-asset-1');
      expect(mockConstructor).toHaveBeenCalledWith({
        serverUrl: 'https://lemongrid.test',
      });
      expect(mockUploadAsset).toHaveBeenCalledTimes(1);

      // Verify the File was created with correct properties
      const uploadedFile = mockUploadAsset.mock.calls[0][0] as File;
      expect(uploadedFile.name).toBe('reverse-input.png');
      expect(uploadedFile.type).toBe('image/png');
      expect(mockUploadAsset.mock.calls[0][1]).toBe('REFERENCE');
    });

    it('uses image/png as fallback type when blob has no type', async () => {
      mockUploadAsset.mockResolvedValueOnce({ id: 'asset-2', filename: 'test.png' });

      const blob = new Blob(['data'], { type: '' });
      await uploadForReversePrompt(blob, 'custom.png');

      const uploadedFile = mockUploadAsset.mock.calls[0][0] as File;
      expect(uploadedFile.type).toBe('image/png');
      expect(uploadedFile.name).toBe('custom.png');
    });
  });
});
