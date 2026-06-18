// Cluster prompt reverse service - LemonGrid REST API for image prompt analysis
// Uses lemongridFetch for reverse-prompt call and LemonGridClient.uploadAsset for image upload.

import { useLemonGridStore } from '../stores/lemongridStore';
import { lemongridFetch } from './lemongrid-auth';
import { LemonGridClient } from './lemongrid';

export interface ClusterReversePromptAnalysis {
  subject: string;
  composition: string;
  lighting: string;
  color_palette: string;
  mood: string;
  style: string;
  technical: string;
}

export interface ClusterReversePromptResult {
  prompt: string;
  prompt_cn: string;
  negative_prompt: string;
  analysis: ClusterReversePromptAnalysis;
}

/**
 * Reverse prompt using LemonGrid's KIE Gemini backend.
 * Requires an asset_id that exists in the LemonGrid asset library.
 */
export async function reversePromptFromAsset(
  assetId: string,
  customPrompt?: string
): Promise<ClusterReversePromptResult> {
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const body: Record<string, unknown> = { asset_id: assetId };
  if (customPrompt) {
    body.prompt = customPrompt;
  }
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/assets/library/reverse-prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reverse prompt failed: ${response.status} - ${errorText}`);
  }
  return response.json() as Promise<ClusterReversePromptResult>;
}

/**
 * Upload a blob as a temporary LemonGrid asset for prompt reverse.
 * Returns the asset_id for use with reversePromptFromAsset.
 */
export async function uploadForReversePrompt(
  imageBlob: Blob,
  filename: string = 'reverse-input.png'
): Promise<string> {
  const serverUrl = useLemonGridStore.getState().serverUrl;
  const client = new LemonGridClient({ serverUrl });
  const file = new File([imageBlob], filename, { type: imageBlob.type || 'image/png' });
  const result = await client.uploadAsset(file, 'REFERENCE');
  return result.id;
}

/**
 * Fetch the default reverse-prompt text from LemonGrid backend.
 * Falls back to a hardcoded default if the API is unavailable.
 */
export async function getDefaultPrompt(): Promise<string> {
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  try {
    const response = await lemongridFetch(
      `${serverUrl}/api/v1/assets/library/default-prompts`,
    );
    if (!response.ok) {
      console.warn('[PromptReverse] default-prompts API returned', response.status);
      return FALLBACK_DEFAULT_PROMPT;
    }
    const data = await response.json() as { prompt?: string } | string;
    const prompt = typeof data === 'string' ? data : data.prompt;
    return prompt || FALLBACK_DEFAULT_PROMPT;
  } catch (err) {
    console.warn('[PromptReverse] Failed to fetch default prompt:', err);
    return FALLBACK_DEFAULT_PROMPT;
  }
}

const FALLBACK_DEFAULT_PROMPT =
  '你是一个专业的图像描述专家。请用中文详细描述这张图片的内容，包括：主体内容、构图方式、色彩搭配、光影效果、艺术风格。输出格式为一段流畅的自然语言描述，不要使用标签或列表格式。';
