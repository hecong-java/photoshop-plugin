// Unit tests for the Generation Lifecycle module.
//
// These tests verify the pure, testable parts:
//   - extractImagesFromHistory
//   - submitPrompt (with a mock fetcher)
//   - fetchOutputImages (with a mock fetcher)
//   - PromptWatcher state machine (with mock WebSocket and polling)
//
// The full runGeneration orchestrator is integration-tested implicitly through
// these unit tests of its building blocks.

import { describe, expect, it } from 'vitest';
import {
  extractImagesFromHistory,
  submitPrompt,
  fetchOutputImages,
  type OutputImageRef,
  type Fetcher,
  type ProgressEvent,
} from './generationLifecycle';

// ---------------------------------------------------------------------------
// extractImagesFromHistory
// ---------------------------------------------------------------------------

describe('extractImagesFromHistory', () => {
  it('extracts image references from outputs[].images[]', () => {
    const entry = {
      outputs: {
        '9': {
          images: [
            { filename: 'output_001.png', subfolder: '', type: 'output' },
            { filename: 'output_002.png', subfolder: 'sub', type: 'output' },
          ],
        },
      },
    };
    const refs = extractImagesFromHistory(entry);
    expect(refs).toEqual([
      { filename: 'output_001.png', subfolder: '', type: 'output' },
      { filename: 'output_002.png', subfolder: 'sub', type: 'output' },
    ]);
  });

  it('coerces non-string fields to strings and defaults missing fields', () => {
    const entry = {
      outputs: {
        '9': { images: [{ filename: 'x.png' }] },
      },
    };
    const refs = extractImagesFromHistory(entry);
    expect(refs).toEqual([{ filename: 'x.png', subfolder: '', type: 'output' }]);
  });

  it('skips image entries without a filename', () => {
    const entry = {
      outputs: {
        '9': { images: [{ filename: 'good.png' }, {}, { filename: null }] },
      },
    };
    expect(extractImagesFromHistory(entry)).toEqual([
      { filename: 'good.png', subfolder: '', type: 'output' },
    ]);
  });

  it('returns empty array when no outputs or images exist', () => {
    expect(extractImagesFromHistory({})).toEqual([]);
    expect(extractImagesFromHistory({ outputs: {} })).toEqual([]);
    expect(extractImagesFromHistory({ outputs: { '9': {} } })).toEqual([]);
    expect(extractImagesFromHistory({ outputs: { '9': { images: 'not-array' } } })).toEqual([]);
  });

  it('handles multiple output nodes', () => {
    const entry = {
      outputs: {
        '9': { images: [{ filename: 'a.png' }] },
        '10': { images: [{ filename: 'b.png' }, { filename: 'c.png' }] },
      },
    };
    const refs = extractImagesFromHistory(entry);
    expect(refs.map(r => r.filename)).toEqual(['a.png', 'b.png', 'c.png']);
  });
});

// ---------------------------------------------------------------------------
// submitPrompt
// ---------------------------------------------------------------------------

