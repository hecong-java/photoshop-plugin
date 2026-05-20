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
  assetId: string
): Promise<ClusterReversePromptResult> {
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/assets/library/reverse-prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId }),
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
