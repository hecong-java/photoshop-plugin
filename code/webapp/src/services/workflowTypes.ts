// Shared types for workflow parsing, prompt compilation, and UI rendering.
// Extracted from Draw.tsx to be usable by both the Workflow Engine and the Draw page.

export interface WorkflowInput {
  name: string;
  type: 'text' | 'number' | 'image' | 'select' | 'boolean';
  label: string;
  classType?: string;
  nodeId?: string;
  nodeLabel?: string;
  default?: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  description?: string;
  multiline?: boolean;
  prompt?: boolean;
}

export interface WorkflowInputGroup {
  key: string;
  label: string;
  classType: string;
  items: WorkflowInput[];
}

export type ComfyInputConfig = [unknown, Record<string, unknown>?] | undefined;

export interface PromptNodeInfo {
  nodeIds: Set<string>;
  nodeTypes: Set<string>;
  inputKeysByType: Map<string, Set<string>>;
}
