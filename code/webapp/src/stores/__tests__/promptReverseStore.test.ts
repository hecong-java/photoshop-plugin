import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePromptReverseStore } from '../promptReverseStore';

describe('promptReverseStore', () => {
  beforeEach(() => {
    usePromptReverseStore.getState().reset();
  });

  it('initial state has step closed, null fields, default prompt', () => {
    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('closed');
    expect(state.imageBase64).toBeNull();
    expect(state.imagePreviewUrl).toBeNull();
    expect(state.customPrompt).toBe('');
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
  });

  it('startFlow sets step to preview with image data', () => {
    usePromptReverseStore.getState().startFlow('base64data', 'https://example.com/img.png');

    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('preview');
    expect(state.imageBase64).toBe('base64data');
    expect(state.imagePreviewUrl).toBe('https://example.com/img.png');
  });

  it('startFlow with assetId stores the assetId', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url', 'asset-123');

    const state = usePromptReverseStore.getState();
    expect(state.assetId).toBe('asset-123');
  });

  it('goToPrompt sets step to prompt', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().goToPrompt();

    expect(usePromptReverseStore.getState().step).toBe('prompt');
  });

  it('setCustomPrompt updates the prompt text', () => {
    usePromptReverseStore.getState().setCustomPrompt('custom prompt text');

    expect(usePromptReverseStore.getState().customPrompt).toBe('custom prompt text');
  });

  it('setLoading sets step to loading', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().setLoading();

    expect(usePromptReverseStore.getState().step).toBe('loading');
  });

  it('setResult sets result and step to result', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().setResult('some result text');

    const state = usePromptReverseStore.getState();
    expect(state.result).toBe('some result text');
    expect(state.step).toBe('result');
  });

  it('setError sets error and step to result', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().setError('error msg');

    const state = usePromptReverseStore.getState();
    expect(state.error).toBe('error msg');
    expect(state.step).toBe('result');
  });

  it('reset returns all state to initial values', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().setCustomPrompt('changed');
    usePromptReverseStore.getState().setResult('result text');

    usePromptReverseStore.getState().reset();

    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('closed');
    expect(state.imageBase64).toBeNull();
    expect(state.imagePreviewUrl).toBeNull();
    expect(state.customPrompt).toBe('');
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
    expect(state.abortController).toBeNull();
  });

  it('setAbortController stores an AbortController reference', () => {
    const controller = new AbortController();
    usePromptReverseStore.getState().setAbortController(controller);

    expect(usePromptReverseStore.getState().abortController).toBe(controller);
  });

  it('startFlow while loading aborts existing controller', () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, 'abort');

    usePromptReverseStore.getState().startFlow('base64-1', 'url-1');
    usePromptReverseStore.getState().setAbortController(controller);
    usePromptReverseStore.getState().setLoading();

    usePromptReverseStore.getState().startFlow('base64-2', 'url-2');

    expect(abortSpy).toHaveBeenCalled();
    expect(usePromptReverseStore.getState().step).toBe('preview');
    expect(usePromptReverseStore.getState().imageBase64).toBe('base64-2');
  });
});
