/**
 * Type definitions for workflow parameter presets.
 */

export interface PresetFile {
  version: number;
  name: string;
  workflowName: string;
  workflowPath?: string;
  inputValues: Record<string, string | number | boolean>;
  imageFilenames: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface PresetMeta {
  filename: string;
  name: string;
  workflowName: string;
  updatedAt: string;
  createdAt: string;
}
