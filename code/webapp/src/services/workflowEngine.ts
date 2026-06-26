// Workflow Engine — pure functions for parsing ComfyUI workflows, compiling
// prompts, restoring history values, and matching workflows. Extracted from
// Draw.tsx to be testable in isolation without React or a running app.
//
// All functions are pure: they take their inputs as parameters and return
// results without side effects. State (selected workflow, input values, etc.)
// is passed in by the caller.

import {
  ComfyUIClient,
  type ComfyUIWorkflowInfo,
  type ExperimentModelCatalog,
} from './comfyui';
import {
  SKIPPED_NODE_TYPES,
  DEFAULT_CLASS_TYPE,
  ROOT_WORKFLOW_GROUP,
  containsChinese,
  getNodeTypeChineseLabel,
  getInputChineseLabel,
} from './workflowConstants';
import type {
  WorkflowInput,
  ComfyInputConfig,
  PromptNodeInfo,
} from './workflowTypes';

// Re-export so callers that already import from Draw.tsx internals can keep
// working without changes. The Draw page will switch to importing from this
// module directly.
export { ROOT_WORKFLOW_GROUP };

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

export const getWorkflowDisplayMeta = (workflow: ComfyUIWorkflowInfo) => {
  const raw = (workflow.path || workflow.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const withoutPrefix = raw.startsWith('ps-workflows/')
    ? raw.slice('ps-workflows/'.length)
    : raw.startsWith('workflows/')
      ? raw.slice('workflows/'.length)
      : raw;
  const normalizedPath = withoutPrefix.replace(/\.json$/i, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  const fileLabel = segments.length > 0
    ? segments[segments.length - 1]
    : (workflow.name || '').replace(/\.json$/i, '') || 'unnamed';
  const directory = segments.length > 1 ? segments[0] : ROOT_WORKFLOW_GROUP;

  return {
    directory,
    fileLabel,
    sortKey: normalizedPath.toLowerCase(),
    hasSubDirectory: segments.length > 1,
  };
};

export const getDefaultWorkflow = (workflowList: ComfyUIWorkflowInfo[]): ComfyUIWorkflowInfo | null => {
  const fileWorkflows = workflowList.filter((workflow) => !workflow.isDirectory);
  if (fileWorkflows.length === 0) {
    return null;
  }

  const candidates = fileWorkflows.filter((workflow) => getWorkflowDisplayMeta(workflow).hasSubDirectory);
  const target = candidates.length > 0 ? candidates : fileWorkflows;

  return [...target].sort((a, b) => {
    const aMeta = getWorkflowDisplayMeta(a);
    const bMeta = getWorkflowDisplayMeta(b);
    return aMeta.sortKey.localeCompare(bMeta.sortKey, 'zh-CN');
  })[0] ?? null;
};

const WORKFLOW_IMAGE_VARIANT_PATTERN = /^(.*)_([1-9]\d*)图$/;

export interface WorkflowImageVariantInfo {
  baseName: string;
  imageCount: number;
}

export interface GroupedWorkflowEntry {
  key: string;
  name: string;
  directory: string;
  representative: ComfyUIWorkflowInfo;
  variants: Array<{
    workflow: ComfyUIWorkflowInfo;
    imageCount: number | null;
  }>;
  maxImageCount: number | null;
  usesImageCountVariants: boolean;
}

const getWorkflowInputBaseName = (name: string): string => {
  const splitIndex = name.lastIndexOf('_');
  if (splitIndex <= 0 || splitIndex >= name.length - 1) {
    return name;
  }

  const suffix = name.slice(splitIndex + 1);
  return /^\d+$/.test(suffix) ? name.slice(0, splitIndex) : name;
};

const getWorkflowInputOrder = (input: WorkflowInput): number => {
  if (typeof input.nodeId === 'string' && input.nodeId.trim() !== '' && !Number.isNaN(Number(input.nodeId))) {
    return Number(input.nodeId);
  }

  const splitIndex = input.name.lastIndexOf('_');
  if (splitIndex > 0 && splitIndex < input.name.length - 1) {
    const parsed = Number(input.name.slice(splitIndex + 1));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Number.MAX_SAFE_INTEGER;
};

export const getWorkflowImageVariantInfo = (
  workflow: Pick<ComfyUIWorkflowInfo, 'name' | 'path'>
): WorkflowImageVariantInfo | null => {
  const fileLabel = getWorkflowDisplayMeta(workflow as ComfyUIWorkflowInfo).fileLabel;
  const match = fileLabel.match(WORKFLOW_IMAGE_VARIANT_PATTERN);
  if (!match) {
    return null;
  }

  const imageCount = Number(match[2]);
  if (!Number.isFinite(imageCount) || imageCount <= 0) {
    return null;
  }

  return {
    baseName: match[1],
    imageCount,
  };
};

export const groupWorkflowsByImageVariants = (
  workflowList: ComfyUIWorkflowInfo[]
): GroupedWorkflowEntry[] => {
  const groups = new Map<string, GroupedWorkflowEntry>();

  workflowList
    .filter((workflow) => !workflow.isDirectory)
    .forEach((workflow) => {
      const meta = getWorkflowDisplayMeta(workflow);
      const variantInfo = getWorkflowImageVariantInfo(workflow);
      const displayName = variantInfo?.baseName || meta.fileLabel;
      const key = `${meta.directory}::${displayName.toLowerCase()}`;
      const existing = groups.get(key);

      if (existing) {
        existing.variants.push({
          workflow,
          imageCount: variantInfo?.imageCount ?? null,
        });
        if (variantInfo) {
          existing.usesImageCountVariants = true;
          existing.maxImageCount = Math.max(existing.maxImageCount ?? 0, variantInfo.imageCount);
        }
        return;
      }

      groups.set(key, {
        key,
        name: displayName,
        directory: meta.directory,
        representative: workflow,
        variants: [{
          workflow,
          imageCount: variantInfo?.imageCount ?? null,
        }],
        maxImageCount: variantInfo?.imageCount ?? null,
        usesImageCountVariants: Boolean(variantInfo),
      });
    });

  return Array.from(groups.values())
    .map((group) => {
      const sortedVariants = [...group.variants].sort((a, b) => {
        const aCount = a.imageCount ?? Number.MAX_SAFE_INTEGER;
        const bCount = b.imageCount ?? Number.MAX_SAFE_INTEGER;
        if (aCount !== bCount) {
          return aCount - bCount;
        }

        const aMeta = getWorkflowDisplayMeta(a.workflow);
        const bMeta = getWorkflowDisplayMeta(b.workflow);
        return aMeta.sortKey.localeCompare(bMeta.sortKey, 'zh-CN');
      });

      return {
        ...group,
        variants: sortedVariants,
        representative: sortedVariants[sortedVariants.length - 1]?.workflow ?? group.representative,
      };
    })
    .sort((a, b) => {
      if (a.directory === ROOT_WORKFLOW_GROUP && b.directory !== ROOT_WORKFLOW_GROUP) return 1;
      if (b.directory === ROOT_WORKFLOW_GROUP && a.directory !== ROOT_WORKFLOW_GROUP) return -1;
      if (a.directory !== b.directory) {
        return a.directory.localeCompare(b.directory, 'zh-CN');
      }

      const aMeta = getWorkflowDisplayMeta(a.representative);
      const bMeta = getWorkflowDisplayMeta(b.representative);
      return aMeta.sortKey.localeCompare(bMeta.sortKey, 'zh-CN');
    });
};

export const getDefaultGroupedWorkflow = (
  workflowList: ComfyUIWorkflowInfo[]
): GroupedWorkflowEntry | null => {
  const grouped = groupWorkflowsByImageVariants(workflowList);
  return grouped[0] ?? null;
};

export const resolveGroupedWorkflowVariant = (
  group: GroupedWorkflowEntry,
  imageCount: number
): ComfyUIWorkflowInfo | null => {
  if (!group.usesImageCountVariants) {
    return group.representative;
  }

  const exact = group.variants.find((variant) => variant.imageCount === imageCount)?.workflow;
  if (exact) {
    return exact;
  }

  const fallbackHigher = group.variants.find(
    (variant) => variant.imageCount !== null && variant.imageCount >= imageCount
  )?.workflow;
  if (fallbackHigher) {
    return fallbackHigher;
  }

  return group.representative;
};

export const remapInputValuesToWorkflowInputs = <T extends string | number | boolean>(
  sourceInputs: WorkflowInput[],
  targetInputs: WorkflowInput[],
  sourceValues: Record<string, T>
): Record<string, T> => {
  const sourceGroups = new Map<string, WorkflowInput[]>();

  sourceInputs.forEach((input) => {
    const key = `${input.type}::${getWorkflowInputBaseName(input.name)}`;
    const existing = sourceGroups.get(key);
    if (existing) {
      existing.push(input);
    } else {
      sourceGroups.set(key, [input]);
    }
  });

  sourceGroups.forEach((inputs, key) => {
    sourceGroups.set(
      key,
      [...inputs].sort((a, b) => {
        const nodeDiff = getWorkflowInputOrder(a) - getWorkflowInputOrder(b);
        if (nodeDiff !== 0) {
          return nodeDiff;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      })
    );
  });

  const targetGroups = new Map<string, WorkflowInput[]>();
  targetInputs.forEach((input) => {
    const key = `${input.type}::${getWorkflowInputBaseName(input.name)}`;
    const existing = targetGroups.get(key);
    if (existing) {
      existing.push(input);
    } else {
      targetGroups.set(key, [input]);
    }
  });

  const remapped: Record<string, T> = {};

  targetGroups.forEach((inputs, key) => {
    const sortedTargets = [...inputs].sort((a, b) => {
      const nodeDiff = getWorkflowInputOrder(a) - getWorkflowInputOrder(b);
      if (nodeDiff !== 0) {
        return nodeDiff;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    const sortedSources = sourceGroups.get(key) ?? [];
    sortedTargets.forEach((targetInput, index) => {
      const sourceInput = sortedSources[index] ?? sortedSources[0];
      if (!sourceInput) {
        return;
      }

      const sourceValue = sourceValues[sourceInput.name];
      if (sourceValue !== undefined) {
        remapped[targetInput.name] = sourceValue;
      }
    });
  });

  return remapped;
};

// ---------------------------------------------------------------------------
// Prompt compilation
// ---------------------------------------------------------------------------

export const sanitizePromptGraph = (prompt: Record<string, unknown>): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  Object.entries(prompt).forEach(([nodeId, nodeValue]) => {
    if (!nodeValue || typeof nodeValue !== 'object' || Array.isArray(nodeValue)) {
      return;
    }

    const record = nodeValue as Record<string, unknown>;
    const classType = record.class_type ?? record.type;
    if (typeof classType === 'string' && SKIPPED_NODE_TYPES.has(classType)) {
      return;
    }

    sanitized[nodeId] = record;
  });

  return sanitized;
};

export const applyInputValuesToPrompt = (
  prompt: Record<string, unknown>,
  values: Record<string, string | number | boolean>
): Record<string, unknown> => {
  const updated = JSON.parse(JSON.stringify(prompt)) as Record<string, unknown>;

  Object.entries(values).forEach(([key, value]) => {
    const splitIndex = key.lastIndexOf('_');
    if (splitIndex <= 0 || splitIndex >= key.length - 1) {
      return;
    }

    const inputName = key.slice(0, splitIndex);
    const nodeId = key.slice(splitIndex + 1);
    const node = updated[nodeId];
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }

    const nodeRecord = node as Record<string, unknown>;
    const classType = nodeRecord.class_type ?? nodeRecord.type;
    if (typeof classType === 'string' && SKIPPED_NODE_TYPES.has(classType)) {
      return;
    }

    const inputs = nodeRecord.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
      nodeRecord.inputs = { [inputName]: value };
      return;
    }

    // Preserve linked references (e.g., ["114", 0]) — overwriting them
    // with hardcoded values would break dynamic dimensions from nodes like GetImageSize
    const existingValue = (inputs as Record<string, unknown>)[inputName];
    if (Array.isArray(existingValue)) {
      return;
    }

    (inputs as Record<string, unknown>)[inputName] = value;
  });

  return updated;
};

export const enforceLatestImageInputs = (
  prompt: Record<string, unknown>,
  values: Record<string, string | number | boolean>,
  inputsMeta: WorkflowInput[]
): Record<string, unknown> => {
  const imageInputs = [...inputsMeta.filter((input) => input.type === 'image')].sort((a, b) => {
    const nodeDiff = getWorkflowInputOrder(a) - getWorkflowInputOrder(b);
    if (nodeDiff !== 0) {
      return nodeDiff;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  const orderedImageValues = imageInputs
    .map((input) => values[input.name])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  imageInputs.forEach((inputMeta, index) => {
    const rawValue = values[inputMeta.name];
    const directImageValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    const imageValue = directImageValue || orderedImageValues[index] || '';
    if (!imageValue) {
      return;
    }

    const splitIndex = inputMeta.name.lastIndexOf('_');
    if (splitIndex <= 0 || splitIndex >= inputMeta.name.length - 1) {
      return;
    }

    const inputName = inputMeta.name.slice(0, splitIndex);
    const nodeId = inputMeta.name.slice(splitIndex + 1);
    const node = prompt[nodeId];
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }

    const nodeRecord = node as Record<string, unknown>;
    const nodeInputs = nodeRecord.inputs;
    if (!nodeInputs || typeof nodeInputs !== 'object' || Array.isArray(nodeInputs)) {
      nodeRecord.inputs = { [inputName]: imageValue };
    } else {
      (nodeInputs as Record<string, unknown>)[inputName] = imageValue;
    }

    const classType = nodeRecord.class_type ?? nodeRecord.type;
    if (
      typeof classType === 'string' &&
      classType.toLowerCase().includes('loadimage')
    ) {
      const ensuredInputs = nodeRecord.inputs as Record<string, unknown>;
      if (ensuredInputs.upload === undefined) {
        ensuredInputs.upload = 'image';
      }
    }
  });

  return prompt;
};

// ---------------------------------------------------------------------------
// Prompt introspection
// ---------------------------------------------------------------------------

export const getPromptNodeInfo = (params: Record<string, unknown> | undefined): PromptNodeInfo => {
  const nodeIds = new Set<string>();
  const nodeTypes = new Set<string>();
  const inputKeysByType = new Map<string, Set<string>>();

  if (!params || typeof params !== 'object') {
    return { nodeIds, nodeTypes, inputKeysByType };
  }

  Object.entries(params).forEach(([nodeId, nodeValue]) => {
    nodeIds.add(String(nodeId));
    if (!nodeValue || typeof nodeValue !== 'object') {
      return;
    }

    const record = nodeValue as Record<string, unknown>;
    const classType = record.class_type;
    const nodeType = record.type;
    if (typeof classType === 'string') {
      nodeTypes.add(classType);
      if (!inputKeysByType.has(classType)) {
        inputKeysByType.set(classType, new Set<string>());
      }
    } else if (typeof nodeType === 'string') {
      nodeTypes.add(nodeType);
      if (!inputKeysByType.has(nodeType)) {
        inputKeysByType.set(nodeType, new Set<string>());
      }
    }

    const inputs = record.inputs;
    if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
      const typeKey = typeof classType === 'string' ? classType : (typeof nodeType === 'string' ? nodeType : undefined);
      if (!typeKey) {
        return;
      }

      const target = inputKeysByType.get(typeKey);
      if (!target) {
        return;
      }

      Object.keys(inputs as Record<string, unknown>).forEach((key) => target.add(key));
    }
  });

  return { nodeIds, nodeTypes, inputKeysByType };
};

// ---------------------------------------------------------------------------
// History value restoration
// ---------------------------------------------------------------------------

export const extractInputValuesFromHistoryParams = (
  params: Record<string, unknown>,
  targetInputs: WorkflowInput[]
) => {
  const promptData = params as Record<string, unknown>;
  const restoredValues: Record<string, string | number | boolean> = {};

  // Build a map of class_type -> nodes with that class_type from history params
  const nodesByClassType = new Map<string, Array<{ nodeId: string; node: Record<string, unknown> }>>();
  Object.entries(promptData).forEach(([nodeId, nodeValue]) => {
    if (!nodeValue || typeof nodeValue !== 'object' || Array.isArray(nodeValue)) return;
    const nodeRecord = nodeValue as Record<string, unknown>;
    const classType = nodeRecord.class_type ?? nodeRecord.type;
    if (typeof classType === 'string') {
      if (!nodesByClassType.has(classType)) {
        nodesByClassType.set(classType, []);
      }
      nodesByClassType.get(classType)!.push({ nodeId, node: nodeRecord });
    }
  });

  targetInputs.forEach((input) => {
    const splitIndex = input.name.lastIndexOf('_');
    if (splitIndex <= 0 || splitIndex >= input.name.length - 1) {
      return;
    }

    const inputName = input.name.slice(0, splitIndex);
    const nodeId = input.name.slice(splitIndex + 1);

    // First try to find by exact nodeId (for same workflow)
    let nodeValue = promptData[nodeId];
    let nodeRecord: Record<string, unknown> | null = null;

    if (nodeValue && typeof nodeValue === 'object' && !Array.isArray(nodeValue)) {
      nodeRecord = nodeValue as Record<string, unknown>;
      const historyClassType = nodeRecord.class_type ?? nodeRecord.type;
      // Verify class type matches
      if (typeof historyClassType === 'string' && typeof input.classType === 'string' && input.classType !== historyClassType) {
        nodeRecord = null;
      }
    }

    // If not found by nodeId, try to find by class_type
    if (!nodeRecord && input.classType) {
      const candidates = nodesByClassType.get(input.classType);
      if (candidates && candidates.length > 0) {
        const firstCandidate = candidates[0];
        nodeRecord = firstCandidate.node;
        // Remove from candidates so we don't reuse it for another input
        candidates.shift();
      }
    }

    if (!nodeRecord) {
      return;
    }

    const nodeInputs = nodeRecord.inputs;
    if (!nodeInputs || typeof nodeInputs !== 'object' || Array.isArray(nodeInputs)) {
      return;
    }

    const candidate = (nodeInputs as Record<string, unknown>)[inputName];
    if (candidate === undefined || candidate === null) {
      return;
    }

    if (input.type === 'number') {
      const numericCandidate = typeof candidate === 'number'
        ? candidate
        : (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate))
          ? Number(candidate)
          : undefined);
      if (numericCandidate === undefined) {
        return;
      }
      restoredValues[input.name] = numericCandidate;
      return;
    }

    if (input.type === 'boolean') {
      if (typeof candidate === 'boolean') {
        restoredValues[input.name] = candidate;
        return;
      }
      if (typeof candidate === 'number') {
        restoredValues[input.name] = candidate !== 0;
        return;
      }
      if (typeof candidate === 'string') {
        const normalized = candidate.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') {
          restoredValues[input.name] = true;
          return;
        }
        if (normalized === 'false' || normalized === '0') {
          restoredValues[input.name] = false;
          return;
        }
      }
      return;
    }

    if (input.type === 'image') {
      const imageFilename = typeof candidate === 'string' ? candidate : String(candidate);
      if (imageFilename && imageFilename.trim() !== '') {
        restoredValues[input.name] = imageFilename;
      }
      return;
    }

    const stringCandidate = typeof candidate === 'string' ? candidate : String(candidate);
    if (input.type === 'select' && input.options && !input.options.some(o => String(o) === stringCandidate)) {
      return;
    }
    restoredValues[input.name] = stringCandidate;
  });

  return restoredValues;
};

// ---------------------------------------------------------------------------
// Workflow matching (for history rerun)
// ---------------------------------------------------------------------------

export const findBestMatchingWorkflow = async (
  params: Record<string, unknown> | undefined,
  workflowName: string | undefined,
  workflows: ComfyUIWorkflowInfo[],
  client: ComfyUIClient,
  prefixMode: 'api' | 'oss' = 'oss'
): Promise<ComfyUIWorkflowInfo | null> => {
  if (workflows.length === 0) {
    return null;
  }

  // Helper to strip ps-workflows/ prefix for comparison
  const stripPsWorkflowsPrefix = (name: string): string => {
    return name.replace(/^ps-workflows\//, '');
  };

  // Step 1: Try to match by workflow_name first
  if (workflowName) {
    const looksLikeImage = /\.(png|jpg|jpeg|webp|gif)$/i.test(workflowName);

    const normalized = stripPsWorkflowsPrefix(workflowName.trim().toLowerCase().replace(/\.json$/, '').replace(/\\/g, '/'));
    const baseName = normalized.split('/').pop() || normalized;

    if (!looksLikeImage) {
      const exactMatch = workflows.find(w => {
        const rawName = w.name;
        const workflowLabelRaw = rawName.toLowerCase().replace(/\.json$/, '').replace(/\\/g, '/');
        const workflowLabel = stripPsWorkflowsPrefix(workflowLabelRaw);
        const workflowBase = workflowLabel.split('/').pop() || workflowLabel;
        const pathMatch = workflowLabel === normalized || workflowLabelRaw === normalized;
        const baseMatch = workflowBase === normalized || workflowBase === baseName;
        return pathMatch || baseMatch;
      });

      if (exactMatch) {
        return exactMatch;
      }

      const partialMatch = workflows.find(w => {
        const workflowLabelRaw = w.name.toLowerCase().replace(/\.json$/, '').replace(/\\/g, '/');
        const workflowLabel = stripPsWorkflowsPrefix(workflowLabelRaw);
        const workflowBase = workflowLabel.split('/').pop() || workflowLabel;
        return (baseName.length >= 3 && workflowBase.includes(baseName)) ||
               (workflowBase.length >= 3 && baseName.includes(workflowBase));
      });

      if (partialMatch) {
        return partialMatch;
      }
    }
  }

  // Step 2: Fall back to scoring-based matching if no name match
  if (!params || Object.keys(params).length === 0) {
    return workflows[0] ?? null;
  }

  const expected = getPromptNodeInfo(params);
  if (expected.nodeTypes.size === 0) {
    return workflows[0] ?? null;
  }

  let bestWorkflow: ComfyUIWorkflowInfo | null = null;
  let bestScore = -1;

  for (const workflow of workflows) {
    try {
      const workflowData = await client.readWorkflow(workflow.name, prefixMode);
      const data = workflowData as Record<string, unknown>;
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const actualNodeIds = new Set(
        nodes
          .map((node) => {
            if (!node || typeof node !== 'object') return null;
            const record = node as Record<string, unknown>;
            return record.id !== undefined && record.id !== null ? String(record.id) : null;
          })
          .filter((id): id is string => Boolean(id))
      );

      const actualNodeTypes = new Set<string>();
      const actualNodeTypeCount = new Map<string, number>();
      const actualInputKeysByType = new Map<string, Set<string>>();
      nodes.forEach((node) => {
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        const nodeType = record.type || record.class_type;
        if (typeof nodeType === 'string') {
          actualNodeTypes.add(nodeType);
          actualNodeTypeCount.set(nodeType, (actualNodeTypeCount.get(nodeType) || 0) + 1);
          if (!actualInputKeysByType.has(nodeType)) {
            actualInputKeysByType.set(nodeType, new Set<string>());
          }
        }

        const inputs = Array.isArray(record.inputs) ? record.inputs : [];
        inputs.forEach((input) => {
          if (!input || typeof input !== 'object') return;
          const inputRecord = input as Record<string, unknown>;
          const inputName = inputRecord.name;
          if (typeof inputName === 'string' && typeof nodeType === 'string') {
            actualInputKeysByType.get(nodeType)?.add(inputName);
          }
        });
      });

      let score = 0;
      expected.nodeTypes.forEach((type) => {
        if (!actualNodeTypes.has(type)) {
          score -= 10;
          return;
        }

        score += 8;
        const count = actualNodeTypeCount.get(type) || 0;
        if (count > 0) {
          score += Math.min(count, 3);
        }

        const expectedKeys = expected.inputKeysByType.get(type);
        const actualKeys = actualInputKeysByType.get(type);
        if (expectedKeys && expectedKeys.size > 0 && actualKeys && actualKeys.size > 0) {
          let matchedKeys = 0;
          expectedKeys.forEach((key) => {
            if (actualKeys.has(key)) {
              matchedKeys += 1;
            }
          });
          score += Math.round((matchedKeys / expectedKeys.size) * 6);
        }
      });

      expected.nodeIds.forEach((id) => {
        if (actualNodeIds.has(id)) {
          score += 1;
        }
      });

      if (score > bestScore) {
        bestScore = score;
        bestWorkflow = workflow;
      }
    } catch (error) {
      console.warn('[WorkflowEngine] Failed to inspect workflow for history matching:', workflow.name, error);
    }
  }

  return bestWorkflow ?? workflows[0] ?? null;
};

// ---------------------------------------------------------------------------
// Workflow input parsing
// ---------------------------------------------------------------------------

const PROMPT_TEXT_PATTERN = /prompt|提示词|description|描述/i;
const PROMPT_CLASS_TYPE_PATTERN = /TextEncode|TextInput|ShowText|String/i;

const isPromptLikeTextField = ({
  classType,
  label,
  name,
  nodeDisplayName,
}: {
  classType?: string;
  label?: string;
  name?: string;
  nodeDisplayName?: string;
}): boolean => {
  if (typeof classType === 'string' && PROMPT_CLASS_TYPE_PATTERN.test(classType)) {
    return true;
  }

  return [label, name, nodeDisplayName]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .some((value) => PROMPT_TEXT_PATTERN.test(value));
};

const isMultilineTextField = ({
  classType,
  label,
  name,
  nodeDisplayName,
  defaultValue,
}: {
  classType?: string;
  label?: string;
  name?: string;
  nodeDisplayName?: string;
  defaultValue?: string;
}): boolean => {
  if (isPromptLikeTextField({ classType, label, name, nodeDisplayName })) {
    return true;
  }

  return typeof defaultValue === 'string' && /\n/.test(defaultValue);
};

export const parseWorkflowInputs = (
  workflowData: unknown,
  workflowObjectInfo: Record<string, unknown> | null,
  workflowModelCatalog: ExperimentModelCatalog
): WorkflowInput[] => {
  if (!workflowData || typeof workflowData !== 'object') return [];

  const inputs: WorkflowInput[] = [];
  const nodeClassTypeById = new Map<string, string>();
  const nodeLabelById = new Map<string, string>();
  const data = workflowData as Record<string, unknown>;

  // Handle ComfyUI workflow format
  if (data.nodes && Array.isArray(data.nodes)) {
    data.nodes.forEach((node: unknown) => {
      if (node && typeof node === 'object') {
        const nodeData = node as Record<string, unknown>;
        const nodeId = nodeData.id;
        const nodeType = nodeData.comfyClass || nodeData.class_type || nodeData.type;
        const nodeIdStr = String(nodeId ?? '');
        const classTypeStr = typeof nodeType === 'string' ? nodeType : DEFAULT_CLASS_TYPE;
        if (typeof nodeType === 'string' && SKIPPED_NODE_TYPES.has(nodeType)) {
          return;
        }
        if (nodeIdStr) {
          nodeClassTypeById.set(nodeIdStr, classTypeStr);
        }
        const widgetValues = nodeData.widgets_values as (string | number)[] | undefined;
        const objectInfoRecord = workflowObjectInfo && typeof workflowObjectInfo === 'object'
          ? workflowObjectInfo as Record<string, unknown>
          : undefined;
        const nodeTypeCandidates = [
          nodeData.comfyClass,
          nodeData.class_type,
          nodeData.type,
        ]
          .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '')
          .map((candidate) => candidate.trim());
        const nodeTypeInfo = (() => {
          if (!objectInfoRecord) {
            return undefined;
          }

          for (const candidate of nodeTypeCandidates) {
            const exact = objectInfoRecord[candidate];
            if (exact && typeof exact === 'object') {
              return exact as Record<string, unknown>;
            }
          }

          const normalizedCandidates = new Set(
            nodeTypeCandidates.map((candidate) => candidate.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
          );

          for (const [key, value] of Object.entries(objectInfoRecord)) {
            if (!value || typeof value !== 'object') {
              continue;
            }
            const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (normalizedCandidates.has(normalizedKey)) {
              return value as Record<string, unknown>;
            }
          }

          return undefined;
        })();
        const nodeInputsInfo = nodeTypeInfo && typeof nodeTypeInfo === 'object'
          ? (nodeTypeInfo.input as Record<string, unknown> | undefined)
          : undefined;
        const requiredInfo = nodeInputsInfo && typeof nodeInputsInfo.required === 'object'
          ? nodeInputsInfo.required as Record<string, unknown>
          : undefined;
        const optionalInfo = nodeInputsInfo && typeof nodeInputsInfo.optional === 'object'
          ? nodeInputsInfo.optional as Record<string, unknown>
          : undefined;
        const inputOrderInfo = nodeTypeInfo && typeof nodeTypeInfo.input_order === 'object'
          ? nodeTypeInfo.input_order as Record<string, unknown>
          : undefined;
        const optionalInputOrder = Array.isArray(inputOrderInfo?.optional)
          ? inputOrderInfo.optional.filter((name): name is string => typeof name === 'string')
          : [];
        const getNodeDisplayName = (): string => {
          const nodeTitle = typeof nodeData.title === 'string' ? nodeData.title.trim() : '';
          if (nodeTitle) {
            return nodeTitle;
          }

          const displayName = typeof nodeTypeInfo?.display_name === 'string'
            ? nodeTypeInfo.display_name.trim()
            : '';
          if (displayName && containsChinese(displayName)) {
            return displayName;
          }

          const nodeTypeLabel = getNodeTypeChineseLabel(classTypeStr);
          if (nodeTypeLabel) {
            return nodeTypeLabel;
          }

          if (displayName) {
            return displayName;
          }

          return classTypeStr;
        };
        const nodeDisplayName = getNodeDisplayName();
        if (nodeIdStr) {
          nodeLabelById.set(nodeIdStr, nodeDisplayName);
        }

        const inputLabelByName = new Map<string, string>();
        if (Array.isArray(nodeData.inputs)) {
          nodeData.inputs.forEach((input) => {
            if (!input || typeof input !== 'object') return;
            const inputRecord = input as Record<string, unknown>;
            const inputName = typeof inputRecord.name === 'string' ? inputRecord.name : '';
            if (!inputName) return;
            const localized = typeof inputRecord.localized_name === 'string' ? inputRecord.localized_name.trim() : '';
            const plainLabel = typeof inputRecord.label === 'string' ? inputRecord.label.trim() : '';
            if (localized) {
              inputLabelByName.set(inputName, localized);
              return;
            }
            if (plainLabel) {
              inputLabelByName.set(inputName, plainLabel);
            }
          });
        }

        const resolveInputLabel = (inputName: string, fallback?: unknown): string => {
          const workflowLabel = inputLabelByName.get(inputName);
          if (workflowLabel && workflowLabel.trim() !== '') {
            return workflowLabel;
          }

          if (typeof fallback === 'string' && fallback.trim() !== '') {
            if (containsChinese(fallback)) {
              return fallback.trim();
            }
            return getInputChineseLabel(fallback) ?? fallback.trim();
          }

          return getInputChineseLabel(inputName) ?? inputName;
        };
        const getInputConfig = (inputName: string): ComfyInputConfig => {
          const raw = (requiredInfo?.[inputName] ?? optionalInfo?.[inputName]) as ComfyInputConfig;
          return raw;
        };
        const extractOptions = (config: ComfyInputConfig) => {
          if (!config) return undefined;
          if (Array.isArray(config[0])) {
            return config[0].map((value) => String(value));
          }
          const meta = config[1] as Record<string, unknown> | undefined;
          const values = Array.isArray(meta?.values)
            ? meta.values
            : (Array.isArray(meta?.options) ? meta.options : undefined);
          if (Array.isArray(values)) {
            return values.map((value) => String(value));
          }
          return undefined;
        };
        const extractNumericMeta = (config: ComfyInputConfig) => {
          const meta = (config?.[1] as Record<string, unknown> | undefined) ?? {};
          return {
            min: typeof meta.min === 'number' ? meta.min : undefined,
            max: typeof meta.max === 'number' ? meta.max : undefined,
            step: typeof meta.step === 'number' ? meta.step : undefined,
            defaultValue: meta.default,
          };
        };
        const extractInputTypeTag = (config: ComfyInputConfig) => {
          const typeToken = config?.[0];
          return typeof typeToken === 'string' ? typeToken.toUpperCase() : '';
        };
        const resolveModelOptions = (inputName: string): string[] | undefined => {
          if (!workflowModelCatalog || typeof workflowModelCatalog !== 'object') {
            return undefined;
          }

          const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
          const classKey = normalize(classTypeStr);
          const inputKey = normalize(inputName);
          const entries = Object.entries(workflowModelCatalog)
            .map(([key, options]) => [normalize(key), options] as const)
            .filter(([, options]) => Array.isArray(options) && options.length > 0);

          const pick = (keywords: string[]) => {
            const normalizedKeywords = keywords.map((keyword) => normalize(keyword));
            let bestMatch: string[] | undefined;
            let bestScore = -1;
            for (const [catalogKey, options] of entries) {
              let score = 0;
              normalizedKeywords.forEach((keyword) => {
                if (catalogKey === keyword) {
                  score += 3;
                } else if (catalogKey.includes(keyword) || keyword.includes(catalogKey)) {
                  score += 1;
                }
              });
              if (score > bestScore) {
                bestScore = score;
                bestMatch = options;
              }
            }
            return bestScore > 0 ? bestMatch : undefined;
          };

          if (classKey.includes('unetloader') || inputKey === 'unetname') {
            return pick(['unet', 'diffusionmodel']);
          }
          if (classKey.includes('cliploader') || inputKey === 'clipname') {
            return pick(['clip', 'textencoder']);
          }
          if (classKey.includes('vaeloader') || inputKey === 'vaename') {
            return pick(['vae']);
          }
          if (classKey.includes('upscalemodelloader') || classKey.includes('upscalemodel') || inputKey === 'modelname') {
            return pick(['upscale_model', 'upscale', 'upscaler', 'esrgan']);
          }

          return undefined;
        };
        const buildWidgetValueByName = () => {
          const map = new Map<string, unknown>();
          const nodeWidgets = Array.isArray(nodeData.widgets)
            ? nodeData.widgets.filter((widget) => widget && typeof widget === 'object') as Array<Record<string, unknown>>
            : [];

          if (nodeWidgets.length > 0) {
            nodeWidgets.forEach((widget, idx) => {
              const widgetName = typeof widget.name === 'string' ? widget.name : '';
              if (!widgetName) return;
              map.set(widgetName, widgetValues?.[idx]);
            });
            return map;
          }

          const widgetInputs = Array.isArray(nodeData.inputs)
            ? nodeData.inputs
                .filter((input) => input && typeof input === 'object')
                .filter((input) => (input as Record<string, unknown>).type !== 'IMAGEUPLOAD')
                .map((input) => {
                  const inputRecord = input as Record<string, unknown>;
                  const widgetRecord = inputRecord.widget;
                  if (!widgetRecord || typeof widgetRecord !== 'object') return '';
                  return typeof (widgetRecord as Record<string, unknown>).name === 'string'
                    ? String((widgetRecord as Record<string, unknown>).name)
                    : '';
                })
                .filter((name) => Boolean(name))
            : [];

          const matchesConfig = (candidate: unknown, config: ComfyInputConfig) => {
            if (!config) return true;
            const typeToken = config[0];
            if (Array.isArray(typeToken)) {
              if (typeToken.length === 0) return false;
              const optionList = typeToken.map((value) => String(value));
              return optionList.includes(String(candidate));
            }
            if (typeof typeToken === 'string') {
              const upper = typeToken.toUpperCase();
              if (upper === 'INT') {
                return typeof candidate === 'number' || (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate)));
              }
              if (upper === 'FLOAT') {
                return typeof candidate === 'number' || (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate)));
              }
              if (upper === 'BOOLEAN') {
                return typeof candidate === 'boolean' || candidate === 0 || candidate === 1 || candidate === '0' || candidate === '1' || candidate === 'true' || candidate === 'false';
              }
              if (upper === 'COMBO') {
                return typeof candidate === 'string';
              }
              if (upper === 'STRING') {
                return typeof candidate === 'string';
              }
            }
            return true;
          };

          const hasConfig = widgetInputs.some((name) => Boolean(getInputConfig(name)));

          if (Array.isArray(widgetValues) && widgetValues.length > 0 && widgetInputs.length > 0) {
            if (!hasConfig && widgetValues.length >= widgetInputs.length) {
              widgetInputs.forEach((name, idx) => map.set(name, widgetValues[idx]));
              return map;
            }

            let cursor = 0;
            widgetInputs.forEach((name) => {
              const config = getInputConfig(name);
              while (cursor < widgetValues.length) {
                const candidate = widgetValues[cursor];
                cursor += 1;
                if (matchesConfig(candidate, config)) {
                  map.set(name, candidate);
                  break;
                }
              }
            });
          }

          return map;
        };
        const normalizeSelectDefault = (
          candidate: unknown,
          options: string[] | undefined,
          fallback: unknown
        ): string => {
          if (!options || options.length === 0) {
            return typeof candidate === 'string'
              ? candidate
              : (typeof fallback === 'string' ? fallback : '');
          }
          if (typeof candidate === 'string' && options.includes(candidate)) {
            return candidate;
          }
          if (typeof fallback === 'string' && options.includes(fallback)) {
            return fallback;
          }
          return options[0] ?? '';
        };
        const normalizeNumericDefault = (
          candidate: unknown,
          fallback: unknown,
          metaDefault: unknown
        ): number => {
          if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
            return candidate;
          }
          if (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate))) {
            return Number(candidate);
          }
          if (typeof fallback === 'number' && !Number.isNaN(fallback)) {
            return fallback;
          }
          if (typeof metaDefault === 'number' && !Number.isNaN(metaDefault)) {
            return metaDefault;
          }
          return 0;
        };
        const normalizeBooleanDefault = (
          candidate: unknown,
          fallback: unknown,
          metaDefault: unknown
        ): boolean => {
          if (typeof candidate === 'boolean') {
            return candidate;
          }
          if (typeof fallback === 'boolean') {
            return fallback;
          }
          if (typeof metaDefault === 'boolean') {
            return metaDefault;
          }
          return false;
        };

        // Check for LoadImage nodes
        if (nodeType === 'LoadImage') {
          inputs.push({
            name: `image_${nodeId}`,
            type: 'image',
            label: resolveInputLabel('image'),
          });
        }

        // Check for CLIPTextEncode nodes (prompts)
        if (nodeType === 'CLIPTextEncode') {
          const promptLabel = /提示词/i.test(nodeDisplayName)
            ? nodeDisplayName
            : `${nodeDisplayName} 提示词`;
          inputs.push({
            name: `text_${nodeId}`,
            type: 'text',
            label: promptLabel,
            default: (widgetValues?.[0] as string) || '',
            required: true,
            multiline: true,
            prompt: true,
            description: `输入${promptLabel}...`,
          });
        }

        const widgetValueByName = buildWidgetValueByName();

        // Build linked input names early so widget/input loops can skip them
        const linkedInputNames = new Set<string>();
        if (Array.isArray(nodeData.inputs)) {
          nodeData.inputs.forEach((input) => {
            if (!input || typeof input !== 'object') return;
            const inputRecord = input as Record<string, unknown>;
            const inputName = typeof inputRecord.name === 'string' ? inputRecord.name : '';
            if (!inputName) return;
            if (inputRecord.link !== null && inputRecord.link !== undefined) {
              linkedInputNames.add(inputName);
            }
          });
        }

        const widgets = Array.isArray(nodeData.widgets)
          ? nodeData.widgets.filter((widget) => widget && typeof widget === 'object') as Array<Record<string, unknown>>
          : [];
        widgets.forEach((widget, idx) => {
          const widgetName = typeof widget.name === 'string' ? widget.name : '';
          if (!widgetName) return;
          // Skip inputs that are linked to another node (e.g., width/height from GetImageSize)
          if (linkedInputNames.has(widgetName)) return;

          const generatedName = `${widgetName}_${nodeId}`;
          if (inputs.some((input) => input.name === generatedName)) return;

          const widgetOptions = widget.options && typeof widget.options === 'object'
            ? widget.options as Record<string, unknown>
            : undefined;
          const rawValues = Array.isArray(widgetOptions?.values)
            ? widgetOptions.values
            : (Array.isArray(widgetOptions?.options) ? widgetOptions.options : undefined);
          const optionValues = Array.isArray(rawValues)
            ? rawValues.filter((value): value is string => typeof value === 'string')
            : undefined;
          const config = getInputConfig(widgetName);
          const configOptions = extractOptions(config);
          const modelOptions = resolveModelOptions(widgetName);
          const configDefault = (config?.[1] as Record<string, unknown> | undefined)?.default;
          const widgetDefault = widgetValueByName.get(widgetName) ?? widgetValues?.[idx];
          const defaultValue = widgetDefault ?? configDefault;
          const numericMeta = extractNumericMeta(config);

          if ((modelOptions && modelOptions.length > 0) || (optionValues && optionValues.length > 0) || (configOptions && configOptions.length > 0)) {
            const options = modelOptions && modelOptions.length > 0
              ? modelOptions
              : (optionValues && optionValues.length > 0 ? optionValues : configOptions);
            inputs.push({
              name: generatedName,
              type: 'select',
              label: resolveInputLabel(widgetName, widget.label),
              default: normalizeSelectDefault(defaultValue, options, configDefault),
              options,
            });
            return;
          }

          const inputTypeTag = extractInputTypeTag(config);

          if (typeof defaultValue === 'number' || inputTypeTag === 'INT' || inputTypeTag === 'FLOAT') {
            inputs.push({
              name: generatedName,
              type: 'number',
              label: resolveInputLabel(widgetName, widget.label),
              default: normalizeNumericDefault(defaultValue, widgetDefault, numericMeta.defaultValue),
              min: numericMeta.min,
              max: numericMeta.max,
              step: numericMeta.step,
            });
            return;
          }

          if (typeof defaultValue === 'boolean' || inputTypeTag === 'BOOLEAN') {
            inputs.push({
              name: generatedName,
              type: 'boolean',
              label: resolveInputLabel(widgetName, widget.label),
              default: normalizeBooleanDefault(defaultValue, widgetDefault, numericMeta.defaultValue),
            });
            return;
          }

          if (typeof defaultValue === 'string' || typeof configDefault === 'string') {
            const resolvedLabel = resolveInputLabel(widgetName, widget.label);
            const resolvedDefault = typeof defaultValue === 'string' ? defaultValue : (configDefault as string);
            inputs.push({
              name: generatedName,
              type: 'text',
              label: resolvedLabel,
              default: resolvedDefault,
              multiline: isMultilineTextField({
                classType: classTypeStr,
                label: resolvedLabel,
                name: widgetName,
                nodeDisplayName,
                defaultValue: resolvedDefault,
              }),
              prompt: isPromptLikeTextField({
                classType: classTypeStr,
                label: resolvedLabel,
                name: widgetName,
                nodeDisplayName,
              }),
            });
          }
        });

        if (Array.isArray(nodeData.inputs)) {
          nodeData.inputs.forEach((input) => {
            if (!input || typeof input !== 'object') return;
            const inputRecord = input as Record<string, unknown>;
            const inputName = typeof inputRecord.name === 'string' ? inputRecord.name : '';
            if (!inputName) return;

            const widgetRecord = inputRecord.widget;
            const widgetName = widgetRecord && typeof widgetRecord === 'object' && typeof (widgetRecord as Record<string, unknown>).name === 'string'
              ? String((widgetRecord as Record<string, unknown>).name)
              : '';
            if (!widgetName) {
              return;
            }
            // Skip inputs that are linked to another node (e.g., width/height from GetImageSize)
            if (inputRecord.link !== null && inputRecord.link !== undefined) {
              return;
            }
            // Skip internal upload widgets (LoadImage's IMAGEUPLOAD)
            if (inputRecord.type === 'IMAGEUPLOAD') {
              return;
            }

            const generatedName = `${inputName}_${nodeId}`;
            if (inputs.some((item) => item.name === generatedName)) return;

            const config = getInputConfig(inputName);
            let configOptions = extractOptions(config);
            const modelOptions = resolveModelOptions(inputName);
            const numericMeta = extractNumericMeta(config);
            const inputTypeTag = extractInputTypeTag(config);
            const isComboInput = typeof inputRecord.type === 'string' && inputRecord.type.toUpperCase() === 'COMBO';

            // COMBO fallback: if input type is COMBO but objectInfo lookup failed,
            // try a direct lookup in objectInfo for this node's class_type
            if (isComboInput && !configOptions && !modelOptions && workflowObjectInfo) {
              for (const candidate of nodeTypeCandidates) {
                const nodeObjInfo = (workflowObjectInfo as Record<string, unknown>)[candidate];
                if (nodeObjInfo && typeof nodeObjInfo === 'object') {
                  const nodeInput = (nodeObjInfo as Record<string, unknown>).input;
                  if (nodeInput && typeof nodeInput === 'object') {
                    const req = (nodeInput as Record<string, unknown>).required;
                    if (req && typeof req === 'object' && (req as Record<string, unknown>)[inputName]) {
                      configOptions = extractOptions((req as Record<string, unknown>)[inputName] as ComfyInputConfig);
                      if (configOptions) break;
                    }
                    const opt = (nodeInput as Record<string, unknown>).optional;
                    if (!configOptions && opt && typeof opt === 'object' && (opt as Record<string, unknown>)[inputName]) {
                      configOptions = extractOptions((opt as Record<string, unknown>)[inputName] as ComfyInputConfig);
                      if (configOptions) break;
                    }
                  }
                }
              }
            }

            const widgetDefault = widgetName ? widgetValueByName.get(widgetName) : undefined;

            const inputDefaultRaw = inputRecord.default ?? inputRecord.value ?? widgetDefault ?? numericMeta.defaultValue;
            if (typeof inputDefaultRaw === 'number' || inputTypeTag === 'INT' || inputTypeTag === 'FLOAT') {
              const numericDefault = normalizeNumericDefault(inputDefaultRaw, widgetDefault, numericMeta.defaultValue);
              inputs.push({
                name: generatedName,
                type: 'number',
                label: resolveInputLabel(inputName, inputRecord.label),
                default: numericDefault,
                min: numericMeta.min,
                max: numericMeta.max,
                step: numericMeta.step,
              });
              return;
            }

            if (typeof inputDefaultRaw === 'boolean' || inputTypeTag === 'BOOLEAN') {
              inputs.push({
                name: generatedName,
                type: 'boolean',
                label: resolveInputLabel(inputName, inputRecord.label),
                default: normalizeBooleanDefault(inputDefaultRaw, widgetDefault, numericMeta.defaultValue),
              });
              return;
            }

            if (typeof inputDefaultRaw === 'string') {
              const isLongText = inputDefaultRaw.length > 80;
              if ((modelOptions && modelOptions.length > 0) || (configOptions && configOptions.length > 0)) {
                const options = modelOptions && modelOptions.length > 0 ? modelOptions : configOptions;
                inputs.push({
                  name: generatedName,
                  type: 'select',
                  label: resolveInputLabel(inputName, inputRecord.label),
                  default: normalizeSelectDefault(inputDefaultRaw, options, numericMeta.defaultValue),
                  options,
                });
              } else {
                inputs.push({
                  name: generatedName,
                  type: isLongText ? 'text' : 'text',
                  label: resolveInputLabel(inputName, inputRecord.label),
                  default: inputDefaultRaw,
                });
              }
              return;
            }

            if ((modelOptions && modelOptions.length > 0) || (configOptions && configOptions.length > 0)) {
              const options = modelOptions && modelOptions.length > 0 ? modelOptions : configOptions;
              inputs.push({
                name: generatedName,
                type: 'select',
                label: resolveInputLabel(inputName, inputRecord.label),
                default: normalizeSelectDefault(undefined, options, numericMeta.defaultValue),
                options,
              });
            }
          });
        }

        // Fallback: use objectInfo required keys to parse widgets_values
        // for workflow formats that lack both nodeData.widgets and inputs[].widget
        if (requiredInfo && Array.isArray(widgetValues) && widgetValues.length > 0) {
          const addedNames = new Set(inputs.map(i => i.name));
          const requiredKeys = Object.keys(requiredInfo);
          let valueCursor = 0;
          requiredKeys.forEach((inputName) => {
            const generatedName = `${inputName}_${nodeId}`;

            // Always advance cursor to stay synchronized with widgets_values order,
            // even when skipping linked or already-added inputs
            if (valueCursor >= widgetValues.length) return;
            const candidateValue = widgetValues[valueCursor];
            valueCursor++;

            if (addedNames.has(generatedName)) return;
            if (linkedInputNames.has(inputName)) return;

            const config = getInputConfig(inputName);
            const configOptions = extractOptions(config);
            const modelOptions = resolveModelOptions(inputName);
            const numericMeta = extractNumericMeta(config);
            const inputTypeTag = extractInputTypeTag(config);
            const defaultValue = candidateValue;

            if ((modelOptions && modelOptions.length > 0) || (configOptions && configOptions.length > 0)) {
              const options = modelOptions && modelOptions.length > 0 ? modelOptions : configOptions;
              inputs.push({
                name: generatedName,
                type: 'select',
                label: resolveInputLabel(inputName),
                default: normalizeSelectDefault(defaultValue, options, numericMeta.defaultValue),
                options,
              });
              return;
            }

            if (typeof defaultValue === 'number' || inputTypeTag === 'INT' || inputTypeTag === 'FLOAT') {
              inputs.push({
                name: generatedName,
                type: 'number',
                label: resolveInputLabel(inputName),
                default: normalizeNumericDefault(defaultValue, undefined, numericMeta.defaultValue),
                min: numericMeta.min,
                max: numericMeta.max,
                step: numericMeta.step,
              });
              return;
            }

            if (typeof defaultValue === 'boolean' || inputTypeTag === 'BOOLEAN') {
              inputs.push({
                name: generatedName,
                type: 'boolean',
                label: resolveInputLabel(inputName),
                default: normalizeBooleanDefault(defaultValue, undefined, numericMeta.defaultValue),
              });
              return;
            }

            if (typeof defaultValue === 'string') {
              const resolvedLabel = resolveInputLabel(inputName);
              inputs.push({
                name: generatedName,
                type: 'text',
                label: resolvedLabel,
                default: defaultValue,
                multiline: isMultilineTextField({
                  classType: classTypeStr,
                  label: resolvedLabel,
                  name: inputName,
                  nodeDisplayName,
                  defaultValue,
                }),
                prompt: isPromptLikeTextField({
                  classType: classTypeStr,
                  label: resolvedLabel,
                  name: inputName,
                  nodeDisplayName,
                }),
              });
            }
          });
        }

        // linkedInputNames already built earlier — reuse for optional config filtering
        const optionalConfigCandidates: Array<[string, unknown]> = [];
        if (optionalInfo) {
          const added = new Set<string>();
          optionalInputOrder.forEach((inputName) => {
            if (Object.prototype.hasOwnProperty.call(optionalInfo, inputName)) {
              optionalConfigCandidates.push([inputName, optionalInfo[inputName]]);
              added.add(inputName);
            }
          });
          Object.entries(optionalInfo).forEach(([inputName, rawConfig]) => {
            if (added.has(inputName)) {
              return;
            }
            optionalConfigCandidates.push([inputName, rawConfig]);
          });
        }
        optionalConfigCandidates.forEach(([inputName, rawConfig]) => {
          const generatedName = `${inputName}_${nodeId}`;
          if (inputs.some((item) => item.name === generatedName)) {
            return;
          }
          if (linkedInputNames.has(inputName)) {
            return;
          }

          const config = rawConfig as ComfyInputConfig;
          const configOptions = extractOptions(config);
          const modelOptions = resolveModelOptions(inputName);
          const options = modelOptions && modelOptions.length > 0 ? modelOptions : configOptions;
          if (!options || options.length === 0) {
            return;
          }

          const configDefault = (config?.[1] as Record<string, unknown> | undefined)?.default;
          inputs.push({
            name: generatedName,
            type: 'select',
            label: resolveInputLabel(inputName),
            default: normalizeSelectDefault(undefined, options, configDefault),
            options,
          });
        });
      }
    });
  }

  return inputs.map((input) => {
    const splitIndex = input.name.lastIndexOf('_');
    const parsedNodeId = splitIndex > 0 ? input.name.slice(splitIndex + 1) : undefined;
    const resolvedClassType = parsedNodeId
      ? (nodeClassTypeById.get(parsedNodeId) || DEFAULT_CLASS_TYPE)
      : DEFAULT_CLASS_TYPE;
    return {
      ...input,
      nodeId: parsedNodeId,
      classType: resolvedClassType,
      nodeLabel: parsedNodeId
        ? (nodeLabelById.get(parsedNodeId) || getNodeTypeChineseLabel(resolvedClassType) || resolvedClassType)
        : (getNodeTypeChineseLabel(resolvedClassType) || resolvedClassType),
    };
  });
};

