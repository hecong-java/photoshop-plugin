// Preset service - Bridge API wrapper for preset CRUD, import, and export

import { sendBridgeMessage, hasBridgeTransport } from './upload';
import type { PresetFile, PresetMeta } from '../types/preset';

/**
 * List presets for a given workflow.
 * Returns empty array when Bridge is not available.
 */
export async function listPresets(workflowName: string): Promise<PresetMeta[]> {
  if (!hasBridgeTransport()) {
    return [];
  }
  return sendBridgeMessage('preset.list', { workflowName }) as Promise<PresetMeta[]>;
}

/**
 * Read a preset file by filename.
 * Throws if Bridge is not available.
 */
export async function readPreset(filename: string): Promise<PresetFile> {
  if (!hasBridgeTransport()) {
    throw new Error('Bridge transport unavailable for preset.read');
  }
  return sendBridgeMessage('preset.read', { filename }) as Promise<PresetFile>;
}

/**
 * Save (write) a preset file.
 * Throws if Bridge is not available.
 */
export async function savePreset(
  filename: string,
  data: PresetFile
): Promise<{ success: boolean; filename: string }> {
  if (!hasBridgeTransport()) {
    throw new Error('Bridge transport unavailable for preset.write');
  }
  return sendBridgeMessage('preset.write', { filename, data }) as Promise<{ success: boolean; filename: string }>;
}

/**
 * Delete a preset file.
 * Throws if Bridge is not available.
 */
export async function deletePreset(filename: string): Promise<{ success: boolean }> {
  if (!hasBridgeTransport()) {
    throw new Error('Bridge transport unavailable for preset.delete');
  }
  return sendBridgeMessage('preset.delete', { filename }) as Promise<{ success: boolean }>;
}

/**
 * Import a preset via native file picker.
 * Returns { cancelled: true } if user cancels, or { cancelled: false, data, sourceFilename } on success.
 */
export async function importPreset(): Promise<{
  cancelled: boolean;
  data?: PresetFile;
  sourceFilename?: string;
}> {
  return sendBridgeMessage('preset.import', {}) as Promise<{
    cancelled: boolean;
    data?: PresetFile;
    sourceFilename?: string;
  }>;
}

/**
 * Export a preset via native save dialog.
 * Returns { success: true } or { cancelled: true } if user cancels.
 */
export async function exportPreset(
  filename: string,
  data: PresetFile
): Promise<{ success: boolean; cancelled: boolean }> {
  return sendBridgeMessage('preset.export', { filename, data }) as Promise<{
    success: boolean;
    cancelled: boolean;
  }>;
}

/**
 * Generate the next preset name by finding the highest N in "预设 N" pattern.
 * Returns "预设 1" when no presets exist.
 */
export function getNextPresetName(existingPresets: PresetMeta[]): string {
  let maxNum = 0;
  const pattern = /^预设 (\d+)$/;
  for (const preset of existingPresets) {
    const match = preset.name.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `预设 ${maxNum + 1}`;
}

/**
 * Validate preset data structure.
 * Returns cleaned PresetFile or null if invalid.
 * Strips base64-like long strings from inputValues.
 */
export function validatePresetData(data: unknown): PresetFile | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Check required fields
  if (typeof obj.name !== 'string' || !obj.name) return null;
  if (typeof obj.workflowName !== 'string' || !obj.workflowName) return null;
  if (!obj.inputValues || typeof obj.inputValues !== 'object') return null;
  if (!obj.imageFilenames || typeof obj.imageFilenames !== 'object') return null;

  // Clean inputValues - strip base64-like long strings
  const rawInputs = obj.inputValues as Record<string, unknown>;
  const cleanedInputs: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rawInputs)) {
    if (typeof value === 'string' && value.length > 1000) {
      // Looks like base64 data, skip it
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      cleanedInputs[key] = value;
    }
  }

  const rawImages = obj.imageFilenames as Record<string, unknown>;
  const cleanedImages: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawImages)) {
    if (typeof value === 'string') {
      cleanedImages[key] = value;
    }
  }

  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    name: obj.name,
    workflowName: obj.workflowName,
    ...(typeof obj.workflowPath === 'string' ? { workflowPath: obj.workflowPath } : {}),
    inputValues: cleanedInputs,
    imageFilenames: cleanedImages,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  };
}
