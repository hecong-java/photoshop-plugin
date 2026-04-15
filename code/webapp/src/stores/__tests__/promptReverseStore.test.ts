import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePromptReverseStore } from '../promptReverseStore';

describe('promptReverseStore', () => {
  beforeEach(() => {
    // Reset store state to initial values
    usePromptReverseStore.getState().reset();
  });

  it('Test 1: Initial state has step closed, imageBase64 null, imagePreviewUrl null, selectedTemplate null, result null, error null', () => {
    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('closed');
    expect(state.imageBase64).toBeNull();
    expect(state.imagePreviewUrl).toBeNull();
    expect(state.selectedTemplate).toBeNull();
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
  });

  it('Test 2: startFlow(base64, previewUrl) sets step to preview, imageBase64 and imagePreviewUrl to provided values', () => {
    usePromptReverseStore.getState().startFlow('base64data', 'https://example.com/img.png');

    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('preview');
    expect(state.imageBase64).toBe('base64data');
    expect(state.imagePreviewUrl).toBe('https://example.com/img.png');
  });

  it('Test 3: selectTemplate("detailed") sets selectedTemplate to "detailed" and step to "template"', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().selectTemplate('detailed');

    const state = usePromptReverseStore.getState();
    expect(state.selectedTemplate).toBe('detailed');
    expect(state.step).toBe('template');
  });

  it('Test 4: setLoading() sets step to "loading"', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().selectTemplate('detailed');
    usePromptReverseStore.getState().setLoading();

    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('loading');
  });

  it('Test 5: setResult("some result text") sets result to provided text and step to "result"', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().setResult('some result text');

    const state = usePromptReverseStore.getState();
    expect(state.result).toBe('some result text');
    expect(state.step).toBe('result');
  });

  it('Test 6: setError("error msg") sets error to "error msg" and step to "result"', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().setError('error msg');

    const state = usePromptReverseStore.getState();
    expect(state.error).toBe('error msg');
    expect(state.step).toBe('result');
  });

  it('Test 7: reset() returns all state to initial values', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().selectTemplate('detailed');
    usePromptReverseStore.getState().setResult('result text');

    usePromptReverseStore.getState().reset();

    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('closed');
    expect(state.imageBase64).toBeNull();
    expect(state.imagePreviewUrl).toBeNull();
    expect(state.selectedTemplate).toBeNull();
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
    expect(state.abortController).toBeNull();
  });

  it('Test 8: setAbortController stores an AbortController reference', () => {
    const controller = new AbortController();
    usePromptReverseStore.getState().setAbortController(controller);

    const state = usePromptReverseStore.getState();
    expect(state.abortController).toBe(controller);
  });

  it('Test 9: When startFlow is called while step is "loading", the existing abortController is aborted first', () => {
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, 'abort');

    // Set up loading state with an abort controller
    usePromptReverseStore.getState().startFlow('base64-1', 'url-1');
    usePromptReverseStore.getState().selectTemplate('detailed');
    usePromptReverseStore.getState().setAbortController(controller);
    usePromptReverseStore.getState().setLoading();

    // Start a new flow while loading
    usePromptReverseStore.getState().startFlow('base64-2', 'url-2');

    expect(abortSpy).toHaveBeenCalled();
    const state = usePromptReverseStore.getState();
    expect(state.step).toBe('preview');
    expect(state.imageBase64).toBe('base64-2');
  });

  it('Test 10: getActiveTemplate returns PROMPT_TEMPLATES entry matching selectedTemplate id', () => {
    usePromptReverseStore.getState().startFlow('base64', 'url');
    usePromptReverseStore.getState().selectTemplate('detailed');

    const template = usePromptReverseStore.getState().getActiveTemplate();
    expect(template).toBeDefined();
    expect(template!.id).toBe('detailed');
    expect(template!.name).toBe('详细描述');
  });
});