// ---------------------------------------------------------------------------
// Prompt compilation (workflow JSON + values → ComfyUI API prompt)
// ---------------------------------------------------------------------------

export const compileWorkflowToPrompt = (
  workflow: any,
  values: Record<string, string | number | boolean>,
  objectInfo: Record<string, unknown> | null
): Record<string, unknown> => {
  if (!workflow || !Array.isArray(workflow.nodes)) return {};

  const prompt: Record<string, unknown> = {};
  const linkMap = new Map<number, any[]>();
  const objectInfoRecord = objectInfo && typeof objectInfo === 'object'
    ? objectInfo as Record<string, unknown>
    : null;

  // Build link map for connections
  if (Array.isArray(workflow.links)) {
    workflow.links.forEach((link: any[]) => {
      if (Array.isArray(link) && typeof link[0] === 'number') {
        linkMap.set(link[0], link);
      }
    });
  }

  workflow.nodes.forEach((node: any) => {
    if (!node || node.id === undefined || node.id === null) {
      return;
    }

    const classType = node.comfyClass || node.class_type || node.type;
    if (typeof classType === 'string' && SKIPPED_NODE_TYPES.has(classType)) {
      return;
    }
    const nodeId = String(node.id);
    const widgetValues = node.widgets_values || [];
    const inputs: Record<string, unknown> = {};
    const nodeSuffix = `_${node.id}`;

    const resolveValueForInput = (inputName: string): string | number | boolean | undefined => {
      const direct = values[`${inputName}_${node.id}`];
      if (direct !== undefined) {
        return direct;
      }

      const normalizedName = inputName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const suffix = `_${node.id}`;
      const matchedEntry = Object.entries(values).find(([key]) => {
        if (!key.endsWith(suffix)) return false;
        const keyPrefix = key.slice(0, -suffix.length).toLowerCase().replace(/[^a-z0-9]/g, '');
        return keyPrefix === normalizedName;
      });

      return matchedEntry?.[1];
    };

    const resolveNodeTypeInfo = (): Record<string, unknown> | undefined => {
      if (!objectInfoRecord) {
        return undefined;
      }

      const candidates = [node.comfyClass, node.class_type, node.type]
        .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '')
        .map((candidate) => candidate.trim());

      for (const candidate of candidates) {
        const exact = objectInfoRecord[candidate];
        if (exact && typeof exact === 'object') {
          return exact as Record<string, unknown>;
        }
      }

      const normalizedCandidates = new Set(
        candidates.map((candidate) => candidate.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
      );

      for (const [key, value] of Object.entries(objectInfoRecord)) {
        if (!value || typeof value !== 'object') {
          continue;
        }
        const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (normalizedCandidates.has(normalizedKey)) {
          return value as Record<string, unknown>;
        }
      }

      return undefined;
    };

    const coerceInputByConfig = (candidate: unknown, config: ComfyInputConfig): unknown => {
      if (!config) {
        return candidate;
      }

      const typeToken = config[0];
      const meta = (config[1] as Record<string, unknown> | undefined) ?? {};

      if (Array.isArray(typeToken)) {
        const options = typeToken.map((item) => String(item));
        if (options.length === 0) {
          return candidate;
        }
        const normalized = String(candidate ?? '');
        if (options.includes(normalized)) {
          return normalized;
        }
        const fallback = typeof meta.default === 'string' ? meta.default : options[0];
        return options.includes(fallback) ? fallback : options[0];
      }

      if (typeof typeToken !== 'string') {
        return candidate;
      }

      const upper = typeToken.toUpperCase();
      if (upper === 'INT' || upper === 'FLOAT') {
        const parsed = typeof candidate === 'number'
          ? candidate
          : (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate))
            ? Number(candidate)
            : undefined);
        let value = parsed;
        if (value === undefined) {
          value = typeof meta.default === 'number' ? meta.default : 0;
        }
        if (typeof meta.min === 'number' && value < meta.min) {
          value = meta.min;
        }
        if (typeof meta.max === 'number' && value > meta.max) {
          value = meta.max;
        }
        return upper === 'INT' ? Math.trunc(value) : value;
      }

      if (upper === 'BOOLEAN') {
        if (typeof candidate === 'boolean') {
          return candidate;
        }
        if (candidate === 1 || candidate === '1' || candidate === 'true') {
          return true;
        }
        if (candidate === 0 || candidate === '0' || candidate === 'false') {
          return false;
        }
        if (typeof meta.default === 'boolean') {
          return meta.default;
        }
        return false;
      }

      if (upper === 'STRING' || upper === 'COMBO') {
        if (candidate === undefined || candidate === null) {
          return typeof meta.default === 'string' ? meta.default : '';
        }
        return String(candidate);
      }

      return candidate;
    };

    const coerceWidgetValue = (widget: Record<string, unknown>, candidate: unknown, fallback: unknown) => {
      if (candidate === undefined) {
        return fallback;
      }

      const widgetOptions = widget.options && typeof widget.options === 'object'
        ? widget.options as Record<string, unknown>
        : undefined;
      const optionValuesRaw = Array.isArray(widgetOptions?.values)
        ? widgetOptions.values
        : (Array.isArray(widgetOptions?.options) ? widgetOptions.options : undefined);
      const optionValues = Array.isArray(optionValuesRaw)
        ? optionValuesRaw.map((value) => String(value))
        : undefined;

      if (optionValues && optionValues.length > 0) {
        const normalized = String(candidate);
        return optionValues.includes(normalized) ? normalized : fallback;
      }

      if (typeof fallback === 'number') {
        const parsed = typeof candidate === 'number'
          ? candidate
          : (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate))
            ? Number(candidate)
            : undefined);

        if (parsed === undefined) {
          return fallback;
        }

        const min = typeof widgetOptions?.min === 'number' ? widgetOptions.min : undefined;
        const max = typeof widgetOptions?.max === 'number' ? widgetOptions.max : undefined;

        if (typeof min === 'number' && parsed < min) return min;
        if (typeof max === 'number' && parsed > max) return max;
        return parsed;
      }

      if (typeof fallback === 'boolean') {
        if (typeof candidate === 'boolean') return candidate;
        if (typeof candidate === 'number') return candidate !== 0;
        if (typeof candidate === 'string') {
          const normalized = candidate.trim().toLowerCase();
          if (normalized === 'true' || normalized === '1') return true;
          if (normalized === 'false' || normalized === '0') return false;
        }
        return fallback;
      }

      if (typeof fallback === 'string') {
        return String(candidate);
      }

      return candidate;
    };

    const widgets = Array.isArray(node.widgets)
      ? node.widgets.filter((widget: unknown) => widget && typeof widget === 'object')
      : [];
    const widgetValueByName = new Map<string, unknown>();

    if (widgets.length > 0) {
      widgets.forEach((widget: any, idx: number) => {
        if (typeof widget?.name === 'string') {
          widgetValueByName.set(widget.name, widgetValues[idx]);
        }
      });
    } else if (Array.isArray(node.inputs) && widgetValues.length > 0) {
      let widgetIndex = 0;
      node.inputs.forEach((input: any) => {
        const widgetName = input?.widget?.name;
        if (typeof widgetName !== 'string') {
          return;
        }
        widgetValueByName.set(widgetName, widgetValues[widgetIndex]);
        widgetIndex += 1;
      });
    }

    widgets.forEach((widget: any, idx: number) => {
      const widgetName = typeof widget.name === 'string' ? widget.name : '';
      if (!widgetName) return;

      const directValue = resolveValueForInput(widgetName);
      const fallbackValue = widgetValueByName.get(widgetName) ?? widgetValues[idx];
      const resolvedValue = coerceWidgetValue(widget as Record<string, unknown>, directValue, fallbackValue);

      if (resolvedValue !== undefined && inputs[widgetName] === undefined) {
        inputs[widgetName] = resolvedValue;
      }
    });

    // Handle random seed generation for nodes with "randomize" mode
    widgets.forEach((widget: any, idx: number) => {
      const widgetName = typeof widget.name === 'string' ? widget.name : '';
      if (!widgetName) return;

      const widgetNameLower = widgetName.toLowerCase();
      const isSeedInput = widgetNameLower.includes('seed');
      if (isSeedInput && widgetValues[idx + 1] === 'randomize' && inputs[widgetName] === undefined) {
        const randomSeed = Math.floor(Math.random() * 1000000000000000);
        inputs[widgetName] = randomSeed;
      }
    });

    if (widgets.length === 0 && Array.isArray(node.inputs) && widgetValues.length >= 2 && widgetValues[1] === 'randomize') {
      node.inputs.forEach((input: any) => {
        const inputName = input?.name;
        if (!inputName) return;
        const inputNameLower = inputName.toLowerCase();
        if (inputNameLower.includes('seed') && inputs[inputName] === undefined) {
          const randomSeed = Math.floor(Math.random() * 1000000000000000);
          inputs[inputName] = randomSeed;
        }
      });
    }

    // Handle connections first
    const linkedInputNames = new Set<string>();
    if (Array.isArray(node.inputs)) {
      node.inputs.forEach((input: any) => {
        if (input?.link !== null && input?.link !== undefined) {
          const link = linkMap.get(input.link);
          if (link) {
            inputs[input.name] = [String(link[1]), link[2]];
            if (typeof input?.name === 'string') {
              linkedInputNames.add(input.name);
            }
          }
        }
      });
    }

    Object.entries(values).forEach(([key, value]) => {
      if (!key.endsWith(nodeSuffix)) {
        return;
      }
      const inputName = key.slice(0, -nodeSuffix.length);
      if (!inputName || linkedInputNames.has(inputName)) {
        return;
      }
      inputs[inputName] = value;
    });

    if (Array.isArray(node.inputs)) {
      node.inputs.forEach((input: any) => {
        const inputName = input?.name;
        if (!inputName || inputs[inputName] !== undefined) {
          return;
        }
        if (input?.link !== null && input?.link !== undefined) {
          return;
        }

        const directValue = resolveValueForInput(inputName);
        if (directValue !== undefined) {
          inputs[inputName] = directValue;
          return;
        }

        const widgetName = input?.widget?.name;
        if (typeof widgetName === 'string' && widgetValueByName.has(widgetName)) {
          const fallbackValue = widgetValueByName.get(widgetName);
          inputs[inputName] = coerceWidgetValue(
            input?.widget as Record<string, unknown>,
            fallbackValue,
            fallbackValue
          );
          return;
        }

        const inputDefault = input?.default ?? input?.value;
        if (inputDefault !== undefined) {
          inputs[inputName] = inputDefault;
        }
      });
    }

    if (classType === 'FluxGuidance' && inputs['guidance'] === undefined) {
      const directGuidance = resolveValueForInput('guidance');
      if (typeof directGuidance === 'number') {
        inputs['guidance'] = directGuidance;
      } else if (typeof directGuidance === 'string' && directGuidance.trim() !== '' && !Number.isNaN(Number(directGuidance))) {
        inputs['guidance'] = Number(directGuidance);
      } else {
        const numericFallback = Array.isArray(widgetValues)
          ? widgetValues.find((value: unknown) => typeof value === 'number')
          : undefined;
        inputs['guidance'] = typeof numericFallback === 'number' ? numericFallback : 3.5;
      }
    }

    if (
      typeof classType === 'string' &&
      classType.toLowerCase().includes('loadimage') &&
      typeof inputs.image === 'string' &&
      inputs.image.trim() !== '' &&
      inputs.upload === undefined
    ) {
      inputs.upload = 'image';
    }

    const nodeTypeInfo = resolveNodeTypeInfo();
    const nodeInputInfo = nodeTypeInfo && typeof nodeTypeInfo.input === 'object'
      ? nodeTypeInfo.input as Record<string, unknown>
      : undefined;
    const requiredInfo = nodeInputInfo && typeof nodeInputInfo.required === 'object'
      ? nodeInputInfo.required as Record<string, unknown>
      : undefined;
    const optionalInfo = nodeInputInfo && typeof nodeInputInfo.optional === 'object'
      ? nodeInputInfo.optional as Record<string, unknown>
      : undefined;

    Object.keys(inputs).forEach((inputName) => {
      const value = inputs[inputName];
      if (Array.isArray(value)) {
        return;
      }
      const config = (requiredInfo?.[inputName] ?? optionalInfo?.[inputName]) as ComfyInputConfig;
      inputs[inputName] = coerceInputByConfig(value, config);
    });

    // Fill in missing required inputs from objectInfo defaults (e.g. SaveImage.filename_prefix)
    if (requiredInfo) {
      for (const [reqName, reqConfig] of Object.entries(requiredInfo)) {
        if (inputs[reqName] !== undefined) continue;
        if (!Array.isArray(reqConfig)) continue;
        const meta = (reqConfig[1] as Record<string, unknown>) ?? {};
        if (meta.default !== undefined) {
          inputs[reqName] = meta.default;
        } else if (Array.isArray(reqConfig[0]) && reqConfig[0].length > 0) {
          inputs[reqName] = reqConfig[0][0];
        } else if (typeof reqConfig[0] === 'string') {
          const t = reqConfig[0].toUpperCase();
          if (t === 'INT' || t === 'FLOAT') inputs[reqName] = 0;
          else if (t === 'BOOLEAN') inputs[reqName] = false;
          else inputs[reqName] = '';
        }
      }
    }

    prompt[nodeId] = {
      inputs,
      class_type: classType,
      _meta: { title: node.title || nodeId },
    };
  });

  return prompt;
};
