// Unit tests for the History Parser module — pure conversion functions.

import { describe, expect, it, vi } from 'vitest';
import {
  extractExecutionTimestamp,
  extractHistoryImage,
  extractPromptNodes,
  isPromptNodesRecord,
  isHistoryEntrySuccessful,
  buildLocalDownloadsMap,
} from './historyParser';

// ---------------------------------------------------------------------------
// extractExecutionTimestamp
// ---------------------------------------------------------------------------

describe('extractExecutionTimestamp', () => {
  it('returns Date.now() when entry has no status and no start_time', () => {
    const before = Date.now();
    const result = extractExecutionTimestamp({} as any);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('uses start_time (in seconds) when no status messages exist', () => {
    const result = extractExecutionTimestamp({ start_time: 1700000000 } as any);
    expect(result).toBe(1700000000 * 1000);
  });

  it('extracts timestamp from execution_success message (seconds)', () => {
    const result = extractExecutionTimestamp({
      status: {
        messages: [['execution_success', { timestamp: 1700000000 }]],
      },
    } as any);
    expect(result).toBe(1700000000 * 1000);
  });

  it('extracts timestamp from execution_success message (milliseconds)', () => {
    const result = extractExecutionTimestamp({
      status: {
        messages: [['execution_success', { timestamp: 1700000000000 }]],
      },
    } as any);
    expect(result).toBe(1700000000000);
  });

  it('falls back to start_time when no execution_success message', () => {
    const result = extractExecutionTimestamp({
      status: { messages: [['other_type', {}]] },
      start_time: 1700000000,
    } as any);
    expect(result).toBe(1700000000 * 1000);
  });

  it('skips malformed messages', () => {
    const result = extractExecutionTimestamp({
      status: {
        messages: [
          ['execution_success', null],     // null payload
          'not-an-array',                  // not an array
          ['execution_success', { no_timestamp: 1 }],  // no timestamp
        ],
      },
      start_time: 1700000000,
    } as any);
    expect(result).toBe(1700000000 * 1000);
  });
});

// ---------------------------------------------------------------------------
// extractPromptNodes / isPromptNodesRecord
// ---------------------------------------------------------------------------

describe('isPromptNodesRecord', () => {
  it('returns true for a record of node objects', () => {
    expect(isPromptNodesRecord({
      '10': { class_type: 'KSampler', inputs: { steps: 20 } },
    })).toBe(true);
  });

  it('returns true when nodes have "type" instead of "class_type"', () => {
    expect(isPromptNodesRecord({
      '10': { type: 'KSampler', inputs: {} },
    })).toBe(true);
  });

  it('returns true when nodes have an inputs object', () => {
    expect(isPromptNodesRecord({
      '10': { inputs: { x: 1 } },
    })).toBe(true);
  });

  it('returns false for non-objects or empty objects', () => {
    expect(isPromptNodesRecord(null)).toBe(false);
    expect(isPromptNodesRecord(undefined)).toBe(false);
    expect(isPromptNodesRecord({})).toBe(false);
    expect(isPromptNodesRecord([])).toBe(false);
    expect(isPromptNodesRecord('string')).toBe(false);
  });

  it('returns false when no value looks like a node', () => {
    expect(isPromptNodesRecord({ x: 1, y: 'foo' })).toBe(false);
  });
});

describe('extractPromptNodes', () => {
  it('returns the input when it is already a prompt record', () => {
    const prompt = { '10': { class_type: 'X', inputs: {} } };
    expect(extractPromptNodes(prompt)).toBe(prompt);
  });

  it('extracts from a tuple at index 2', () => {
    const workflow = { '10': { class_type: 'X', inputs: {} } };
    const tuple = [1, 'abc', workflow, { extra: 'data' }];
    expect(extractPromptNodes(tuple)).toBe(workflow);
  });

  it('extracts from a wrapped object with "prompt" key', () => {
    const workflow = { '10': { class_type: 'X', inputs: {} } };
    expect(extractPromptNodes({ prompt: workflow })).toBe(workflow);
  });

  it('extracts from a wrapped object with "workflow" key', () => {
    const workflow = { '10': { class_type: 'X', inputs: {} } };
    expect(extractPromptNodes({ workflow })).toBe(workflow);
  });

  it('extracts from a wrapped object with "nodes" key', () => {
    const nodes = { '10': { class_type: 'X', inputs: {} } };
    expect(extractPromptNodes({ nodes })).toBe(nodes);
  });

  it('returns empty object for unrecognized shapes', () => {
    expect(extractPromptNodes(null)).toEqual({});
    expect(extractPromptNodes(undefined)).toEqual({});
    expect(extractPromptNodes('string')).toEqual({});
    expect(extractPromptNodes({ unrelated: 'data' })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// isHistoryEntrySuccessful
// ---------------------------------------------------------------------------

describe('isHistoryEntrySuccessful', () => {
  it('returns true when status_str is missing or not "error"', () => {
    expect(isHistoryEntrySuccessful({} as any)).toBe(true);
    expect(isHistoryEntrySuccessful({ status_str: 'success' } as any)).toBe(true);
  });

  it('returns false when status_str is "error" at the top level', () => {
    expect(isHistoryEntrySuccessful({ status_str: 'error' } as any)).toBe(false);
  });

  it('returns false when nested status.status_str is "error"', () => {
    expect(isHistoryEntrySuccessful({
      status: { status_str: 'error' },
    } as any)).toBe(false);
  });

  it('prefers top-level status_str when both are present', () => {
    expect(isHistoryEntrySuccessful({
      status_str: 'success',
      status: { status_str: 'error' },
    } as any)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildLocalDownloadsMap
// ---------------------------------------------------------------------------

describe('buildLocalDownloadsMap', () => {
  it('groups file paths by promptId', () => {
    const downloads = [
      { promptId: 'a', filePath: '/a/1.png', downloadedAt: 1 },
      { promptId: 'a', filePath: '/a/2.png', downloadedAt: 2 },
      { promptId: 'b', filePath: '/b/1.png', downloadedAt: 3 },
    ];
    const map = buildLocalDownloadsMap(downloads);
    expect(map.get('a')).toEqual(['/a/1.png', '/a/2.png']);
    expect(map.get('b')).toEqual(['/b/1.png']);
  });

  it('returns an empty map for an empty list', () => {
    expect(buildLocalDownloadsMap([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractHistoryImage — needs a mock ComfyUIClient
// ---------------------------------------------------------------------------

describe('extractHistoryImage', () => {
  it('builds preview and full URLs for each image', () => {
    const mockClient = {
      getViewUrl: vi.fn((opts: any) => `/view?filename=${opts.filename}&type=${opts.type}&preview=${opts.preview}`),
    } as any;

    const outputs = {
      '9': {
        images: [
          { filename: 'a.png', subfolder: 'sub', type: 'output' },
          { filename: 'b.png', subfolder: '', type: 'output' },
        ],
      },
    };

    const result = extractHistoryImage(outputs, mockClient);
    expect(result.imageName).toBe('a.png');
    expect(result.images).toHaveLength(2);
    expect(result.images[0].thumbnailUrl).toContain('preview=true');
    expect(result.images[0].imageUrl).toContain('preview=false');
    expect(result.thumbnailUrl).toContain('filename=a.png');
  });

  it('skips image entries without a filename', () => {
    const mockClient = { getViewUrl: vi.fn() } as any;
    const outputs = {
      '9': {
        images: [
          { filename: 'good.png' },
          { /* no filename */ },
          null,
        ],
      },
    };
    const result = extractHistoryImage(outputs, mockClient);
    expect(result.images).toHaveLength(1);
  });

  it('returns "Unknown Image" name when no images exist', () => {
    const mockClient = { getViewUrl: vi.fn() } as any;
    const result = extractHistoryImage({}, mockClient);
    expect(result.imageName).toBe('Unknown Image');
    expect(result.images).toEqual([]);
  });

  it('defaults subfolder and type to empty / "output"', () => {
    const mockClient = { getViewUrl: vi.fn((opts: any) => JSON.stringify(opts)) } as any;
    const outputs = {
      '9': { images: [{ filename: 'x.png' }] },
    };
    const result = extractHistoryImage(outputs, mockClient);
    expect(result.imageUrl).toContain('"subfolder":""');
    expect(result.imageUrl).toContain('"type":"output"');
  });
});
