import { create } from 'zustand';
import { getDefaultPrompt } from '../services/clusterPromptReverseService';

export type FlowStep = 'closed' | 'preview' | 'prompt' | 'loading' | 'result';

interface PromptReverseState {
  step: FlowStep;
  imageBase64: string | null;
  imagePreviewUrl: string | null;
  assetId: string | null;
  customPrompt: string;
  result: string | null;
  error: string | null;
  abortController: AbortController | null;

  startFlow: (imageBase64: string | null, imagePreviewUrl: string, assetId?: string) => void;
  goToPrompt: () => void;
  setCustomPrompt: (prompt: string) => void;
  setLoading: () => void;
  setResult: (result: string) => void;
  setError: (error: string) => void;
  reset: () => void;
  setAbortController: (controller: AbortController | null) => void;
}

const INITIAL_STATE = {
  step: 'closed' as FlowStep,
  imageBase64: null as string | null,
  imagePreviewUrl: null as string | null,
  assetId: null as string | null,
  customPrompt: '',
  result: null as string | null,
  error: null as string | null,
  abortController: null as AbortController | null,
};

export const usePromptReverseStore = create<PromptReverseState>()((set, get) => ({
  ...INITIAL_STATE,

  startFlow: (imageBase64, imagePreviewUrl, assetId) => {
    const { step, abortController } = get();
    console.log('[PromptReverseStore] startFlow called:', { imageBase64: !!imageBase64, imagePreviewUrl: imagePreviewUrl?.substring(0, 60), assetId, currentStep: step });
    if (step === 'loading' && abortController) {
      abortController.abort();
    }
    set({
      ...INITIAL_STATE,
      step: 'preview',
      imageBase64: imageBase64 ?? null,
      imagePreviewUrl,
      assetId: assetId ?? null,
    });
    // Fetch default prompt from backend in background
    getDefaultPrompt().then((prompt) => {
      // Only update if still in preview/prompt step (user hasn't closed)
      const currentStep = get().step;
      if (currentStep === 'preview' || currentStep === 'prompt') {
        set({ customPrompt: prompt });
      }
    });
  },

  goToPrompt: () => {
    set({ step: 'prompt' });
  },

  setCustomPrompt: (prompt) => {
    set({ customPrompt: prompt });
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
}));