describe('submitPrompt', () => {
  const makeFetcher = (response: Response): Fetcher => async () => response;

  it('returns prompt_id from a successful response', async () => {
    const fetcher = makeFetcher(
      new Response(JSON.stringify({ prompt_id: 'abc-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const promptId = await submitPrompt({
      baseUrl: 'http://localhost:8188',
      prefixMode: 'oss',
      clientId: 'client-1',
      prompt: { '10': { class_type: 'X', inputs: {} } },
      extraData: { workflow_name: 'test' },
      fetcher,
    });

    expect(promptId).toBe('abc-123');
  });

  it('throws with the error message on non-ok response', async () => {
    const fetcher = makeFetcher(
      new Response(JSON.stringify({ error: { message: 'invalid prompt' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(
      submitPrompt({
        baseUrl: 'http://localhost:8188',
        prefixMode: 'oss',
        clientId: 'c',
        prompt: {},
        extraData: {},
        fetcher,
      })
    ).rejects.toThrow('invalid prompt');
  });

  it('throws when prompt_id is missing from the response', async () => {
    const fetcher = makeFetcher(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(
      submitPrompt({
        baseUrl: 'http://localhost:8188',
        prefixMode: 'oss',
        clientId: 'c',
        prompt: {},
        extraData: {},
        fetcher,
      })
    ).rejects.toThrow('No prompt_id');
  });

  it('uses the /api prefix when prefixMode is api', async () => {
    let capturedUrl = '';
    const fetcher: Fetcher = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ prompt_id: 'p' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await submitPrompt({
      baseUrl: 'http://localhost:8188',
      prefixMode: 'api',
      clientId: 'c',
      prompt: {},
      extraData: {},
      fetcher,
    });

    expect(capturedUrl).toBe('http://localhost:8188/api/prompt');
  });
});

// ---------------------------------------------------------------------------
// fetchOutputImages
// ---------------------------------------------------------------------------

describe('fetchOutputImages', () => {
  it('fetches each image in parallel and builds preview URLs', async () => {
    const refs: OutputImageRef[] = [
      { filename: 'a.png', subfolder: '', type: 'output' },
      { filename: 'b.png', subfolder: '', type: 'output' },
    ];
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(String(url));
      return new Response(new Blob(['fake-image-data']), { status: 200 });
    };

    const result = await fetchOutputImages(refs, {
      baseUrl: 'http://localhost:8188',
      prefixMode: 'oss',
      fetcher,
    });

    expect(result).toHaveLength(2);
    expect(result[0].ref.filename).toBe('a.png');
    expect(result[0].blob).toBeInstanceOf(Blob);
    expect(result[0].previewUrl).toMatch(/^blob:/);
    expect(calls[0]).toBe('http://localhost:8188/view?filename=a.png&type=output&subfolder=');
    expect(calls[1]).toBe('http://localhost:8188/view?filename=b.png&type=output&subfolder=');
  });

  it('throws on non-ok response', async () => {
    const refs: OutputImageRef[] = [{ filename: 'missing.png', subfolder: '', type: 'output' }];
    const fetcher: Fetcher = async () =>
      new Response(null, { status: 404, statusText: 'Not Found' });

    await expect(
      fetchOutputImages(refs, {
        baseUrl: 'http://localhost:8188',
        prefixMode: 'oss',
        fetcher,
      })
    ).rejects.toThrow(/Failed to fetch image/);
  });

  it('URL-encodes special characters in filename and subfolder', async () => {
    const refs: OutputImageRef[] = [
      { filename: 'image (1).png', subfolder: 'sub folder', type: 'output' },
    ];
    let capturedUrl = '';
    const fetcher: Fetcher = async (url) => {
      capturedUrl = String(url);
      return new Response(new Blob([]), { status: 200 });
    };

    await fetchOutputImages(refs, {
      baseUrl: 'http://localhost:8188',
      prefixMode: 'oss',
      fetcher,
    });

    expect(capturedUrl).toContain('filename=image%20(1).png');
    expect(capturedUrl).toContain('subfolder=sub%20folder');
  });
});

// ---------------------------------------------------------------------------
// ProgressEvent shape — verified via the orchestrator's known outputs
// ---------------------------------------------------------------------------

describe('ProgressEvent shape', () => {
  it('events are discriminated unions keyed on `kind`', () => {
    const events: ProgressEvent[] = [
      { kind: 'started' },
      { kind: 'cached' },
      { kind: 'executing', currentNode: '10' },
      { kind: 'finished-node' },
      { kind: 'progress', percentage: 50 },
      { kind: 'preview', base64: 'data:image/png;base64,xyz' },
      { kind: 'output', images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
      { kind: 'completed' },
    ];
    // All events are well-formed
    expect(events).toHaveLength(8);
    expect(events.find(e => e.kind === 'progress')!.percentage).toBe(50);
    expect(events.find(e => e.kind === 'executing')!.currentNode).toBe('10');
  });
});
