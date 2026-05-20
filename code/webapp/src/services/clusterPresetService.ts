// Cluster preset service - LemonGrid REST API wrapper for preset CRUD
// Uses lemongridFetch + ensureValidToken for authenticated requests.

import { useLemonGridStore } from '../stores/lemongridStore';
import { lemongridFetch, ensureValidToken } from './lemongrid-auth';

export interface ClusterPresetMeta {
  id: string;
  template_id: string;
  name: string;
  parameters: Record<string, unknown>;
  scope: 'personal' | 'shared';
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * List presets for a given template from LemonGrid server.
 */
export async function listPresets(templateId: string): Promise<ClusterPresetMeta[]> {
  await ensureValidToken();
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets?page_size=100`
  );
  if (!response.ok) {
    throw new Error(`List presets failed: ${response.status}`);
  }
  const data = await response.json() as { items: ClusterPresetMeta[]; total: number };
  return data.items || [];
}

/**
 * Create a new preset on LemonGrid server.
 * Throws 'PRESET_NAME_CONFLICT' on status 409.
 */
export async function createPreset(
  templateId: string,
  name: string,
  parameters: Record<string, unknown>,
  scope: 'personal' | 'shared' = 'personal'
): Promise<ClusterPresetMeta> {
  await ensureValidToken();
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, name, parameters, scope }),
    }
  );
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error('PRESET_NAME_CONFLICT');
    }
    throw new Error(`Create preset failed: ${response.status}`);
  }
  return response.json() as Promise<ClusterPresetMeta>;
}

/**
 * Update an existing preset on LemonGrid server.
 */
export async function updatePreset(
  templateId: string,
  presetId: string,
  data: { name?: string; parameters?: Record<string, unknown>; scope?: string }
): Promise<ClusterPresetMeta> {
  await ensureValidToken();
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets/${presetId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  if (!response.ok) {
    throw new Error(`Update preset failed: ${response.status}`);
  }
  return response.json() as Promise<ClusterPresetMeta>;
}

/**
 * Delete a preset from LemonGrid server.
 * Resolves silently on 204 status.
 */
export async function deletePreset(
  templateId: string,
  presetId: string
): Promise<void> {
  await ensureValidToken();
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets/${presetId}`,
    { method: 'DELETE' }
  );
  if (!response.ok && response.status !== 204) {
    throw new Error(`Delete preset failed: ${response.status}`);
  }
}
