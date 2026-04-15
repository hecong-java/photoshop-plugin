import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeImage,
  imageElementToBase64,
  PROMPT_TEMPLATES,
  DASHSCOPE_MODELS,
  DEFAULT_MODEL,
  DASHSCOPE_BASE_URL,
  MAX_IMAGE_DIMENSION,
} from '../dashscope';

// Mock bridgeFetch from upload module
vi.mock('../upload', () => ({
  bridgeFetch: vi.fn(),
}));

import { bridgeFetch } from '../upload';
const mockedBridgeFetch = vi.mocked(bridgeFetch);

describe('dashscope service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PROMPT_TEMPLATES', () => {
    it('should have exactly 4 entries', () => {
      expect(PROMPT_TEMPLATES).toHaveLength(4);
    });

    it('should have ids detailed, concise, composition, style', () => {
      const ids = PROMPT_TEMPLATES.map((t) => t.id);
      expect(ids).toEqual(['detailed', 'concise', 'composition', 'style']);
    });

    it('each template should have id, name, description, systemPrompt fields', () => {
      for (const template of PROMPT_TEMPLATES) {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('systemPrompt');
        expect(typeof template.id).toBe('string');
        expect(typeof template.name).toBe('string');
        expect(typeof template.description).toBe('string');
        expect(typeof template.systemPrompt).toBe('string');
      }
    });

    it('each systemPrompt should contain Chinese text', () => {
      for (const template of PROMPT_TEMPLATES) {
        // Check for common Chinese characters in system prompts
        expect(template.systemPrompt).toMatch(/[\u4e00-\u9fff]/);
      }
    });
  });

  describe('DASHSCOPE_MODELS', () => {
    it('should have exactly 3 entries', () => {
      expect(DASHSCOPE_MODELS).toHaveLength(3);
    });

    it('should have ids qwen-vl-max, qwen-vl-plus, qwen3-vl-plus', () => {
      const ids = DASHSCOPE_MODELS.map((m) => m.id);
      expect(ids).toEqual(['qwen-vl-max', 'qwen-vl-plus', 'qwen3-vl-plus']);
    });
  });

  describe('DEFAULT_MODEL', () => {
    it('should be qwen-vl-plus', () => {
      expect(DEFAULT_MODEL).toBe('qwen-vl-plus');
    });
  });

  describe('MAX_IMAGE_DIMENSION', () => {
    it('should be 2048', () => {
      expect(MAX_IMAGE_DIMENSION).toBe(2048);
    });
  });

  describe('analyzeImage', () => {
    it('should call bridgeFetch with correct URL, headers, body, and 60s timeout', async () => {
      mockedBridgeFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'test result' } }],
        }),
      } as Response);

      const config = { apiKey: 'test-key', model: 'qwen-vl-plus' };
      const result = await analyzeImage(config, 'base64data', 'Describe this image');

      expect(result).toBe('test result');
      expect(mockedBridgeFetch).toHaveBeenCalledTimes(1);

      const [url, options, timeout] = mockedBridgeFetch.mock.calls[0];
      expect(url).toBe(DASHSCOPE_BASE_URL);
      expect(timeout).toBe(60000);
      expect(options.method).toBe('POST');

      const headers = options.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-key');

      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('qwen-vl-plus');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toHaveLength(2);
      expect(body.messages[0].content[0].type).toBe('text');
      expect(body.messages[0].content[0].text).toBe('Describe this image');
      expect(body.messages[0].content[1].type).toBe('image_url');
      expect(body.messages[0].content[1].image_url.url).toBe(
        'data:image/png;base64,base64data'
      );
    });

    it('should use custom mimeType when provided', async () => {
      mockedBridgeFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
        }),
      } as Response);

      const config = { apiKey: 'test-key', model: 'qwen-vl-max' };
      await analyzeImage(config, 'base64data', 'prompt', 'image/jpeg');

      const body = JSON.parse(
        (mockedBridgeFetch.mock.calls[0][1] as RequestInit).body as string
      );
      expect(body.messages[0].content[1].image_url.url).toBe(
        'data:image/jpeg;base64,base64data'
      );
    });

    it('should return text content from choices[0].message.content', async () => {
      const expectedContent = 'This image shows a mountain landscape with...';
      mockedBridgeFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: expectedContent } }],
        }),
      } as Response);

      const config = { apiKey: 'test-key', model: 'qwen-vl-plus' };
      const result = await analyzeImage(config, 'base64data', 'prompt');

      expect(result).toBe(expectedContent);
    });

    it('should throw Error with API message on non-ok status', async () => {
      mockedBridgeFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API key' },
        }),
      } as Response);

      const config = { apiKey: 'test-key', model: 'qwen-vl-plus' };

      await expect(analyzeImage(config, 'base64data', 'prompt')).rejects.toThrow(
        'Invalid API key'
      );
    });

    it('should never include the API key in thrown error messages', async () => {
      const secretKey = 'sk-super-secret-key-12345';
      mockedBridgeFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: `Authentication failed for key ${secretKey}` },
        }),
      } as Response);

      const config = { apiKey: secretKey, model: 'qwen-vl-plus' };

      try {
        await analyzeImage(config, 'base64data', 'prompt');
        expect.fail('Should have thrown');
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain(secretKey);
      }
    });

    it('should throw generic error when API error has no message', async () => {
      mockedBridgeFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const config = { apiKey: 'test-key', model: 'qwen-vl-plus' };

      await expect(analyzeImage(config, 'base64data', 'prompt')).rejects.toThrow(
        'DashScope API error: 500'
      );
    });
  });

  describe('imageElementToBase64', () => {
    // These tests need document.createElement, which doesn't exist in Node.
    // We stub a minimal document mock for the canvas-based tests.
    let originalDocument: typeof document | undefined;

    beforeEach(() => {
      originalDocument = globalThis.document;
    });

    afterEach(() => {
      // Restore document to its original state (undefined in Node)
      if (originalDocument === undefined) {
        // @ts-expect-error -- restoring global mock
        delete globalThis.document;
      } else {
        globalThis.document = originalDocument;
      }
    });

    it('should extract base64 from data: URL images', async () => {
      const img = {
        src: 'data:image/png;base64,iVBORw0KGgo=',
        naturalWidth: 100,
        naturalHeight: 100,
      } as HTMLImageElement;

      const result = await imageElementToBase64(img);
      expect(result).toBe('iVBORw0KGgo=');
    });

    it('should draw image to canvas for blob: or http: URLs and return PNG base64', async () => {
      const mockCtx = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockCtx),
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,Y2FudmFzZGF0YQ=='),
        width: 0,
        height: 0,
      };

      // @ts-expect-error -- mocking document for test environment
      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      const img = {
        src: 'blob:http://localhost/test',
        naturalWidth: 100,
        naturalHeight: 200,
      } as HTMLImageElement;

      const result = await imageElementToBase64(img);

      expect(mockCanvas.width).toBe(100);
      expect(mockCanvas.height).toBe(200);
      expect(mockCtx.drawImage).toHaveBeenCalledWith(img, 0, 0, 100, 200);
      expect(result).toBe('Y2FudmFzZGF0YQ==');
    });

    it('should resize images larger than 2048px on longest side', async () => {
      const mockCtx = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockCtx),
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,cmVzaXplZA=='),
        width: 0,
        height: 0,
      };

      // @ts-expect-error -- mocking document for test environment
      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      // Landscape: 4000x2000
      const img = {
        src: 'http://example.com/large.png',
        naturalWidth: 4000,
        naturalHeight: 2000,
      } as HTMLImageElement;

      await imageElementToBase64(img);

      // Longest side (4000) scaled to 2048, other side proportionally
      expect(mockCanvas.width).toBe(2048);
      expect(mockCanvas.height).toBe(1024);
      expect(mockCtx.drawImage).toHaveBeenCalledWith(img, 0, 0, 2048, 1024);
    });

    it('should resize portrait images larger than 2048px correctly', async () => {
      const mockCtx = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockCtx),
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,cmVzaXplZA=='),
        width: 0,
        height: 0,
      };

      // @ts-expect-error -- mocking document for test environment
      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      // Portrait: 1500x3000
      const img = {
        src: 'http://example.com/tall.png',
        naturalWidth: 1500,
        naturalHeight: 3000,
      } as HTMLImageElement;

      await imageElementToBase64(img);

      // Longest side (3000) scaled to 2048
      expect(mockCanvas.width).toBe(1024);
      expect(mockCanvas.height).toBe(2048);
      expect(mockCtx.drawImage).toHaveBeenCalledWith(img, 0, 0, 1024, 2048);
    });

    it('should throw descriptive error on canvas cross-origin taint', async () => {
      const mockCtx = {
        drawImage: vi.fn(),
      };
      const mockCanvas = {
        getContext: vi.fn().mockReturnValue(mockCtx),
        toDataURL: vi.fn().mockImplementation(() => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        }),
        width: 0,
        height: 0,
      };

      // @ts-expect-error -- mocking document for test environment
      globalThis.document = {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      };

      const img = {
        src: 'https://external.com/cors-image.png',
        naturalWidth: 100,
        naturalHeight: 100,
      } as HTMLImageElement;

      await expect(imageElementToBase64(img)).rejects.toThrow();
    });
  });
});
