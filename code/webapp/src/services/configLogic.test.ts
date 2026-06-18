// Unit tests for the Config Logic module.

import { describe, expect, it } from 'vitest';
import { shouldDisplayNode, getAllowedInputs } from './configLogic';
import type { PluginConfig } from '../types/config';

const makeConfig = (nodes: PluginConfig['nodes']): PluginConfig => ({
  version: 'test',
  nodes,
});

// ---------------------------------------------------------------------------
// shouldDisplayNode
// ---------------------------------------------------------------------------

describe('shouldDisplayNode', () => {
  it('returns true when config is null (default: show everything)', () => {
    expect(shouldDisplayNode(null, 'KSampler')).toBe(true);
  });

  it('returns true when config has no nodes (empty filter = show all)', () => {
    expect(shouldDisplayNode(makeConfig([]), 'KSampler')).toBe(true);
  });

  it('returns true when a node with matching class_type exists', () => {
    const config = makeConfig([
      { class_type: 'KSampler' },
      { class_type: 'CLIPTextEncode' },
    ]);
    expect(shouldDisplayNode(config, 'KSampler')).toBe(true);
    expect(shouldDisplayNode(config, 'CLIPTextEncode')).toBe(true);
  });

  it('returns false when no node with matching class_type exists', () => {
    const config = makeConfig([
      { class_type: 'KSampler' },
      { class_type: 'CLIPTextEncode' },
    ]);
    expect(shouldDisplayNode(config, 'VAEDecode')).toBe(false);
  });

  it('is case-sensitive on class_type matching', () => {
    const config = makeConfig([{ class_type: 'KSampler' }]);
    expect(shouldDisplayNode(config, 'ksampler')).toBe(false);
    expect(shouldDisplayNode(config, 'KSAMPLER')).toBe(false);
  });

  it('handles undefined nodes array as if empty', () => {
    // The original store check `!config.nodes` handles this — keep parity
    const config = { version: 'test', nodes: undefined as any };
    expect(shouldDisplayNode(config, 'X')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllowedInputs
// ---------------------------------------------------------------------------

describe('getAllowedInputs', () => {
  it('returns null when config is null (all inputs allowed)', () => {
    expect(getAllowedInputs(null, 'KSampler')).toBeNull();
  });

  it('returns null when config has no nodes', () => {
    expect(getAllowedInputs(makeConfig([]), 'KSampler')).toBeNull();
  });

  it('returns null when no node matches the class_type', () => {
    const config = makeConfig([
      { class_type: 'KSampler', inputs: ['steps', 'cfg'] },
    ]);
    expect(getAllowedInputs(config, 'VAEDecode')).toBeNull();
  });

  it('returns the inputs array when the matching node has one', () => {
    const config = makeConfig([
      { class_type: 'KSampler', inputs: ['steps', 'cfg', 'seed'] },
    ]);
    expect(getAllowedInputs(config, 'KSampler')).toEqual(['steps', 'cfg', 'seed']);
  });

  it('returns null when the matching node has no inputs field (all inputs allowed)', () => {
    const config = makeConfig([
      { class_type: 'KSampler' }, // no inputs field
    ]);
    expect(getAllowedInputs(config, 'KSampler')).toBeNull();
  });

  it('returns the first matching node when multiple nodes share a class_type', () => {
    const config = makeConfig([
      { class_type: 'KSampler', inputs: ['steps'] },
      { class_type: 'KSampler', inputs: ['cfg'] },
    ]);
    expect(getAllowedInputs(config, 'KSampler')).toEqual(['steps']);
  });

  it('returns an empty array when the node explicitly allows no inputs', () => {
    const config = makeConfig([
      { class_type: 'KSampler', inputs: [] },
    ]);
    // Empty array is not null — caller can distinguish "explicit empty" from "no filter"
    expect(getAllowedInputs(config, 'KSampler')).toEqual([]);
  });
});
