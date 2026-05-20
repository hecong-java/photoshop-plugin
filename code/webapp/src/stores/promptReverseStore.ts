import { create } from 'zustand';
import { PROMPT_TEMPLATES, type PromptTemplate } from '../services/dashscope';

export type FlowStep = 'closed' | 'preview' | 'template' | 'loading' | 'result';

interface PromptReverseState {
  step: FlowStep;
  imageBase64: string | null;
  imagePreviewUrl: string | null;
  assetId: string | null;
  selectedTemplate: string | null;
  result: string | null;
  error: string | null;
  abortController: AbortController | null;

  startFlow: (imageBase64: string, imagePreviewUrl: string, assetId?: string) => void;
  selectTemplate: (templateId: string) => void;
  setLoading: () => void;
  setResult: (result: string) => void;
  setError: (error: string) => void;
  reset: () => void;
  setAbortController: (controller: AbortController | null) => void;
  getActiveTemplate: () => PromptTemplate | undefined;
}

const INITIAL_STATE = {
  step: 'closed' as FlowStep,
  imageBase64: null as string | null,
  imagePreviewUrl: null as string | null,
  assetId: null as string | null,
  selectedTemplate: null as string | null,
  result: null as string | null,
  error: null as string | null,
  abortController: null as AbortController | null,
};

export const usePromptReverseStore = create<PromptReverseState>()((set, get) => ({
  ...INITIAL_STATE,

  startFlow: (imageBase64, imagePreviewUrl, assetId) => {
    const { step, abortController } = get();
    // If currently loading, abort the in-flight request
    if (step === 'loading' && abortController) {
      abortController.abort();
    }
    set({
      ...INITIAL_STATE,
      step: 'preview',
      imageBase64,
      imagePreviewUrl,
      assetId: assetId ?? null,
    });
  },

  selectTemplate: (templateId) => {
    set({ selectedTemplate: templateId, step: 'template' });
  },

  setLoading: () => {
    set({ step: 'loading', error: null, result: null });
  },

  setResult: (result) => {
    set({ result, error: null, step: 'result' });
  },

  setError: (error) => {
    set({ error, step: 'result' });
  },

  reset: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set(INITIAL_STATE);
  },

  setAbortController: (controller) => {
    set({ abortController: controller });
  },

  getActiveTemplate: () => {
    const { selectedTemplate } = get();
    return PROMPT_TEMPLATES.find((t) => t.id === selectedTemplate);
  },
}));
