// Unit tests for the Workflow Engine — pure functions extracted from Draw.tsx.
// These tests are the proof of value for Step 1.1: before the extraction, none
// of this logic was reachable from tests because it lived inside a React component.

import { describe, expect, it } from 'vitest';
import {
  sanitizePromptGraph,
  applyInputValuesToPrompt,
  enforceLatestImageInputs,
  getPromptNodeInfo,
  extractInputValuesFromHistoryParams,
  getWorkflowDisplayMeta,
  getDefaultWorkflow,
} from './workflowEngine';
import type { WorkflowInput } from './workflowTypes';

// ---------------------------------------------------------------------------
// sanitizePromptGraph
// ---------------------------------------------------------------------------

describe('sanitizePromptGraph', () => {
  it('strips skipped node types (Note, Reroute, etc.) from the prompt', () => {
    const prompt = {
      '10': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat' } },
      '11': { class_type: 'Note', inputs: { text: 'ignore me' } },
      '12': { class_type: 'Reroute', inputs: {} },
      '13': { class_type: 'KSampler', inputs: { steps: 20 } },
    };
    const result = sanitizePromptGraph(prompt);
    expect(Object.keys(result)).toEqual(['10', '13']);
  });

  it('preserves nodes whose class_type is "type" instead of "class_type"', () => {
    const prompt = {
      '1': { type: 'CLIPTextEncode', inputs: { text: 'prompt' } },
    };
    expect(sanitizePromptGraph(prompt)).toEqual(prompt);
  });

  it('drops entries that are null, non-objects, or arrays', () => {
    const prompt = {
      '1': { class_type: 'X', inputs: {} },
      '2': null,
      '3': 'string-not-object',
      '4': [],
    };
    const result = sanitizePromptGraph(prompt);
    expect(Object.keys(result)).toEqual(['1']);
  });

  it('returns an empty object when given an empty prompt', () => {
    expect(sanitizePromptGraph({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// applyInputValuesToPrompt
// ---------------------------------------------------------------------------

describe('applyInputValuesToPrompt', () => {
  it('overrides prompt values using inputName_nodeId keys', () => {
    const prompt = {
      '10': { class_type: 'KSampler', inputs: { steps: 20, cfg: 7 } },
      '11': { class_type: 'CLIPTextEncode', inputs: { text: 'old' } },
    };
    const values = {
      steps_10: 30,
      cfg_10: 8,
      text_11: 'new prompt',
    };
    const result = applyInputValuesToPrompt(prompt, values);
    expect((result as any)['10'].inputs.steps).toBe(30);
    expect((result as any)['10'].inputs.cfg).toBe(8);
    expect((result as any)['11'].inputs.text).toBe('new prompt');
  });

  it('preserves linked array references (e.g. ["114", 0]) — do not overwrite with hardcoded values', () => {
    const prompt = {
      '10': {
        class_type: 'EmptyLatentImage',
        inputs: { width: ['6', 0], height: ['6', 1] },
      },
    };
    const values = { width_10: 1024, height_10: 1024 };
    const result = applyInputValuesToPrompt(prompt, values);
    expect((result as any)['10'].inputs.width).toEqual(['6', 0]);
    expect((result as any)['10'].inputs.height).toEqual(['6', 1]);
  });

  it('skips SKIPPED_NODE_TYPES (Note, Reroute, PrimitiveNode)', () => {
    const prompt = {
      '10': { class_type: 'Note', inputs: { text: 'comment' } },
    };
    const values = { text_10: 'overwritten' };
    const result = applyInputValuesToPrompt(prompt, values);
    // Should NOT overwrite Note nodes
    expect((result as any)['10'].inputs.text).toBe('comment');
  });

  it('does not mutate the original prompt', () => {
    const prompt = {
      '10': { class_type: 'X', inputs: { v: 1 } },
    };
    const values = { v_10: 99 };
    applyInputValuesToPrompt(prompt, values);
    expect((prompt as any)['10'].inputs.v).toBe(1);
  });

  it('skips keys that do not have a valid inputName_nodeId shape', () => {
    const prompt = { '10': { class_type: 'X', inputs: { v: 1 } } };
    const values = { 'no-underscore': 99, '_10': 88, 'name_': 77 };
    const result = applyInputValuesToPrompt(prompt, values);
    expect((result as any)['10'].inputs).toEqual({ v: 1 });
  });
});

// ---------------------------------------------------------------------------
// enforceLatestImageInputs
// ---------------------------------------------------------------------------

describe('enforceLatestImageInputs', () => {
  it('writes image filenames into the correct node inputs', () => {
    const prompt = {
      '20': { class_type: 'LoadImage', inputs: { image: '' } },
    };
    const inputsMeta: WorkflowInput[] = [
      { name: 'image_20', type: 'image', label: '图片' },
    ];
    const values = { image_20: 'cat.png' };
    enforceLatestImageInputs(prompt, values, inputsMeta);
    expect((prompt as any)['20'].inputs.image).toBe('cat.png');
  });

  it('sets upload="image" for LoadImage nodes when image is non-empty and upload is missing', () => {
    const prompt = {
      '20': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
    };
    const inputsMeta: WorkflowInput[] = [
      { name: 'image_20', type: 'image', label: '图片' },
    ];
    enforceLatestImageInputs(prompt, { image_20: 'new.png' }, inputsMeta);
    expect((prompt as any)['20'].inputs.upload).toBe('image');
  });

  it('does not overwrite upload if already set', () => {
    const prompt = {
      '20': { class_type: 'LoadImage', inputs: { image: '', upload: 'custom' } },
    };
    const inputsMeta: WorkflowInput[] = [
      { name: 'image_20', type: 'image', label: '图片' },
    ];
    enforceLatestImageInputs(prompt, { image_20: 'cat.png' }, inputsMeta);
    expect((prompt as any)['20'].inputs.upload).toBe('custom');
  });

  it('skips non-image inputs and empty filenames', () => {
    const prompt = {
      '20': { class_type: 'LoadImage', inputs: { image: 'keep.png' } },
    };
    const inputsMeta: WorkflowInput[] = [
      { name: 'image_20', type: 'image', label: '图片' },
    ];
    enforceLatestImageInputs(prompt, { image_20: '   ' }, inputsMeta);
    expect((prompt as any)['20'].inputs.image).toBe('keep.png');
  });
});

// ---------------------------------------------------------------------------
// getPromptNodeInfo
// ---------------------------------------------------------------------------

describe('getPromptNodeInfo', () => {
  it('extracts node ids, types, and input keys by type', () => {
    const params = {
      '10': {
        class_type: 'KSampler',
        inputs: { steps: 20, cfg: 7, seed: 42 },
      },
      '11': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'a cat' },
      },
    };
    const info = getPromptNodeInfo(params);
    expect([...info.nodeIds]).toEqual(['10', '11']);
    expect([...info.nodeTypes].sort()).toEqual(['CLIPTextEncode', 'KSampler']);
    expect([...info.inputKeysByType.get('KSampler')!].sort()).toEqual(['cfg', 'seed', 'steps']);
    expect([...info.inputKeysByType.get('CLIPTextEncode')!]).toEqual(['text']);
  });

  it('falls back to "type" when "class_type" is missing', () => {
    const params = {
      '1': { type: 'PrimitiveNode', inputs: { value: 1 } },
    };
    const info = getPromptNodeInfo(params);
    expect([...info.nodeTypes]).toEqual(['PrimitiveNode']);
  });

  it('returns empty sets for empty or invalid input', () => {
    expect(getPromptNodeInfo(undefined).nodeTypes.size).toBe(0);
    expect(getPromptNodeInfo({}).nodeTypes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractInputValuesFromHistoryParams
// ---------------------------------------------------------------------------

describe('extractInputValuesFromHistoryParams', () => {
  it('restores values by exact nodeId match when class_type matches', () => {
    const params = {
      '10': {
        class_type: 'KSampler',
        inputs: { steps: 25, cfg: 8 },
      },
    };
    const targetInputs: WorkflowInput[] = [
      { name: 'steps_10', type: 'number', label: 'Steps', classType: 'KSampler', nodeId: '10' },
      { name: 'cfg_10', type: 'number', label: 'CFG', classType: 'KSampler', nodeId: '10' },
    ];
    const restored = extractInputValuesFromHistoryParams(params, targetInputs);
    expect(restored.steps_10).toBe(25);
    expect(restored.cfg_10).toBe(8);
  });

  it('falls back to class_type match when nodeId is missing', () => {
    const params = {
      '99': {
        class_type: 'KSampler',
        inputs: { steps: 15 },
      },
    };
    const targetInputs: WorkflowInput[] = [
      { name: 'steps_10', type: 'number', label: 'Steps', classType: 'KSampler', nodeId: '10' },
    ];
    const restored = extractInputValuesFromHistoryParams(params, targetInputs);
    expect(restored.steps_10).toBe(15);
  });

  it('coerces string numbers to numbers for number-type inputs', () => {
    const params = {
      '10': { class_type: 'X', inputs: { steps: '30' } },
    };
    const targetInputs: WorkflowInput[] = [
      { name: 'steps_10', type: 'number', label: 'Steps', classType: 'X', nodeId: '10' },
    ];
    const restored = extractInputValuesFromHistoryParams(params, targetInputs);
    expect(restored.steps_10).toBe(30);
  });

  it('returns empty object when no inputs match', () => {
    const params = { '1': { class_type: 'Other', inputs: { x: 1 } } };
    const targetInputs: WorkflowInput[] = [
      { name: 'steps_10', type: 'number', label: 'Steps', classType: 'KSampler', nodeId: '10' },
    ];
    expect(extractInputValuesFromHistoryParams(params, targetInputs)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getWorkflowDisplayMeta
// ---------------------------------------------------------------------------

describe('getWorkflowDisplayMeta', () => {
  it('strips ps-workflows/ prefix and returns directory + fileLabel', () => {
    const meta = getWorkflowDisplayMeta({ name: 'foo.json', path: 'ps-workflows/portraits/foo.json' });
    expect(meta.directory).toBe('portraits');
    expect(meta.fileLabel).toBe('foo');
    expect(meta.hasSubDirectory).toBe(true);
  });

  it('uses ROOT_WORKFLOW_GROUP for top-level files', () => {
    const meta = getWorkflowDisplayMeta({ name: 'top.json', path: 'ps-workflows/top.json' });
    expect(meta.directory).toBe('根目录');
    expect(meta.hasSubDirectory).toBe(false);
  });

  it('handles missing .json extension', () => {
    const meta = getWorkflowDisplayMeta({ name: 'workflow', path: 'workflow' });
    expect(meta.fileLabel).toBe('workflow');
  });
});

// ---------------------------------------------------------------------------
// getDefaultWorkflow
// ---------------------------------------------------------------------------

describe('getDefaultWorkflow', () => {
  it('returns the alphabetically-first workflow with a subdirectory when available', () => {
    const workflows = [
      { name: 'a.json', path: 'ps-workflows/a.json', isDirectory: false },
      { name: 'b.json', path: 'ps-workflows/cat/b.json', isDirectory: false },
      { name: 'a.json', path: 'ps-workflows/banana/a.json', isDirectory: false },
    ];
    const result = getDefaultWorkflow(workflows);
    // Both 'banana/a.json' and 'cat/b.json' have subdirs; banana < cat alphabetically
    expect(result?.path).toBe('ps-workflows/banana/a.json');
  });

  it('skips directory entries', () => {
    const workflows = [
      { name: 'subdir', path: 'ps-workflows/subdir', isDirectory: true },
      { name: 'a.json', path: 'ps-workflows/a.json', isDirectory: false },
    ];
    const result = getDefaultWorkflow(workflows);
    expect(result?.name).toBe('a.json');
  });

  it('returns null for an empty list', () => {
    expect(getDefaultWorkflow([])).toBeNull();
  });
});
