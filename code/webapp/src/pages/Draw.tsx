import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { ComfyUIClient, type ComfyUIWorkflowInfo, type ComfyUIHistoryEntry, type ExperimentModelCatalog } from '../services/comfyui';
import { useSettingsStore } from '../stores/settingsStore';
import { useConfigStore } from '../stores/configStore';
import { useWorkflowCacheStore, blobToBase64, base64ToBlobUrl } from '../stores/workflowCacheStore';
import { useComfyUIStore } from '../stores/comfyui';
import { useHistoryStore } from '../stores/historyStore';
import { PsExportButton } from '../components/upload/PsExportButton';
import { uploadToComfyUI, isUXPWebView, bridgeFetch, fileToBase64, importBase64ToPsLayer, sendBridgeMessage } from '../services/upload';
import { PromptReverseFlow } from '../components/promptReverse/PromptReverseFlow';
import { useKeyboardPassthrough } from '../hooks/useKeyboardPassthrough';
import { LemonGridClient, isImageParam, renderParamDefault, normalizeTemplateDetail, LEMONGRID_ERROR_SUGGESTIONS, groupClusterTemplatesByVariants, resolveClusterTemplateVariant, type LemonGridTemplateSummary, type LemonGridTemplateDetail, type ParamSchemaField, type GroupedClusterTemplateSummary, type LemonGridTaskStatus } from '../services/lemongrid';
import { useLemonGridStore } from '../stores/lemongridStore';
import { ensureValidToken } from '../services/lemongrid-auth';
import { MiniTaskList } from '../components/MiniTaskList';
import './Draw.css';
import {
  DEFAULT_CLASS_TYPE,
  getNodeTypeChineseLabel,
  ROOT_WORKFLOW_GROUP,
} from '../services/workflowConstants';
import type { WorkflowInput, WorkflowInputGroup } from '../services/workflowTypes';
import {
  getWorkflowDisplayMeta,
  getDefaultGroupedWorkflow,
  getDefaultWorkflow,
  groupWorkflowsByImageVariants,
  sanitizePromptGraph,
  applyInputValuesToPrompt,
  enforceLatestImageInputs,
  extractInputValuesFromHistoryParams,
  findBestMatchingWorkflow,
  parseWorkflowInputs,
  compileWorkflowToPrompt,
  remapInputValuesToWorkflowInputs,
  resolveGroupedWorkflowVariant,
  type GroupedWorkflowEntry,
} from '../services/workflowEngine';
import {
  addPromptHistoryEntries,
  addPromptLibraryEntry,
  getPromptLibraryEntries,
  removePromptLibraryEntry,
  type PromptLibraryEntry,
  type PromptLibraryKind,
} from '../services/promptLibrary';



// Generation progress state
interface GenerationProgress {
  status: 'idle' | 'generating' | 'completed' | 'error';
  percentage: number;
  currentNode: string | null;
  previewImage: string | null;
  error: string | null;
  promptId: string | null;
}

interface OutputImageData {
  previewUrl: string;
  blob: Blob;
  filename: string;
  assetId?: string;
}

interface WorkflowDirectoryGroup {
  directory: string;
  workflows: GroupedWorkflowEntry[];
}

interface HistoryActionItem {
  source?: 'direct' | 'cluster';
  workflow?: string;
  workflowName?: string;
  imageName?: string;
  params?: Record<string, unknown>;
  templateId?: string;
  templateType?: 'COMFYUI' | 'THIRD_PARTY_API';
}

interface HistoryActionState {
  rerunItem?: HistoryActionItem;
  editItem?: HistoryActionItem;
  trackClusterTaskId?: string;
}

interface PromptLibraryModalState {
  kind: PromptLibraryKind;
  storageKey: string;
  label: string;
  applyValue: (text: string) => void;
}

const PROMPT_FIELD_PATTERN = /prompt|提示词|description|描述/i;
const WORKFLOW_PROMPT_CLASS_PATTERN = /TextEncode|TextInput|ShowText|String/i;
const NEGATIVE_PROMPT_PATTERN = /negative|neg|反向|负向/i;
type PromptLibraryScope = 'positive' | 'negative';

const isPromptTemplateField = (field: Pick<ParamSchemaField, 'name' | 'label' | 'description'>): boolean =>
  PROMPT_FIELD_PATTERN.test(`${field.label} ${field.description || ''}`) || /prompt|text/i.test(field.name);

const isPromptWorkflowField = (input: WorkflowInput): boolean => {
  if (typeof input.prompt === 'boolean') {
    return input.prompt;
  }

  if (typeof input.classType === 'string' && WORKFLOW_PROMPT_CLASS_PATTERN.test(input.classType)) {
    return true;
  }

  return PROMPT_FIELD_PATTERN.test(input.label) || /prompt|text/i.test(input.name);
};

const getPromptLibraryScope = (field: Pick<WorkflowInput, 'name' | 'label'> & { description?: string } | Pick<ParamSchemaField, 'name' | 'label' | 'description'>): PromptLibraryScope => {
  const fieldText = `${field.name} ${field.label} ${field.description || ''}`;
  return NEGATIVE_PROMPT_PATTERN.test(fieldText) ? 'negative' : 'positive';
};

const getGlobalPromptLibraryKey = (scope: PromptLibraryScope): string =>
  scope === 'negative' ? 'prompt:negative' : 'prompt:positive';

const isLongTextWorkflowField = (input: WorkflowInput): boolean => {
  if (typeof input.multiline === 'boolean') {
    return input.multiline;
  }

  const defaultStr = typeof input.default === 'string' ? input.default : '';
  return isPromptWorkflowField(input) || /\n/.test(defaultStr);
};

const getTemplateFieldStateKey = (field: Pick<ParamSchemaField, 'node_id' | 'name'>): string =>
  `${field.node_id}.${field.name}`;

const getWorkflowImageInputOrder = (input: Pick<WorkflowInput, 'name' | 'nodeId'>): number => {
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

const sortWorkflowImageInputsByOrder = (inputs: WorkflowInput[]): WorkflowInput[] => (
  [...inputs].sort((a, b) => {
    const nodeDiff = getWorkflowImageInputOrder(a) - getWorkflowImageInputOrder(b);
    if (nodeDiff !== 0) {
      return nodeDiff;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  })
);

const sortTemplateImageFieldsByOrder = (fields: ParamSchemaField[]): ParamSchemaField[] => (
  [...fields].sort((a, b) => {
    const aNodeId = Number(a.node_id);
    const bNodeId = Number(b.node_id);
    if (Number.isFinite(aNodeId) && Number.isFinite(bNodeId) && aNodeId !== bNodeId) {
      return aNodeId - bNodeId;
    }
    return String(a.node_id).localeCompare(String(b.node_id), 'zh-CN');
  })
);

interface TemplateImageSlot {
  field: ParamSchemaField;
  fieldKey: string;
  slotIndex: number;
  slotKey: string;
  capacity: number;
}

interface WorkflowImageEntry {
  value: string;
  preview: string;
  base64: string;
}

interface TemplateImageEntry {
  assetId: string;
  filename: string;
  preview: string;
}

const getTemplateImageSlotKey = (fieldKey: string, slotIndex: number): string =>
  `${fieldKey}::${slotIndex}`;

const getTemplateImageFieldCapacity = (
  field: ParamSchemaField,
  templateType?: 'COMFYUI' | 'THIRD_PARTY_API'
): number => {
  if (templateType === 'THIRD_PARTY_API') {
    const maxImages = typeof field.max_images === 'number' && Number.isFinite(field.max_images)
      ? field.max_images
      : typeof field.max === 'number' && Number.isFinite(field.max)
        ? field.max
        : null;
    if (typeof maxImages === 'number') {
      return Math.max(1, Math.floor(maxImages));
    }
  }
  return 1;
};

const getTemplateSlotStringValue = (
  value: string | string[] | undefined,
  slotIndex: number
): string => {
  if (Array.isArray(value)) {
    const slotValue = value[slotIndex];
    return typeof slotValue === 'string' ? slotValue : '';
  }
  return slotIndex === 0 && typeof value === 'string' ? value : '';
};

const getTemplateAssetIdFromValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'asset_id' in value) {
    const assetId = (value as { asset_id?: unknown }).asset_id;
    return typeof assetId === 'string' ? assetId : '';
  }
  return '';
};

const getTemplateSlotAssetValue = (value: unknown, slotIndex: number): string => {
  if (Array.isArray(value)) {
    const slotValue = value[slotIndex];
    return getTemplateAssetIdFromValue(slotValue);
  }
  return slotIndex === 0 ? getTemplateAssetIdFromValue(value) : '';
};

const isLikelyLemonGridAssetId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes('-')) {
    return false;
  }
  if (/[\\/]/.test(trimmed)) {
    return false;
  }
  return !/\.[a-z0-9]{2,8}$/i.test(trimmed);
};

const extractOrderedWorkflowImageEntries = (
  imageInputs: WorkflowInput[],
  inputValues: Record<string, string | number | boolean>,
  previews: Record<string, string | string[]>,
  base64Values: Record<string, string>
): WorkflowImageEntry[] => (
  sortWorkflowImageInputsByOrder(imageInputs)
    .map((input) => {
      const value = inputValues[input.name];
      const previewValue = previews[input.name];
      const preview = Array.isArray(previewValue) ? previewValue[0] : previewValue;
      const base64 = base64Values[input.name];
      return {
        value: typeof value === 'string' ? value : '',
        preview: typeof preview === 'string' ? preview : '',
        base64: typeof base64 === 'string' ? base64 : '',
      };
    })
    .filter((entry) => entry.value.trim() !== '' || entry.preview.trim() !== '' || entry.base64.trim() !== '')
);

const applyWorkflowImageEntriesToInputs = (
  imageInputs: WorkflowInput[],
  entries: WorkflowImageEntry[]
): {
  values: Record<string, string>;
  previews: Record<string, string>;
  base64: Record<string, string>;
} => {
  const values: Record<string, string> = {};
  const previews: Record<string, string> = {};
  const base64: Record<string, string> = {};

  sortWorkflowImageInputsByOrder(imageInputs).forEach((input, index) => {
    const entry = entries[index];
    if (!entry) {
      return;
    }
    if (entry.value.trim() !== '') {
      values[input.name] = entry.value;
    }
    if (entry.preview.trim() !== '') {
      previews[input.name] = entry.preview;
    }
    if (entry.base64.trim() !== '') {
      base64[input.name] = entry.base64;
    }
  });

  return { values, previews, base64 };
};

const getTemplateImageSlotsForDetail = (detail: LemonGridTemplateDetail): TemplateImageSlot[] =>
  sortTemplateImageFieldsByOrder(
    detail.param_schema.filter((field) => !field.hidden && isImageParam(field))
  ).flatMap((field) => {
    const fieldKey = getTemplateFieldStateKey(field);
    const capacity = getTemplateImageFieldCapacity(field, detail.template_type);
    return Array.from({ length: capacity }, (_, slotIndex) => ({
      field,
      fieldKey,
      slotIndex,
      slotKey: getTemplateImageSlotKey(fieldKey, slotIndex),
      capacity,
    }));
  });

const extractOrderedTemplateImageEntries = (
  detail: LemonGridTemplateDetail,
  params: Record<string, unknown>,
  imageInputs: Record<string, string | string[]>,
  previews: Record<string, string | string[]>
): TemplateImageEntry[] => (
  getTemplateImageSlotsForDetail(detail)
    .map((slot) => ({
      assetId: getTemplateSlotAssetValue(params[slot.fieldKey], slot.slotIndex),
      filename: getTemplateSlotStringValue(imageInputs[slot.fieldKey], slot.slotIndex),
      preview: getTemplateSlotStringValue(previews[slot.fieldKey], slot.slotIndex),
    }))
    .filter((entry) => entry.assetId.trim() !== '' || entry.filename.trim() !== '' || entry.preview.trim() !== '')
);

const applyTemplateImageEntriesToDetail = (
  detail: LemonGridTemplateDetail,
  entries: TemplateImageEntry[],
  params: Record<string, unknown>,
  imageInputs: Record<string, string | string[]>,
  previews: Record<string, string | string[]>
): {
  targetParams: Record<string, unknown>;
  targetImageInputs: Record<string, string | string[]>;
  targetPreviews: Record<string, string | string[]>;
} => {
  let targetParams = params;
  let targetImageInputs = imageInputs;
  let targetPreviews = previews;

  getTemplateImageSlotsForDetail(detail).forEach((slot, index) => {
    const entry = entries[index];
    if (!entry) {
      return;
    }
    if (entry.assetId.trim() !== '') {
      targetParams = updateTemplateAssetSlotRecord(targetParams, slot.fieldKey, slot.slotIndex, entry.assetId);
    }
    if (entry.filename.trim() !== '') {
      targetImageInputs = updateTemplateStringSlotRecord(targetImageInputs, slot.fieldKey, slot.slotIndex, entry.filename);
    }
    if (entry.preview.trim() !== '') {
      targetPreviews = updateTemplateStringSlotRecord(targetPreviews, slot.fieldKey, slot.slotIndex, entry.preview);
    }
  });

  return {
    targetParams,
    targetImageInputs,
    targetPreviews,
  };
};

const updateTemplateStringSlotRecord = (
  record: Record<string, string | string[]>,
  fieldKey: string,
  slotIndex: number,
  nextValue: string
): Record<string, string | string[]> => {
  const currentValue = record[fieldKey];
  const currentItems = Array.isArray(currentValue)
    ? [...currentValue]
    : typeof currentValue === 'string' && currentValue !== ''
      ? [currentValue]
      : [];

  if (nextValue) {
    currentItems[slotIndex] = nextValue;
  } else if (slotIndex < currentItems.length) {
    currentItems.splice(slotIndex, 1);
  }

  const next = { ...record };
  if (currentItems.length === 0) {
    delete next[fieldKey];
  } else if (currentItems.length === 1 && slotIndex === 0 && !Array.isArray(currentValue)) {
    next[fieldKey] = currentItems[0];
  } else {
    next[fieldKey] = currentItems;
  }
  return next;
};

const updateTemplateAssetSlotRecord = (
  record: Record<string, unknown>,
  fieldKey: string,
  slotIndex: number,
  nextValue: string
): Record<string, unknown> => {
  const currentValue = record[fieldKey];
  const currentItems = Array.isArray(currentValue)
    ? currentValue.filter((item): item is string => typeof item === 'string')
    : typeof currentValue === 'string' && currentValue !== ''
      ? [currentValue]
      : [];

  if (nextValue) {
    currentItems[slotIndex] = nextValue;
  } else if (slotIndex < currentItems.length) {
    currentItems.splice(slotIndex, 1);
  }

  const next = { ...record };
  next[fieldKey] = currentItems;
  return next;
};

const swapTemplateStringSlotRecord = (
  record: Record<string, string | string[]>,
  sourceSlot: TemplateImageSlot,
  targetSlot: TemplateImageSlot
): Record<string, string | string[]> => {
  const sourceValue = getTemplateSlotStringValue(record[sourceSlot.fieldKey], sourceSlot.slotIndex);
  const targetValue = getTemplateSlotStringValue(record[targetSlot.fieldKey], targetSlot.slotIndex);
  let next = updateTemplateStringSlotRecord(record, sourceSlot.fieldKey, sourceSlot.slotIndex, targetValue);
  next = updateTemplateStringSlotRecord(next, targetSlot.fieldKey, targetSlot.slotIndex, sourceValue);
  return next;
};

const swapTemplateAssetSlotRecord = (
  record: Record<string, unknown>,
  sourceSlot: TemplateImageSlot,
  targetSlot: TemplateImageSlot
): Record<string, unknown> => {
  const sourceValue = getTemplateSlotAssetValue(record[sourceSlot.fieldKey], sourceSlot.slotIndex);
  const targetValue = getTemplateSlotAssetValue(record[targetSlot.fieldKey], targetSlot.slotIndex);
  let next = updateTemplateAssetSlotRecord(record, sourceSlot.fieldKey, sourceSlot.slotIndex, targetValue);
  next = updateTemplateAssetSlotRecord(next, targetSlot.fieldKey, targetSlot.slotIndex, sourceValue);
  return next;
};

// Per D-05: Memoized output image strip item to prevent re-renders
const OutputImageItem = React.memo(({
  image,
  index,
  isActive,
  onSelect,
  assetId,
}: {
  image: { previewUrl: string };
  index: number;
  isActive: boolean;
  onSelect: (index: number) => void;
  assetId?: string;
}) => (
  <button
    key={`draw-output-${index}`}
    type="button"
    className={`preview-strip-item ${isActive ? 'active' : ''}`}
    onClick={() => onSelect(index)}
    title={`查看第 ${index + 1} 张输出`}
  >
    <img
      src={image.previewUrl}
      alt={`output-${index + 1}`}
      data-prompt-reverse
      {...(assetId ? { 'data-asset-id': assetId } : {})}
    />
  </button>
));

export const Draw = () => {
  const location = useLocation();
  // Settings
  // Settings
  const comfyUISettings = useSettingsStore((state) => state.comfyUI);
  const psImportMode = useSettingsStore((state) => state.psImportMode);

  // Config store for filtering displayed nodes
  const { shouldDisplayNode, getAllowedInputs, loadConfig, config } = useConfigStore();

  // ComfyUI queue store
  const { fetchQueue, setBaseUrl: setComfyUIBaseUrl } = useComfyUIStore();

  // Workflows
  const [workflows, setWorkflows] = useState<ComfyUIWorkflowInfo[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ComfyUIWorkflowInfo | null>(null);
  const selectedWorkflowRef = useRef<ComfyUIWorkflowInfo | null>(null);
  const [workflowInputs, setWorkflowInputs] = useState<WorkflowInput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [seedModes, setSeedModes] = useState<Record<string, 'fixed' | 'increment' | 'decrement' | 'randomize'>>({});
  const [openSeedDropdown, setOpenSeedDropdown] = useState<string | null>(null);
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [objectInfo, setObjectInfo] = useState<Record<string, unknown> | null>(null);
  const [experimentModels, setExperimentModels] = useState<ExperimentModelCatalog>({});
  const [isWorkflowPickerOpen, setIsWorkflowPickerOpen] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [uploadedImagePreviews, setUploadedImagePreviews] = useState<Record<string, string | string[]>>({});
  const [templateUploadedImagePreviews, setTemplateUploadedImagePreviews] = useState<Record<string, string | string[]>>({});
  const [templateUploadingFieldKeys, setTemplateUploadingFieldKeys] = useState<Set<string>>(new Set());
  const [draggingTemplateImageFieldKey, setDraggingTemplateImageFieldKey] = useState<string | null>(null);
  const [templateImageDropTargetKey, setTemplateImageDropTargetKey] = useState<string | null>(null);

  // Cluster Mode state per D-50, D-51
  const connectionMode = useSettingsStore((s) => s.connectionMode);
  const lemonGridStore = useLemonGridStore();
  // Login modal is now mounted globally by the AuthGuard in App.tsx — Draw.tsx
  // only needs read-only access to the auth state for guard checks.
  const { isConnected: isLemonGridConnected, serverUrl: lemonGridServerUrl } = lemonGridStore;

  // Template state (replaces workflow state in Cluster Mode)
  const [clusterTemplates, setClusterTemplates] = useState<LemonGridTemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<LemonGridTemplateDetail | null>(null);
  const [selectedTemplateGroupKey, setSelectedTemplateGroupKey] = useState<string | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [templateParams, setTemplateParams] = useState<Record<string, unknown>>({});
  const [templateImageInputs, setTemplateImageInputs] = useState<Record<string, string | string[]>>({});
  // Per D-24: WebSocket connection refs for per-task connections
  const wsConnectionRefs = useRef<Record<string, string>>({});
  const latestInputValuesRef = useRef<Record<string, string | number | boolean>>({});
  // 跨工作流切换时携带的提示词：缓存命中时仍优先使用缓存，未命中时用携带值覆盖默认
  const carriedPositivePromptRef = useRef<string>('');
  const carriedNegativePromptRef = useRef<string>('');
  // 镜像 selectedTemplate state，便于在 handleWorkflowSelect 中访问 param_schema
  // （云端模式 useEffect 切换时 setSelectedTemplate(null) 之后，state 已清空但 ref 仍保留旧 schema）
  const selectedTemplateRef = useRef<LemonGridTemplateDetail | null>(null);
  // Refs for workflow cache - store blob and base64 data for image inputs
  const uploadedImageBlobsRef = useRef<Record<string, Blob>>({});
  const uploadedImageBase64Ref = useRef<Record<string, string>>({});
  const currentWorkflowKeyRef = useRef<string | null>(null);
  const uploadedImagePreviewsRef = useRef<Record<string, string | string[]>>({});
  const templateParamsRef = useRef<Record<string, unknown>>({});
  const templateImageInputsRef = useRef<Record<string, string | string[]>>({});
  const templateUploadedImagePreviewsRef = useRef<Record<string, string | string[]>>({});
  const templateUploadTasksRef = useRef<Record<string, Promise<void>>>({});

  // Invalid image references tracking
  const [invalidImageRefs, setInvalidImageRefs] = useState<Set<string>>(new Set());

  // Generation
  const [progress, setProgress] = useState<GenerationProgress>({
    status: 'idle',
    percentage: 0,
    currentNode: null,
    previewImage: null,
    error: null,
    promptId: null,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [clusterSubmitError, setClusterSubmitError] = useState<string | null>(null);
  const [isSubmittingCluster, setIsSubmittingCluster] = useState(false);
  const [, setLatestGeneratedImageBlob] = useState<Blob | null>(null);
  const [outputImages, setOutputImages] = useState<OutputImageData[]>([]);
  const [activeOutputIndex, setActiveOutputIndex] = useState(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [promptLibraryModal, setPromptLibraryModal] = useState<PromptLibraryModalState | null>(null);
  const [promptLibraryVersion, setPromptLibraryVersion] = useState(0);
  const [recentlySavedPromptKey, setRecentlySavedPromptKey] = useState<string | null>(null);

  // WebSocket for progress
  // WebSocket for progress
  const wsRef = useRef<WebSocket | null>(null);
  
  // Track if we've handled rerun/edit to avoid duplicate execution
  const hasHandledHistoryAction = useRef(false);
  const trackedClusterTaskIdsRef = useRef<Set<string>>(new Set());
  const pendingRerunPromptRef = useRef<Record<string, unknown> | null>(null);
  const templatePickerRef = useRef<HTMLDivElement | null>(null);


  // Per D-01/D-02: Forward PS keyboard shortcuts when webview has focus
  useKeyboardPassthrough();

  const parseAndEnrichWorkflowInputs = useCallback((
    workflowData: unknown,
    effectiveObjectInfo: Record<string, unknown> | null | undefined,
    modelCatalogOverride?: ExperimentModelCatalog
  ): WorkflowInput[] => {
    let inputs = parseWorkflowInputs(
      workflowData,
      effectiveObjectInfo ?? null,
      modelCatalogOverride ?? experimentModels
    );

    if (effectiveObjectInfo && typeof effectiveObjectInfo === 'object') {
      const oi = effectiveObjectInfo as Record<string, unknown>;
      inputs = inputs.map((input) => {
        if (input.type !== 'text' || (input.options && input.options.length > 0)) {
          return input;
        }

        const splitIdx = input.name.lastIndexOf('_');
        const originalInputName = splitIdx > 0 ? input.name.slice(0, splitIdx) : input.name;
        const classType = input.classType;
        if (!classType || !originalInputName) {
          return input;
        }

        const nodeInfo = oi[classType];
        if (!nodeInfo || typeof nodeInfo !== 'object') {
          return input;
        }

        const nodeInput = (nodeInfo as Record<string, unknown>).input;
        if (!nodeInput || typeof nodeInput !== 'object') {
          return input;
        }

        const required = (nodeInput as Record<string, unknown>).required;
        const optional = (nodeInput as Record<string, unknown>).optional;
        const config = (required && typeof required === 'object')
          ? (required as Record<string, unknown>)[originalInputName]
          : undefined;
        const configAlt = (!config && optional && typeof optional === 'object')
          ? (optional as Record<string, unknown>)[originalInputName]
          : undefined;
        const effectiveConfig = config ?? configAlt;
        if (!effectiveConfig || !Array.isArray(effectiveConfig as unknown[])) {
          return input;
        }

        const cfgArr = effectiveConfig as unknown[];
        if (Array.isArray(cfgArr[0]) && (cfgArr[0] as unknown[]).length > 0) {
          const options = (cfgArr[0] as unknown[]).map((v) => String(v));
          return {
            ...input,
            type: 'select' as const,
            options,
            default: typeof input.default === 'string' && options.includes(input.default)
              ? input.default
              : options[0],
          };
        }

        return input;
      });
    }

    return inputs;
  }, [experimentModels]);

  const groupedClusterWorkflowTemplates = useMemo(
    () => groupClusterTemplatesByVariants(
      clusterTemplates.filter((template) => (template.template_type || 'COMFYUI') === 'COMFYUI')
    ),
    [clusterTemplates]
  );

  const clusterCloudTemplateGroups = useMemo(() => {
    const categories = new Map<string, LemonGridTemplateSummary[]>();

    clusterTemplates
      .filter((template) => (template.template_type || 'COMFYUI') === 'THIRD_PARTY_API')
      .forEach((template) => {
        const category = template.category?.trim() || '未分类';
        const group = categories.get(category);
        if (group) {
          group.push(template);
        } else {
          categories.set(category, [template]);
        }
      });

    return Array.from(categories.entries()).map(([category, templates]) => ({
      category,
      templates,
    }));
  }, [clusterTemplates]);

  const selectedTemplateGroup = useMemo(
    () => groupedClusterWorkflowTemplates.find((group) => group.key === selectedTemplateGroupKey) ?? null,
    [groupedClusterWorkflowTemplates, selectedTemplateGroupKey]
  );

  const selectedTemplateDisplayName = selectedTemplateGroup?.name ?? selectedTemplate?.name ?? null;

  const promptLibraryEntries = useMemo<PromptLibraryEntry[]>(
    () => (
      promptLibraryModal
        ? getPromptLibraryEntries(promptLibraryModal.storageKey, promptLibraryModal.kind)
        : []
    ),
    [promptLibraryModal, promptLibraryVersion]
  );

  const buildWorkflowPromptLibraryKey = useCallback(
    (input: WorkflowInput) => getGlobalPromptLibraryKey(getPromptLibraryScope(input)),
    []
  );

  const buildTemplatePromptLibraryKey = useCallback(
    (field: Pick<ParamSchemaField, 'name' | 'label' | 'description'>) => getGlobalPromptLibraryKey(getPromptLibraryScope(field)),
    []
  );

  const openPromptLibraryModal = useCallback((
    kind: PromptLibraryKind,
    storageKey: string,
    label: string,
    applyValue: (text: string) => void
  ) => {
    setPromptLibraryModal({ kind, storageKey, label, applyValue });
  }, []);

  const closePromptLibraryModal = useCallback(() => {
    setPromptLibraryModal(null);
  }, []);

  const applyPromptLibraryEntry = useCallback((text: string) => {
    if (!promptLibraryModal) {
      return;
    }
    promptLibraryModal.applyValue(text);
    closePromptLibraryModal();
  }, [closePromptLibraryModal, promptLibraryModal]);

  const savePromptToCustomLibrary = useCallback((storageKey: string, text: string) => {
    const normalizedText = text.trim();
    if (!storageKey.trim() || !normalizedText) {
      return;
    }
    addPromptLibraryEntry(storageKey, 'custom', normalizedText);
    setPromptLibraryVersion((value) => value + 1);
    setRecentlySavedPromptKey(storageKey);
  }, []);

  const deletePromptLibraryEntry = useCallback((text: string) => {
    if (!promptLibraryModal) {
      return;
    }
    removePromptLibraryEntry(promptLibraryModal.storageKey, promptLibraryModal.kind, text);
    setPromptLibraryVersion((value) => value + 1);
  }, [promptLibraryModal]);

  const recordPromptHistory = useCallback((items: Array<{ storageKey: string; text: string }>) => {
    const payload = items
      .map(({ storageKey, text }) => ({ key: storageKey.trim(), text: text.trim() }))
      .filter(({ key, text }) => key !== '' && text !== '');

    if (payload.length === 0) {
      return;
    }

    addPromptHistoryEntries(payload);
    setPromptLibraryVersion((value) => value + 1);
  }, []);

  const collectTemplatePromptHistory = useCallback((
    fields: ParamSchemaField[],
    values: Record<string, unknown>
  ): Array<{ storageKey: string; text: string }> => (
    fields
      .filter((field) => field.type === 'text' && isPromptTemplateField(field))
      .map((field) => {
        const fieldKey = getTemplateFieldStateKey(field);
        return {
          storageKey: buildTemplatePromptLibraryKey(field),
          text: String(values[fieldKey] ?? renderParamDefault(field) ?? ''),
        };
      })
  ), [buildTemplatePromptLibraryKey]);

  useEffect(() => {
    if (!recentlySavedPromptKey) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setRecentlySavedPromptKey((current) => (current === recentlySavedPromptKey ? null : current));
    }, 1600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [recentlySavedPromptKey]);

  useEffect(() => {
    if (!promptLibraryModal) {
      return undefined;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePromptLibraryModal();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closePromptLibraryModal, promptLibraryModal]);

  useEffect(() => {
    if (!isTemplatePickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!templatePickerRef.current?.contains(event.target as Node)) {
        setIsTemplatePickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTemplatePickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isTemplatePickerOpen]);

  // Fetch workflows on mount
  useEffect(() => {
    if (comfyUISettings.isConnected) {
      fetchWorkflows();
    }
  }, [comfyUISettings.isConnected]);

  useEffect(() => {
    latestInputValuesRef.current = inputValues;
  }, [inputValues]);

  useEffect(() => {
    templateParamsRef.current = templateParams;
  }, [templateParams]);

  useEffect(() => {
    templateImageInputsRef.current = templateImageInputs;
  }, [templateImageInputs]);

  useEffect(() => {
    templateUploadedImagePreviewsRef.current = templateUploadedImagePreviews;
  }, [templateUploadedImagePreviews]);

  // Keep refs in sync for unmount cleanup
  useEffect(() => {
    if (selectedWorkflow) {
      currentWorkflowKeyRef.current = selectedWorkflow.path || selectedWorkflow.name;
    } else {
      currentWorkflowKeyRef.current = null;
    }
  }, [selectedWorkflow]);

  useEffect(() => {
    uploadedImagePreviewsRef.current = uploadedImagePreviews;
  }, [uploadedImagePreviews]);

  // Restore image previews from ref on mount (handles React StrictMode remount)
  useEffect(() => {
    // If ref has previews but state is empty (e.g., after StrictMode remount), restore them
    const refPreviews = uploadedImagePreviewsRef.current;
    if (Object.keys(refPreviews).length > 0 && Object.keys(uploadedImagePreviews).length === 0) {
      console.log('[Draw] Restoring image previews from ref:', Object.keys(refPreviews));
      setUploadedImagePreviews(refPreviews);
    }
  }, []); // Only run on mount

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Save workflow cache and cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      // Save current workflow cache
      if (currentWorkflowKeyRef.current) {
        const { saveCache } = useWorkflowCacheStore.getState();
        console.log('[Draw] Saving cache on unmount for:', currentWorkflowKeyRef.current);

        // Extract image filenames from inputValues (only for image inputs that have base64 data)
        const imageFilenames: Record<string, string> = {};
        for (const inputName of Object.keys(uploadedImageBase64Ref.current)) {
          const value = latestInputValuesRef.current[inputName];
          if (typeof value === 'string') {
            imageFilenames[inputName] = value;
          }
        }

        saveCache(currentWorkflowKeyRef.current, {
          inputValues: latestInputValuesRef.current,
          imageData: uploadedImageBase64Ref.current,
          imageFilenames,
        });
      }

      // NOTE: We intentionally do NOT cleanup blob URLs on unmount because:
      // 1. React StrictMode triggers unmount/remount cycle in development
      // 2. We restore previews from ref on remount (see useEffect above)
      // 3. Blob URLs are cleaned up when switching workflows or explicitly removing images
      // This prevents the preview from disappearing due to StrictMode's double-render behavior
    };
  }, []);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Sync baseUrl from settings to ComfyUI store
  useEffect(() => {
    if (comfyUISettings.baseUrl) {
      setComfyUIBaseUrl(comfyUISettings.baseUrl);
    }
  }, [comfyUISettings.baseUrl, setComfyUIBaseUrl]);

  // Cluster Mode: Load templates when connectionMode is 'cluster' and connected
  // Per D-04: Switching modes reloads from new source
  // Per D-15: Block until connected
  // Per D-05: Strictly separated, no mixing
  useEffect(() => {
    if (connectionMode !== 'cluster') {
      setClusterTemplates([]);
      setSelectedTemplate(null);
      selectedTemplateRef.current = null;
      setTemplateParams({});
      setTemplateImageInputs({});
      return;
    }
    if (!isLemonGridConnected || !lemonGridServerUrl) return;

    let cancelled = false;
    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
        const templates = await client.listTemplates({ status_filter: 'ACTIVE', page_size: 100 });
        if (!cancelled) {
          setClusterTemplates(templates);
        }
      } catch (error) {
        console.error('[Draw] Failed to load LemonGrid templates:', error);
        if (!cancelled) {
          setClusterTemplates([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTemplates(false);
        }
      }
    };
    loadTemplates();
    return () => { cancelled = true; };
  }, [connectionMode, isLemonGridConnected, lemonGridServerUrl]);

  // Per D-22, D-23, D-37, D-38: WebSocket progress through Bridge + auto-fallback to polling
  useEffect(() => {
    if (connectionMode !== 'cluster') return;

    const handleWsMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'lemongrid.ws.message' && data.taskId && data.data) {
        const { taskId, data: wsData } = data as { taskId: string; data: { type: string; progress?: number; detail?: string; duration_seconds?: number; error_code?: string; error_message?: string } };
        const store = useLemonGridStore.getState();
        const currentTask = store.tasks[taskId];

        switch (wsData.type) {
          case 'task_started':
            void syncClusterTaskStatusFromServer(taskId).catch(() => {});
            break;
          case 'task_progress':
            if (currentTask?.status === 'RUNNING' && !currentTask.statusLocked) {
              store.updateTask(taskId, {
                progress: wsData.progress ?? currentTask.progress,
                progressDetail: wsData.detail ?? currentTask.progressDetail,
              });
            } else {
              void syncClusterTaskStatusFromServer(taskId).catch(() => {});
            }
            break;
          case 'task_completed':
            void syncClusterTaskStatusFromServer(taskId, { confirmCompletion: true }).catch(() => {});
            break;
          case 'task_failed':
            void syncClusterTaskStatusFromServer(taskId, { confirmCompletion: true }).catch(() => {});
            break;
        }
      }

      if ((data as { type?: string }).type === 'lemongrid.ws.close') {
        // Per D-38: WS dropped, auto-fallback to polling
        const closeData = data as { taskId: string; code?: number; reason?: string };
        console.warn('[Draw] LemonGrid WS closed for task:', closeData.taskId);
        startPollingForTask(closeData.taskId);
      }
    };

    window.addEventListener('message', handleWsMessage);
    return () => window.removeEventListener('message', handleWsMessage);
  }, [connectionMode]);

  // Per D-24: Cleanup WS connections on unmount
  useEffect(() => {
    return () => {
      Object.keys(wsConnectionRefs.current).forEach((taskId) => {
        closeTaskWebSocket(taskId);
      });
    };
  }, []);

  // Fetch queue on mount and when connection status changes
  useEffect(() => {
    console.log('[Queue] Connection status:', comfyUISettings.isConnected, 'baseUrl:', comfyUISettings.baseUrl);
    if (comfyUISettings.isConnected) {
      console.log('[Queue] Fetching queue...');
      fetchQueue()
        .then((queue) => console.log('[Queue] Result:', queue))
        .catch((err) => console.error('[Queue] Error:', err));
    }
  }, [comfyUISettings.isConnected, fetchQueue]);

  // Cluster Mode: Poll platform queue summary every 15 seconds
  useEffect(() => {
    if (connectionMode !== 'cluster' || !isLemonGridConnected || !lemonGridServerUrl) return;

    const fetchQueueSummary = async () => {
      try {
        const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
        const summary = await client.getQueueSummary();
        useLemonGridStore.getState().setQueueSummary(summary);
      } catch (e) {
        console.warn('[Draw] Queue summary fetch failed:', e);
      }
    };

    fetchQueueSummary();
    const interval = setInterval(fetchQueueSummary, 15000);
    return () => clearInterval(interval);
  }, [connectionMode, isLemonGridConnected, lemonGridServerUrl]);

  // Refresh queue periodically during generation
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      fetchQueue().catch(console.error);
    }, 1000);
    return () => clearInterval(interval);
  }, [isGenerating, fetchQueue]);

  // Check image reference validity on ComfyUI — REMOVED (was preset-only)

  // Apply preset values to Draw state — REMOVED (preset feature deleted)






  // Handle rerun/edit from history
  useEffect(() => {
    // With keep-alive routing (App.tsx KeepAlivePages), Draw no longer remounts on tab switch.
    // Reset the handled flag whenever a fresh history action arrives so re-clicks from
    // the History page actually trigger another rerun/edit.
    const hasFreshAction = Boolean(
      (location.state as HistoryActionState | null)?.rerunItem ||
      (location.state as HistoryActionState | null)?.editItem ||
      sessionStorage.getItem('rerunItem') ||
      sessionStorage.getItem('editItem')
    );
    if (hasFreshAction && hasHandledHistoryAction.current) {
      hasHandledHistoryAction.current = false;
    }

    console.log('[Draw] History useEffect triggered:', {
      hasHandledHistoryAction: hasHandledHistoryAction.current,
      workflowsLength: workflows.length,
      clusterTemplatesLength: clusterTemplates.length,
      hasBaseUrl: !!comfyUISettings.baseUrl,
      connectionMode,
      locationState: location.state,
      sessionStorageRerun: sessionStorage.getItem('rerunItem') ? 'present' : 'empty',
      sessionStorageEdit: sessionStorage.getItem('editItem') ? 'present' : 'empty'
    });

    const state = location.state as HistoryActionState | null;
    const storedRerun = (() => {
      try {
        const raw = sessionStorage.getItem('rerunItem');
        return raw ? (JSON.parse(raw) as HistoryActionState['rerunItem']) : undefined;
      } catch {
        return undefined;
      }
    })();
    const storedEdit = (() => {
      try {
        const raw = sessionStorage.getItem('editItem');
        return raw ? (JSON.parse(raw) as HistoryActionState['editItem']) : undefined;
      } catch {
        return undefined;
      }
    })();

    const historyItem = state?.rerunItem || state?.editItem || storedRerun || storedEdit;
    if (!historyItem) return;

    const historySource = historyItem.source ?? connectionMode;
    const isClusterHistoryAction = historySource === 'cluster';
    const historyReady = isClusterHistoryAction
      ? isLemonGridConnected && !!lemonGridServerUrl && clusterTemplates.length > 0
      : workflows.length > 0 && !!comfyUISettings.baseUrl;

    if (hasHandledHistoryAction.current || !historyReady) {
      console.log('[Draw] History useEffect SKIPPED:', {
        reason: hasHandledHistoryAction.current
          ? 'already_handled'
          : isClusterHistoryAction
            ? (!isLemonGridConnected || !lemonGridServerUrl ? 'cluster_not_connected' : 'no_templates')
            : (workflows.length === 0 ? 'no_workflows' : 'no_baseUrl'),
        historySource,
      });
      return;
    }

    hasHandledHistoryAction.current = true;
    const shouldAutoGenerate = Boolean(state?.rerunItem || storedRerun);

    const applyHistoryAction = async () => {
      try {
        console.log('[Draw] ========== HISTORY ACTION START ==========');
        console.log('[Draw] History action triggered:', {
          source: historySource,
          workflow: historyItem.workflow,
          workflowName: historyItem.workflowName,
          imageName: historyItem.imageName,
          paramsKeys: historyItem.params ? Object.keys(historyItem.params) : 'undefined',
          shouldAutoGenerate
        });
        if (isClusterHistoryAction) {
          const historyTemplateId = historyItem.templateId || historyItem.workflow;
          // #region debug-point A:cluster-history-input
          void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'A', location: 'Draw.tsx:1145', msg: '[DEBUG] cluster history action payload', data: { historyTemplateId, workflowName: historyItem.workflowName, paramKeys: historyItem.params ? Object.keys(historyItem.params) : [], imageLikeEntries: Object.entries(historyItem.params || {}).filter(([key]) => /(?:^|\.)(?:image|upload)$/i.test(key)).map(([key, value]) => ({ key, valueType: Array.isArray(value) ? 'array' : typeof value, hasAssetId: Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'asset_id' in (value as Record<string, unknown>)), value })) }, ts: Date.now() }) }).catch(() => {});
          // #endregion
          const matchedTemplate = (historyTemplateId
            ? clusterTemplates.find((template) => template.id === historyTemplateId)
            : undefined) ?? clusterTemplates.find((template) => template.name === historyItem.workflowName);

          if (!matchedTemplate) {
            console.warn('[Draw] No cluster template available for history action:', {
              templateId: historyTemplateId,
              workflowName: historyItem.workflowName,
            });
            return;
          }

          const matchedGroup = groupedClusterWorkflowTemplates.find((group) =>
            group.variants.some((variant) => variant.template.id === matchedTemplate.id)
          );
          const detail = buildTemplateDetail(matchedTemplate);
          applyClusterHistoryTemplate(detail, historyItem.params, matchedGroup?.key ?? null);
          console.log('[Draw] Restored cluster history action with template:', matchedTemplate.id);
        } else {
          const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
          const prefixMode: 'api' | 'oss' = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
          console.log('[Draw] Current workflows available:', workflows.length, workflows.map(w => w.name));
          const targetWorkflow = await findBestMatchingWorkflow(historyItem.params, historyItem.workflowName, workflows, client, prefixMode);
          console.log('[Draw] ========== MATCHING RESULT ==========');
          console.log('[Draw] Found target workflow:', targetWorkflow?.name);
          console.log('[Draw] Expected workflow was:', historyItem.workflowName);
          if (!targetWorkflow) {
            console.warn('[Draw] No workflow available for history action');
            return;
          }

          const loadedInputs = await handleWorkflowSelect(targetWorkflow);
          console.log('[Draw] Loaded inputs:', loadedInputs.map(i => ({ name: i.name, type: i.type, classType: i.classType })));

          if (historyItem.params) {
            pendingRerunPromptRef.current = historyItem.params;
            const restored = extractInputValuesFromHistoryParams(historyItem.params, loadedInputs);
            console.log('[Draw] Restored values from history:', restored);
            if (Object.keys(restored).length > 0) {
              setInputValues((prev) => {
                const next = { ...prev, ...restored };
                latestInputValuesRef.current = next;
                return next;
              });

              // Restore image previews for image inputs
              const imageInputs = loadedInputs.filter(i => i.type === 'image');
              const previewClient = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
              const newPreviews: Record<string, string> = {};
              for (const imgInput of imageInputs) {
                const filename = restored[imgInput.name];
                if (typeof filename === 'string' && filename.trim() !== '') {
                  const previewUrl = previewClient.getViewUrl({
                    filename,
                    type: 'input',
                    subfolder: '',
                    preview: true,
                  });
                  newPreviews[imgInput.name] = previewUrl;
                  console.log('[Draw] Restored image preview for', imgInput.name, ':', previewUrl);
                }
              }
              if (Object.keys(newPreviews).length > 0) {
                setUploadedImagePreviews(prev => ({ ...prev, ...newPreviews }));
              }
            }
          }
        }

        if (shouldAutoGenerate) {
          console.log('[Draw] Scheduling handleGenerate in 300ms...');
          setTimeout(() => {
            console.log('[Draw] Triggering handleGenerate, selectedWorkflow:', selectedWorkflow?.name);
            handleGenerate();
          }, 300);
        }
      } finally {
        window.history.replaceState({}, document.title);
        sessionStorage.removeItem('rerunItem');
        sessionStorage.removeItem('editItem');
      }
    };

    applyHistoryAction();
  }, [
    clusterTemplates,
    comfyUISettings.baseUrl,
    comfyUISettings.prefixMode,
    connectionMode,
    groupedClusterWorkflowTemplates,
    isLemonGridConnected,
    lemonGridServerUrl,
    location.state,
    workflows,
  ]);
  const fetchWorkflows = async () => {
    if (!comfyUISettings.isConnected) return;

    setIsLoadingWorkflows(true);
    setWorkflowError(null);

    try {
      const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
      const prefixMode = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
      const workflowList = await client.listWorkflows(prefixMode);
      setWorkflows(workflowList);

      let loadedObjectInfo: Record<string, unknown> | null = objectInfo;

      if (!objectInfo) {
        try {
          const info = await client.getObjectInfo(prefixMode);
          if (info && typeof info === 'object') {
            loadedObjectInfo = info as Record<string, unknown>;
            setObjectInfo(loadedObjectInfo);
          }
        } catch (error) {
          console.warn('[Draw] 获取 object_info 失败:', error);
        }
      }

      if (Object.keys(experimentModels).length === 0) {
        try {
          const modelCatalog = await client.getExperimentModels();
          if (modelCatalog && typeof modelCatalog === 'object') {
            setExperimentModels(modelCatalog);
          }
        } catch (error) {
          console.warn('[Draw] 获取实验模型列表失败:', error);
        }
      }
      
      // Don't select default workflow if we're handling a history action (rerun/edit)
      // The history action will set the correct workflow
      // Check both the ref and sessionStorage (more reliable for timing)
      const hasPendingHistoryAction = hasHandledHistoryAction.current ||
        sessionStorage.getItem('rerunItem') ||
        sessionStorage.getItem('editItem');

      if (!selectedWorkflow && !hasPendingHistoryAction) {
        const defaultWorkflowGroup = getDefaultGroupedWorkflow(workflowList);
        const defaultWorkflow = defaultWorkflowGroup?.representative ?? getDefaultWorkflow(workflowList);
        if (defaultWorkflow) {
          handleWorkflowSelect(defaultWorkflow, loadedObjectInfo, Object.keys(experimentModels).length > 0 ? experimentModels : undefined);
        }
      } else if (hasPendingHistoryAction) {
        console.log('[Draw] Skipping default workflow selection - history action pending');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workflows';
      setWorkflowError(`加载工作流列表失败: ${message} (baseUrl=${comfyUISettings.baseUrl})`);
    } finally {
      setIsLoadingWorkflows(false);
    }
  };

  const handleWorkflowSelect = async (
    workflow: ComfyUIWorkflowInfo,
    objectInfoOverride?: Record<string, unknown> | null,
    modelCatalogOverride?: ExperimentModelCatalog
  ): Promise<WorkflowInput[]> => {
    console.log('[Draw] handleWorkflowSelect called for:', workflow.name);
    const carriedWorkflowImageEntries = extractOrderedWorkflowImageEntries(
      workflowImageInputs,
      latestInputValuesRef.current,
      uploadedImagePreviewsRef.current,
      uploadedImageBase64Ref.current
    );

    // Save current workflow cache before switching
    const { saveCache, loadCache } = useWorkflowCacheStore.getState();
    if (selectedWorkflow) {
      const currentWorkflowKey = selectedWorkflow.path || selectedWorkflow.name;
      console.log('[Draw] Saving cache for current workflow:', currentWorkflowKey);

      // Extract image filenames from inputValues (only for image inputs that have base64 data)
      const imageFilenames: Record<string, string> = {};
      for (const inputName of Object.keys(uploadedImageBase64Ref.current)) {
        const value = latestInputValuesRef.current[inputName];
        if (typeof value === 'string') {
          imageFilenames[inputName] = value;
        }
      }

      const imageDataToSave = { ...uploadedImageBase64Ref.current };
      console.log('[Draw] Saving cache with', Object.keys(imageDataToSave).length, 'images, keys:', Object.keys(imageDataToSave));
      console.log('[Draw] inputValues:', JSON.stringify(latestInputValuesRef.current).substring(0, 200));
      saveCache(currentWorkflowKey, {
        inputValues: { ...latestInputValuesRef.current },
        imageData: imageDataToSave,
        imageFilenames,
      });
    }

    setSelectedWorkflow(workflow);
    selectedWorkflowRef.current = workflow;
    setWorkflowInputs([]);

    // 跨工作流切换：先从当前 inputValues 中收集提示词字段值（按正/反向分组），稍后在新工作流中复用
    // 注意：源码为空字符串时也要同步清空 ref，避免"用户清空"的动作不生效
    const syncWorkflowPromptCarry = (scope: 'positive' | 'negative', value: unknown) => {
      const text = typeof value === 'string' && value !== '' ? value : '';
      if (scope === 'positive') {
        carriedPositivePromptRef.current = text;
      } else {
        carriedNegativePromptRef.current = text;
      }
    };
    workflowInputs.forEach((input) => {
      if (input.type !== 'text' || !isPromptWorkflowField(input)) return;
      syncWorkflowPromptCarry(getPromptLibraryScope(input), latestInputValuesRef.current[input.name]);
    });

    // 同时从云端模板的当前 state 中收集提示词：用于 cloud → comfyui 跨模式携带
    const carriedCloudTemplate = selectedTemplateRef.current;
    if (carriedCloudTemplate) {
      const cloudParams = templateParamsRef.current;
      carriedCloudTemplate.param_schema.forEach((field) => {
        if (field.type !== 'text' || !isPromptTemplateField(field)) return;
        syncWorkflowPromptCarry(getPromptLibraryScope(field), cloudParams[getTemplateFieldStateKey(field)]);
      });
    }

    setInputValues({});
    latestInputValuesRef.current = {};

    if (!comfyUISettings.isConnected) {
      console.log('[Draw] Not connected to ComfyUI, returning empty inputs');
      return [];
    }

    try {
      const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
      const prefixMode = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
      setWorkflowError(null);

      let workflowData: unknown;
      try {
        workflowData = await client.readWorkflow(workflow.path || workflow.name, prefixMode);
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr);
        setWorkflowError(`读取工作流失败: ${msg}`);
        return [];
      }

      if (!workflowData || typeof workflowData !== 'object') {
        setWorkflowError(`工作流数据无效 (type=${typeof workflowData})`);
        return [];
      }
      const hasNodes = !!((workflowData as Record<string, unknown>).nodes);
      if (!hasNodes) {
        const keys = Object.keys(workflowData as Record<string, unknown>).join(',');
        setWorkflowError(`工作流返回数据缺少 nodes 字段, keys=${keys}`);
        return [];
      }

      // Try fetching objectInfo if not yet available (needed for COMBO option lists)
      let effectiveObjectInfo = objectInfoOverride ?? objectInfo;
      if (!effectiveObjectInfo) {
        try {
          const info = await client.getObjectInfo(prefixMode);
          if (info && typeof info === 'object') {
            effectiveObjectInfo = info as Record<string, unknown>;
            setObjectInfo(effectiveObjectInfo);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setWorkflowError(`获取 object_info 失败: ${msg}`);
          return [];
        }
      }

      // Parse workflow inputs
      const inputs = parseAndEnrichWorkflowInputs(
        workflowData,
        effectiveObjectInfo,
        modelCatalogOverride ?? experimentModels
      );

      setWorkflowInputs(inputs);

      // Try to load from cache first
      const workflowKey = workflow.path || workflow.name;
      const cached = loadCache(workflowKey);
      const targetOrderedImageInputs = sortWorkflowImageInputsByOrder(inputs.filter((input) => input.type === 'image'));
      const appliedCarriedImages = applyWorkflowImageEntriesToInputs(targetOrderedImageInputs, carriedWorkflowImageEntries);

      const retainedPreviewUrls = new Set(
        Object.values(appliedCarriedImages.previews).filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      );
      Object.values(uploadedImagePreviewsRef.current).forEach((url: string | string[]) => {
        const urls = Array.isArray(url) ? url : [url];
        urls.forEach((previewUrl) => {
          if (previewUrl.startsWith('blob:') && !retainedPreviewUrls.has(previewUrl)) {
            URL.revokeObjectURL(previewUrl);
          }
        });
      });

      uploadedImageBlobsRef.current = {};
      uploadedImageBase64Ref.current = {};
      uploadedImagePreviewsRef.current = {};

      let nextInputValues: Record<string, string | number | boolean> = {};
      let nextPreviews: Record<string, string> = {};
      let nextBase64: Record<string, string> = {};

      if (cached) {
        console.log('[Draw] Restoring from cache for:', workflowKey);
        console.log('[Draw] Cached imageData keys:', Object.keys(cached.imageData));

        // Restore input values
        const restoredValues: Record<string, string | number | boolean> = {};
        inputs.forEach(input => {
          if (input.type === 'image' && carriedWorkflowImageEntries.length > 0) {
            if (input.default !== undefined) {
              restoredValues[input.name] = input.default;
            }
            return;
          }
          if (cached.inputValues[input.name] !== undefined) {
            restoredValues[input.name] = cached.inputValues[input.name];
          } else if (input.default !== undefined) {
            restoredValues[input.name] = input.default;
          }
        });
        nextInputValues = restoredValues;

        // Restore image previews from base64 data
        const restoredPreviews: Record<string, string> = {};
        for (const [inputName, base64] of Object.entries(cached.imageData)) {
          if (carriedWorkflowImageEntries.length > 0 && targetOrderedImageInputs.some((input) => input.name === inputName)) {
            continue;
          }
          console.log('[Draw] Restoring image for input:', inputName, 'base64 length:', base64.length);
          const blobUrl = base64ToBlobUrl(base64);
          if (blobUrl) {
            restoredPreviews[inputName] = blobUrl;
            nextBase64[inputName] = base64;
            console.log('[Draw] Created blob URL:', blobUrl);
          } else {
            console.warn('[Draw] Failed to create blob URL for:', inputName);
          }
        }
        console.log('[Draw] Restored previews:', Object.keys(restoredPreviews));
        nextPreviews = restoredPreviews;
      } else {
        // Set default values if no cache
        const defaults: Record<string, string | number | boolean> = {};
        inputs.forEach(input => {
          if (input.default !== undefined) {
            defaults[input.name] = input.default;
          }
        });
        nextInputValues = defaults;
      }

      if (Object.keys(appliedCarriedImages.values).length > 0) {
        nextInputValues = {
          ...nextInputValues,
          ...appliedCarriedImages.values,
        };
        nextPreviews = {
          ...nextPreviews,
          ...appliedCarriedImages.previews,
        };
        nextBase64 = {
          ...nextBase64,
          ...appliedCarriedImages.base64,
        };
      }

      // 跨工作流携带的提示词：缓存命中时仍使用缓存，未命中时用携带值覆盖默认值
      inputs.forEach((input) => {
        if (input.type !== 'text' || !isPromptWorkflowField(input)) return;
        if (cached?.inputValues[input.name] !== undefined) return; // 缓存优先
        const scope = getPromptLibraryScope(input);
        const carried = scope === 'positive'
          ? carriedPositivePromptRef.current
          : carriedNegativePromptRef.current;
        if (carried) {
          nextInputValues[input.name] = carried;
        }
      });

      setInputValues(nextInputValues);
      latestInputValuesRef.current = nextInputValues;
      setUploadedImagePreviews(nextPreviews);
      uploadedImagePreviewsRef.current = nextPreviews;
      uploadedImageBase64Ref.current = nextBase64;

      return inputs;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setWorkflowError(`加载工作流详情失败: ${msg}`);
      return [];
    }
  };


  const handleInputChange = (name: string, value: string | number | boolean) => {
    pendingRerunPromptRef.current = null;
    setInputValues(prev => {
      const next = { ...prev, [name]: value };
      latestInputValuesRef.current = next;
      return next;
    });
  };

  // Must be defined before handleFillPrompt which depends on it
  const getInputNodeOrder = (input: WorkflowInput): number => {
    const directNodeId = input.nodeId;
    if (typeof directNodeId === 'string' && directNodeId.trim() !== '' && !Number.isNaN(Number(directNodeId))) {
      return Number(directNodeId);
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

  const sortedWorkflowInputs = useMemo(() => {
    return [...workflowInputs].sort((a, b) => {
      const nodeDiff = getInputNodeOrder(a) - getInputNodeOrder(b);
      if (nodeDiff !== 0) {
        return nodeDiff;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [workflowInputs]);

  const collectWorkflowPromptHistory = useCallback((
    values: Record<string, string | number | boolean>
  ): Array<{ storageKey: string; text: string }> => (
    sortedWorkflowInputs
      .filter((input) => input.type === 'text' && isPromptWorkflowField(input))
      .map((input) => ({
        storageKey: buildWorkflowPromptLibraryKey(input),
        text: String(values[input.name] ?? input.default ?? ''),
      }))
  ), [buildWorkflowPromptLibraryKey, sortedWorkflowInputs]);

  const workflowImageInputs = useMemo(
    () => workflowInputs.filter((input) => input.type === 'image'),
    [workflowInputs]
  );

  const workflowImageInputNames = useMemo(
    () => new Set(workflowImageInputs.map((input) => input.name)),
    [workflowImageInputs]
  );

  const filledWorkflowImageCount = useMemo(
    () =>
      workflowImageInputs.filter((input) => {
        const value = inputValues[input.name];
        return typeof value === 'string' && value.trim() !== '';
      }).length,
    [workflowImageInputs, inputValues]
  );

  const handleFillPrompt = useCallback((text: string) => {
    const firstTextInput = sortedWorkflowInputs.find((input) => input.type === 'text' && isPromptWorkflowField(input))
      ?? sortedWorkflowInputs.find((input) => input.type === 'text');
    if (firstTextInput) {
      handleInputChange(firstTextInput.name, text);
    }
  }, [sortedWorkflowInputs]);


  const fetchOutputImage = async (filename: string, subfolder: string, type: string, prefix: string): Promise<OutputImageData> => {
    const url = `${comfyUISettings.baseUrl}${prefix}/view?filename=${encodeURIComponent(filename)}&type=${encodeURIComponent(type)}&subfolder=${encodeURIComponent(subfolder || '')}`;
    const fetcher = isUXPWebView() ? (u: string) => bridgeFetch(u, {}, 30000) : (u: string) => fetch.call(window, u);
    const response = await fetcher(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return {
      previewUrl: URL.createObjectURL(blob),
      blob,
      filename,
    };
  };

  const updateOutputImages = async (images: OutputImageData[]) => {
    if (images.length === 0) return;
    setOutputImages(images);
    setActiveOutputIndex(0);

    const firstOutput = images[0];
    if (firstOutput) {
      setLatestGeneratedImageBlob(firstOutput.blob);
    }

    if (isUXPWebView()) {
      let syncedCount = 0;
      const syncErrors: string[] = [];
      setProgress(prev => ({
        ...prev,
        currentNode: `同步到 Photoshop（0/${images.length}）...`,
      }));
      for (let index = 0; index < images.length; index += 1) {
        try {
          await syncGeneratedImageToPs(images[index].blob, images[index].filename);
          syncedCount += 1;
        } catch (error) {
          console.error(`[Draw] 同步第 ${index + 1} 张图片到 Photoshop 失败:`, error);
          syncErrors.push(String(index + 1));
        }
        setProgress(prev => ({
          ...prev,
          currentNode: `同步到 Photoshop（${index + 1}/${images.length}）...`,
        }));
      }

      const syncSummary = syncErrors.length > 0
        ? `完成（${syncedCount}/${images.length} 张已同步，失败: ${syncErrors.join(', ')}）`
        : `完成并已同步到 Photoshop（${images.length} 张）`;

      setProgress(prev => ({
        ...prev,
        previewImage: firstOutput?.previewUrl || prev.previewImage,
        status: 'completed',
        percentage: 100,
        currentNode: syncSummary,
      }));
      return;
    }

    setProgress(prev => ({
      ...prev,
      previewImage: firstOutput?.previewUrl || prev.previewImage,
      status: 'completed',
      percentage: 100,
      currentNode: '完成',
    }));
  };

  const extractImagesFromHistory = (entry: ComfyUIHistoryEntry): Array<{ filename: string; subfolder: string; type: string }> => {
    const images: Array<{ filename: string; subfolder: string; type: string }> = [];
    const outputs = entry.outputs || {};
    Object.values(outputs).forEach((output) => {
      const outputImages = output?.images;
      if (!Array.isArray(outputImages)) return;
      outputImages.forEach((image) => {
        if (!image?.filename) return;
        images.push({
          filename: String(image.filename),
          subfolder: String(image.subfolder || ''),
          type: String(image.type || 'output'),
        });
      });
    });
    return images;
  };

  const pollForHistoryCompletion = async (
    client: ComfyUIClient,
    promptId: string,
    prefixMode: 'api' | 'oss',
    prefix: string
  ) => {
    const startedAt = Date.now();
    const timeoutMs = 2 * 60 * 1000;
    const intervalMs = 1200;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const historyEntry = await client.getHistoryDetail(promptId, prefixMode);
        const images = extractImagesFromHistory(historyEntry);
        if (images.length > 0) {
          setProgress((prev) => ({
            ...prev,
            currentNode: '获取输出图像...',
          }));
          const outputImages = await Promise.all(
            images.map((image) =>
              fetchOutputImage(image.filename, image.subfolder, image.type, prefix)
            )
          );

          await updateOutputImages(outputImages);
          return;
        }
      } catch (error) {
        console.warn('[Draw] 轮询历史记录失败:', error);
      }

      const elapsed = Date.now() - startedAt;
      const percentage = Math.min(95, Math.round((elapsed / timeoutMs) * 100));
      setProgress((prev) => ({
        ...prev,
        percentage,
        currentNode: '生成中（轮询）...',
      }));

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error('轮询生成结果超时');
  };

  const getFirstImageInputName = () => {
    const imageInput = workflowInputs.find((input) => input.type === 'image');
    return imageInput?.name;
  };

  const uploadImageFileToInput = async (file: File, inputName: string, previewSource?: Blob) => {
    if (!comfyUISettings.isConnected) {
      throw new Error('请先在设置页面连接 ComfyUI');
    }

    if (workflowImageInputs.length === 0) {
      throw new Error('当前工作流没有可用的图片输入节点（LoadImage）');
    }

    if (!workflowImageInputNames.has(inputName)) {
      throw new Error(`图片输入槽位无效，当前工作流最多支持 ${workflowImageInputs.length} 张参考图`);
    }

    const previewBlob = previewSource ?? file;
    const previewUrl = URL.createObjectURL(previewBlob);
    setUploadedImagePreviews((prev) => ({
      ...prev,
      [inputName]: previewUrl
    }));

    // Store blob and convert to base64 for caching
    uploadedImageBlobsRef.current[inputName] = previewBlob;
    try {
      const base64 = await blobToBase64(previewBlob);
      uploadedImageBase64Ref.current[inputName] = base64;
      console.log('[Draw] Saved base64 for input:', inputName, 'size:', base64.length);
    } catch (error) {
      console.warn('[Draw] Failed to convert image to base64:', error);
    }

    try {
      const uploadPrefixMode = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
      const uploadedName = await uploadToComfyUI(file, comfyUISettings.baseUrl, uploadPrefixMode);
      pendingRerunPromptRef.current = null;
      const nextInputValues = {
        ...latestInputValuesRef.current,
        [inputName]: uploadedName
      };
      latestInputValuesRef.current = nextInputValues;
      setInputValues(nextInputValues);
      // #region debug-point A:direct-upload-success
      {
        const latestImageValues = Object.fromEntries(
          Object.entries(nextInputValues).filter(([key, value]) => key.startsWith('image_') && typeof value === 'string')
        );
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'direct-image-default',
            runId: 'pre',
            hypothesisId: 'A',
            location: 'Draw.tsx:1188',
            msg: '[DEBUG] direct image upload stored',
            data: {
              inputName,
              fileName: file.name,
              uploadedName,
              imageInputs: workflowImageInputs.map((input) => input.name),
              latestImageValues,
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      // Clear invalid image ref on successful upload
      setInvalidImageRefs(prev => {
        const next = new Set(prev);
        next.delete(inputName);
        return next;
      });
      return uploadedName;
    } catch (error) {
      console.error('[Draw] Image upload failed:', error instanceof Error ? error.message : error);
      setUploadedImagePreviews((prev) => {
        const next = { ...prev };
        delete next[inputName];
        return next;
      });
      // Clean up refs on error
      delete uploadedImageBlobsRef.current[inputName];
      delete uploadedImageBase64Ref.current[inputName];
      throw error;
    }
  };

  const handlePsExportToWorkflow = async (blob: Blob, targetInputName?: string) => {
    const imageInputName = targetInputName || getFirstImageInputName();
    if (!imageInputName) {
      throw new Error('当前工作流没有可用的图片输入节点（LoadImage）');
    }

    const file = new File([blob], `ps-export-${Date.now()}.png`, { type: 'image/png' });
    await uploadImageFileToInput(file, imageInputName, blob);
  };

  const buildTemplateDetail = useCallback((template: LemonGridTemplateSummary): LemonGridTemplateDetail => {
    const raw = template as unknown as Record<string, unknown>;
    const cloned = {
      ...raw,
      param_schema: JSON.parse(JSON.stringify(raw.param_schema ?? [])),
    };
    const detail = normalizeTemplateDetail(cloned as Record<string, unknown>);

    const oi = objectInfo as Record<string, unknown> | null;
    if (oi) {
      for (const field of detail.param_schema) {
        if (field.type === 'text' && !field.hidden) {
          const classType = field.source_class_type;
          const inputName = field.name;
          if (classType && oi[classType]) {
            const nodeInfo = oi[classType] as Record<string, unknown>;
            const nodeInput = nodeInfo.input as Record<string, unknown> | undefined;
            if (nodeInput) {
              const required = nodeInput.required as Record<string, unknown> | undefined;
              const optional = nodeInput.optional as Record<string, unknown> | undefined;
              const config = required?.[inputName] ?? optional?.[inputName];
              if (config && Array.isArray(config as unknown[]) && Array.isArray((config as unknown[])[0])) {
                const opts = (config as unknown[])[0] as unknown[];
                field.type = 'select';
                field.options = opts.map((v) => ({ label: String(v), value: v }));
              }
            }
          }
        }

        if (field.type === 'select' && (!field.options || field.options.length === 0)) {
          const classType = field.source_class_type;
          const inputName = field.name;
          if (classType && oi[classType]) {
            const nodeInfo = oi[classType] as Record<string, unknown>;
            const nodeInput = nodeInfo.input as Record<string, unknown> | undefined;
            if (nodeInput) {
              const required = nodeInput.required as Record<string, unknown> | undefined;
              const optional = nodeInput.optional as Record<string, unknown> | undefined;
              const config = required?.[inputName] ?? optional?.[inputName];
              if (config && Array.isArray(config as unknown[]) && Array.isArray((config as unknown[])[0])) {
                const opts = (config as unknown[])[0] as unknown[];
                field.options = opts.map((v) => ({ label: String(v), value: v }));
              }
            }
          }
        }
      }
    }

    return detail;
  }, [objectInfo]);

  const remapTemplateStateToDetail = useCallback((
    sourceDetail: LemonGridTemplateDetail,
    targetDetail: LemonGridTemplateDetail,
    sourceParams: Record<string, unknown>,
    sourceImageInputs: Record<string, string | string[]>,
    sourcePreviews: Record<string, string | string[]>
  ) => {
    const buildSlots = (detail: LemonGridTemplateDetail) => {
      const slots = new Map<string, ParamSchemaField[]>();
      detail.param_schema
        .filter((field) => !field.hidden)
        .forEach((field) => {
          const key = `${field.type}::${field.name}`;
          const existing = slots.get(key);
          if (existing) {
            existing.push(field);
          } else {
            slots.set(key, [field]);
          }
        });
      slots.forEach((fields, key) => {
        slots.set(
          key,
          [...fields].sort((a, b) => {
            const aNodeId = Number(a.node_id);
            const bNodeId = Number(b.node_id);
            if (Number.isFinite(aNodeId) && Number.isFinite(bNodeId) && aNodeId !== bNodeId) {
              return aNodeId - bNodeId;
            }
            return String(a.node_id).localeCompare(String(b.node_id), 'zh-CN');
          })
        );
      });
      return slots;
    };

    const targetParams: Record<string, unknown> = {};
    targetDetail.param_schema.forEach((field) => {
      targetParams[getTemplateFieldStateKey(field)] = renderParamDefault(field);
    });

    const targetImageInputs: Record<string, string | string[]> = {};
    const targetPreviews: Record<string, string | string[]> = {};
    const sourceSlots = buildSlots(sourceDetail);
    const targetSlots = buildSlots(targetDetail);

    targetSlots.forEach((targetFields, slotKey) => {
      if (targetFields[0]?.type === 'image') {
        return;
      }
      const sourceFields = sourceSlots.get(slotKey) ?? [];
      const orderedSourceFields = sourceFields;
      targetFields.forEach((targetField, index) => {
        const sourceField = orderedSourceFields[index] ?? orderedSourceFields[0];
        if (!sourceField) {
          return;
        }

        const sourceKey = getTemplateFieldStateKey(sourceField);
        const targetKey = getTemplateFieldStateKey(targetField);
        if (sourceParams[sourceKey] !== undefined) {
          targetParams[targetKey] = sourceParams[sourceKey];
        }
        if (sourceImageInputs[sourceKey] !== undefined) {
          targetImageInputs[targetKey] = sourceImageInputs[sourceKey];
        }
        if (sourcePreviews[sourceKey] !== undefined) {
          targetPreviews[targetKey] = sourcePreviews[sourceKey];
        }
      });
    });

    const carriedTemplateImages = extractOrderedTemplateImageEntries(
      sourceDetail,
      sourceParams,
      sourceImageInputs,
      sourcePreviews
    );
    const appliedTemplateImages = applyTemplateImageEntriesToDetail(
      targetDetail,
      carriedTemplateImages,
      targetParams,
      targetImageInputs,
      targetPreviews
    );

    return {
      targetParams: appliedTemplateImages.targetParams,
      targetImageInputs: appliedTemplateImages.targetImageInputs,
      targetPreviews: appliedTemplateImages.targetPreviews,
    };
  }, []);

  const applySelectedTemplateDetail = useCallback((
    detail: LemonGridTemplateDetail,
    templateGroupKey: string | null
  ) => {
    // 跨工作流切换：先从当前云端模板 + comfyui 工作流中收集提示词（按正/反向分组），稍后在 param_schema 中复用
    // 注意：源码为空字符串时也要同步清空 ref，避免"用户清空"的动作不生效
    const syncTemplatePromptCarry = (scope: 'positive' | 'negative', value: unknown) => {
      const text = typeof value === 'string' && value !== '' ? value : '';
      if (scope === 'positive') {
        carriedPositivePromptRef.current = text;
      } else {
        carriedNegativePromptRef.current = text;
      }
    };
    if (selectedTemplate) {
      const previousParams = templateParamsRef.current;
      selectedTemplate.param_schema.forEach((field) => {
        if (field.type !== 'text' || !isPromptTemplateField(field)) return;
        syncTemplatePromptCarry(getPromptLibraryScope(field), previousParams[getTemplateFieldStateKey(field)]);
      });
    }
    if (workflowInputs.length > 0) {
      const previousInputs = latestInputValuesRef.current;
      workflowInputs.forEach((input) => {
        if (input.type !== 'text' || !isPromptWorkflowField(input)) return;
        syncTemplatePromptCarry(getPromptLibraryScope(input), previousInputs[input.name]);
      });
    }

    const defaults: Record<string, unknown> = {};
    for (const field of detail.param_schema) {
      defaults[getTemplateFieldStateKey(field)] = renderParamDefault(field);
    }
    setTemplateParams(defaults);

    const imageInputs: Record<string, string> = {};
    for (const field of detail.param_schema) {
      if (!field.hidden && isImageParam(field)) {
        imageInputs[getTemplateFieldStateKey(field)] = '';
      }
    }

    let nextTemplateParams = defaults;
    let nextTemplateImageInputs: Record<string, string | string[]> = imageInputs;
    let nextTemplatePreviews: Record<string, string | string[]> = {};

    if (selectedTemplate) {
      const previousPreviews = templateUploadedImagePreviewsRef.current;
      const remapped = remapTemplateStateToDetail(
        selectedTemplate,
        detail,
        templateParamsRef.current,
        templateImageInputsRef.current,
        previousPreviews
      );

      nextTemplateParams = remapped.targetParams;
      nextTemplateImageInputs = {
        ...imageInputs,
        ...remapped.targetImageInputs,
      };
      nextTemplatePreviews = remapped.targetPreviews;

      const retainedPreviewUrls = new Set(
        Object.values(nextTemplatePreviews)
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .filter((value): value is string => typeof value === 'string')
      );

      Object.values(previousPreviews)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .forEach((url) => {
          if (typeof url === 'string' && url.startsWith('blob:') && !retainedPreviewUrls.has(url)) {
            URL.revokeObjectURL(url);
          }
        });
    }

    // 应用跨工作流携带的提示词：仅在当前值仍是默认值（未被 remap 覆盖）时填入，避免破坏 cloud→cloud 已有映射
    detail.param_schema.forEach((field) => {
      if (field.type !== 'text' || !isPromptTemplateField(field)) return;
      const fieldKey = getTemplateFieldStateKey(field);
      const defaultValue = renderParamDefault(field);
      if (nextTemplateParams[fieldKey] !== defaultValue) return;
      const scope = getPromptLibraryScope(field);
      const carried = scope === 'positive'
        ? carriedPositivePromptRef.current
        : carriedNegativePromptRef.current;
      if (carried) {
        nextTemplateParams[fieldKey] = carried;
      }
    });

    setTemplateParams(nextTemplateParams);
    templateParamsRef.current = nextTemplateParams;
    setTemplateImageInputs(nextTemplateImageInputs);
    templateImageInputsRef.current = nextTemplateImageInputs;
    setTemplateUploadedImagePreviews(nextTemplatePreviews);
    templateUploadedImagePreviewsRef.current = nextTemplatePreviews;
    setSelectedTemplateGroupKey(templateGroupKey);
    setSelectedTemplate(detail);
    selectedTemplateRef.current = detail;
    setIsTemplatePickerOpen(false);
    setUploadedImagePreviews({});
  }, [remapTemplateStateToDetail, selectedTemplate, workflowInputs]);

  // Cluster Mode: Handle template selection
  // Synchronous — same pattern as direct mode's handleWorkflowSelect.
  // Deep clone param_schema to prevent shared reference issues across templates.
  const handleTemplateSelect = useCallback((
    template: LemonGridTemplateSummary,
    templateGroupKey: string | null = null
  ) => {
    const detail = buildTemplateDetail(template);
    applySelectedTemplateDetail(detail, templateGroupKey);
  }, [applySelectedTemplateDetail, buildTemplateDetail]);

  const handleGroupedTemplateSelect = useCallback((group: GroupedClusterTemplateSummary) => {
    handleTemplateSelect(group.representative, group.key);
  }, [handleTemplateSelect]);

  const applyClusterHistoryTemplate = useCallback((
    detail: LemonGridTemplateDetail,
    historyParams: Record<string, unknown> | undefined,
    templateGroupKey: string | null
  ) => {
    const previousPreviews = templateUploadedImagePreviewsRef.current;
    const nextTemplateParams: Record<string, unknown> = {};
    const nextTemplateImageInputs: Record<string, string | string[]> = {};
    const nextTemplatePreviews: Record<string, string | string[]> = {};
    const client = lemonGridServerUrl
      ? new LemonGridClient({ serverUrl: lemonGridServerUrl })
      : null;

    for (const field of detail.param_schema) {
      const fieldKey = getTemplateFieldStateKey(field);
      nextTemplateParams[fieldKey] = renderParamDefault(field);
      if (!field.hidden && isImageParam(field)) {
        nextTemplateImageInputs[fieldKey] = '';
      }
    }

    if (historyParams) {
      for (const field of detail.param_schema) {
        const fieldKey = getTemplateFieldStateKey(field);
        const historyValue = historyParams[fieldKey];
        if (historyValue === undefined) {
          continue;
        }

        nextTemplateParams[fieldKey] = historyValue;
        if (!isImageParam(field)) {
          continue;
        }

        const normalizedValues = (Array.isArray(historyValue) ? historyValue : [historyValue])
          .map((value) => (typeof value === 'string' ? value.trim() : ''));
        const normalizedAssetValues = (Array.isArray(historyValue) ? historyValue : [historyValue])
          .map((value) => getTemplateAssetIdFromValue(value).trim());

        if (!normalizedValues.some(Boolean) && !normalizedAssetValues.some(Boolean)) {
          continue;
        }

        if (normalizedValues.some(Boolean)) {
          nextTemplateImageInputs[fieldKey] = Array.isArray(historyValue)
            ? normalizedValues
            : normalizedValues[0] ?? '';
        }

        const siblingImageFieldKey = getTemplateFieldStateKey({ node_id: field.node_id, name: 'image' });
        const siblingUploadFieldKey = getTemplateFieldStateKey({ node_id: field.node_id, name: 'upload' });
        const previewSourceValues = [
          historyParams[fieldKey],
          historyParams[siblingImageFieldKey],
          historyParams[siblingUploadFieldKey],
        ]
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .map((value) => getTemplateAssetIdFromValue(value).trim() || (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean);

        const previewBasis = normalizedAssetValues.some(Boolean) ? normalizedAssetValues : normalizedValues;
        const previewValues = previewBasis.map((value, index) => {
          const previewSource = previewSourceValues[index] || value;
          return client && isLikelyLemonGridAssetId(previewSource)
            ? client.getThumbnailUrlWithToken(previewSource)
            : '';
        });

        if (previewValues.some(Boolean)) {
          nextTemplatePreviews[fieldKey] = Array.isArray(historyValue)
            ? previewValues
            : previewValues[0] ?? '';
        }
      }
    }

    const retainedPreviewUrls = new Set(
      Object.values(nextTemplatePreviews)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value): value is string => typeof value === 'string')
    );

    Object.values(previousPreviews)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .forEach((url) => {
        if (typeof url === 'string' && url.startsWith('blob:') && !retainedPreviewUrls.has(url)) {
          URL.revokeObjectURL(url);
        }
      });

    // #region debug-point B:cluster-history-restored
    void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'B', location: 'Draw.tsx:2129', msg: '[DEBUG] cluster history state restored', data: { templateId: detail.id, templateGroupKey, imageFields: detail.param_schema.filter((field) => !field.hidden && isImageParam(field)).map((field) => { const fieldKey = getTemplateFieldStateKey(field); return { fieldKey, fieldName: field.name, fieldLabel: field.label, rawHistoryValue: historyParams?.[fieldKey], paramValue: nextTemplateParams[fieldKey], imageInputValue: nextTemplateImageInputs[fieldKey], previewValue: nextTemplatePreviews[fieldKey] }; }) }, ts: Date.now() }) }).catch(() => {});
    // #endregion

    setTemplateUploadingFieldKeys(new Set());
    setTemplateParams(nextTemplateParams);
    templateParamsRef.current = nextTemplateParams;
    setTemplateImageInputs(nextTemplateImageInputs);
    templateImageInputsRef.current = nextTemplateImageInputs;
    setTemplateUploadedImagePreviews(nextTemplatePreviews);
    templateUploadedImagePreviewsRef.current = nextTemplatePreviews;
    setSelectedTemplateGroupKey(templateGroupKey);
    setSelectedTemplate(detail);
    setIsTemplatePickerOpen(false);
    setUploadedImagePreviews({});
  }, [lemonGridServerUrl]);

  // Cluster Mode: Handle template parameter change
  const handleTemplateParamChange = (paramName: string, value: unknown) => {
    setTemplateParams(prev => ({ ...prev, [paramName]: value }));
  };

  const visibleTemplateFields = useMemo(
    () => selectedTemplate?.param_schema.filter((field) => !field.hidden) ?? [],
    [selectedTemplate]
  );

  const templateImageFields = useMemo(
    () => visibleTemplateFields.filter((field) => field.type === 'image' || isImageParam(field)),
    [visibleTemplateFields]
  );

  const templateImageSlots = useMemo(
    () =>
      templateImageFields.flatMap((field) => {
        const fieldKey = getTemplateFieldStateKey(field);
        const capacity = getTemplateImageFieldCapacity(field, selectedTemplate?.template_type);
        return Array.from({ length: capacity }, (_, slotIndex) => ({
          field,
          fieldKey,
          slotIndex,
          slotKey: getTemplateImageSlotKey(fieldKey, slotIndex),
          capacity,
        }));
      }),
    [selectedTemplate?.template_type, templateImageFields]
  );

  const templateImageSlotMap = useMemo(
    () => new Map(templateImageSlots.map((slot) => [slot.slotKey, slot])),
    [templateImageSlots]
  );

  const templateNonImageFields = useMemo(
    () =>
      visibleTemplateFields
        .filter((field) => !(field.type === 'image' || isImageParam(field)))
        .sort((a, b) => {
          const tierOf = (field: typeof a) => (field.type === 'text' && isPromptTemplateField(field) ? 0 : 1);
          return tierOf(a) - tierOf(b);
        }),
    [visibleTemplateFields]
  );

  const uploadedTemplateImageItems = useMemo(
    () =>
      templateImageSlots
        .map((slot, index) => {
          const previewUrl = getTemplateSlotStringValue(
            templateUploadedImagePreviews[slot.fieldKey],
            slot.slotIndex
          );
          const filename = getTemplateSlotStringValue(
            templateImageInputs[slot.fieldKey],
            slot.slotIndex
          );
          return {
            ...slot,
            index,
            previewUrl: typeof previewUrl === 'string' ? previewUrl : '',
            filename: typeof filename === 'string' ? filename : '',
            isUploading: templateUploadingFieldKeys.has(slot.slotKey),
          };
        })
        .filter((item) => item.previewUrl || item.filename || item.isUploading),
    [templateImageInputs, templateImageSlots, templateUploadedImagePreviews, templateUploadingFieldKeys]
  );

  const getNextEmptyTemplateImageSlot = useCallback(() => {
    return templateImageSlots.find((slot) => {
      const previewValue = getTemplateSlotStringValue(
        templateUploadedImagePreviews[slot.fieldKey],
        slot.slotIndex
      );
      const filenameValue = getTemplateSlotStringValue(
        templateImageInputs[slot.fieldKey],
        slot.slotIndex
      );
      const assetValue = getTemplateSlotAssetValue(
        templateParams[slot.fieldKey],
        slot.slotIndex
      );
      return !(previewValue.trim() || filenameValue.trim() || assetValue.trim());
    });
  }, [templateImageInputs, templateImageSlots, templateParams, templateUploadedImagePreviews]);

  const handleTemplateImageRemove = useCallback((slotKey: string) => {
    const slot = templateImageSlotMap.get(slotKey);
    if (!slot) {
      return;
    }

    const previewValue = getTemplateSlotStringValue(
      templateUploadedImagePreviewsRef.current[slot.fieldKey],
      slot.slotIndex
    );
    if (previewValue.startsWith('blob:')) {
      URL.revokeObjectURL(previewValue);
    }

    const nextTemplatePreviews = updateTemplateStringSlotRecord(
      templateUploadedImagePreviewsRef.current,
      slot.fieldKey,
      slot.slotIndex,
      ''
    );
    const nextTemplateImageInputs = updateTemplateStringSlotRecord(
      templateImageInputsRef.current,
      slot.fieldKey,
      slot.slotIndex,
      ''
    );
    const nextTemplateParams = updateTemplateAssetSlotRecord(
      templateParamsRef.current,
      slot.fieldKey,
      slot.slotIndex,
      ''
    );

    templateUploadedImagePreviewsRef.current = nextTemplatePreviews;
    templateImageInputsRef.current = nextTemplateImageInputs;
    templateParamsRef.current = nextTemplateParams;

    setTemplateUploadedImagePreviews(nextTemplatePreviews);
    setTemplateImageInputs(nextTemplateImageInputs);
    setTemplateParams(nextTemplateParams);
  }, [templateImageSlotMap]);

  const handleTemplateImageReorder = useCallback((sourceSlotKey: string, targetSlotKey: string) => {
    if (!sourceSlotKey || !targetSlotKey || sourceSlotKey === targetSlotKey) {
      return;
    }

    const sourceSlot = templateImageSlotMap.get(sourceSlotKey);
    const targetSlot = templateImageSlotMap.get(targetSlotKey);
    if (!sourceSlot || !targetSlot) {
      return;
    }

    if (templateUploadingFieldKeys.has(sourceSlotKey) || templateUploadingFieldKeys.has(targetSlotKey)) {
      return;
    }

    const nextTemplatePreviews = swapTemplateStringSlotRecord(
      templateUploadedImagePreviewsRef.current,
      sourceSlot,
      targetSlot
    );
    const nextTemplateImageInputs = swapTemplateStringSlotRecord(
      templateImageInputsRef.current,
      sourceSlot,
      targetSlot
    );
    const nextTemplateParams = swapTemplateAssetSlotRecord(
      templateParamsRef.current,
      sourceSlot,
      targetSlot
    );

    templateUploadedImagePreviewsRef.current = nextTemplatePreviews;
    templateImageInputsRef.current = nextTemplateImageInputs;
    templateParamsRef.current = nextTemplateParams;

    setTemplateUploadedImagePreviews(nextTemplatePreviews);
    setTemplateImageInputs(nextTemplateImageInputs);
    setTemplateParams(nextTemplateParams);
  }, [templateImageSlotMap, templateUploadingFieldKeys]);

  // Cluster Mode: Handle image upload for a template image param.
  // ComfyUI keeps one image per field; THIRD_PARTY_API may expand one field into multiple virtual slots.
  const handleTemplateImageUpload = useCallback(async (file: File, slotKey: string) => {
    if (!lemonGridServerUrl) return;
    const slot = templateImageSlotMap.get(slotKey);
    if (!slot) return;

    setTemplateUploadingFieldKeys((prev) => {
      const next = new Set(prev);
      next.add(slotKey);
      return next;
    });

    const uploadTask = (async () => {
      try {
        const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
        const result = await client.uploadAsset(file);
        const stablePreviewUrl = client.getThumbnailUrlWithToken(result.id);
        setTemplateParams(prev => {
          const next = updateTemplateAssetSlotRecord(prev, slot.fieldKey, slot.slotIndex, result.id);
          templateParamsRef.current = next;
          return next;
        });
        setTemplateImageInputs(prev => {
          const next = updateTemplateStringSlotRecord(prev, slot.fieldKey, slot.slotIndex, result.filename);
          templateImageInputsRef.current = next;
          return next;
        });
        setTemplateUploadedImagePreviews(prev => {
          const next = updateTemplateStringSlotRecord(prev, slot.fieldKey, slot.slotIndex, stablePreviewUrl);
          templateUploadedImagePreviewsRef.current = next;
          return next;
        });
      } catch (error) {
        // 上传失败：不写入任何预览/输入值，由 finally 清除 uploading 标记后该槽位自动不显示
        console.error('[Draw] Failed to upload image to LemonGrid:', error);
      }
    })();

    templateUploadTasksRef.current[slotKey] = uploadTask;
    try {
      await uploadTask;
    } finally {
      // 同 slot 已被新的上传任务接管时，不要清掉 uploading 标记，避免 spinner 提前消失
      if (templateUploadTasksRef.current[slotKey] === uploadTask) {
        delete templateUploadTasksRef.current[slotKey];
        setTemplateUploadingFieldKeys((prev) => {
          if (!prev.has(slotKey)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(slotKey);
          return next;
        });
      }
    }
  }, [lemonGridServerUrl, templateImageSlotMap]);

  const handleTemplateCombinedImageUpload = useCallback(async (file: File) => {
    const nextSlot = getNextEmptyTemplateImageSlot();
    if (!nextSlot) {
      return;
    }
    await handleTemplateImageUpload(file, nextSlot.slotKey);
  }, [getNextEmptyTemplateImageSlot, handleTemplateImageUpload]);

  // Cluster Mode: Submit task stub
  // Per D-50: Same handleGenerate function with connectionMode branch
  // Per D-41: Snapshot parameter values at submit time
  // NOTE: Polling/WS progress tracking and result download are handled by Plan 06-03
  // Per D-39: Support concurrent tasks — no isGenerating lock in Cluster Mode
  const handleClusterSubmit = async () => {
    // #region debug-point D:cluster-submit-entry
    void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'D', location: 'Draw.tsx:2401', msg: '[DEBUG] cluster submit entered', data: { isLemonGridConnected, hasSelectedTemplate: Boolean(selectedTemplate), lemonGridServerUrlPresent: Boolean(lemonGridServerUrl), isSubmittingCluster }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    if (!isLemonGridConnected || !selectedTemplate || !lemonGridServerUrl) {
      // #region debug-point D:cluster-submit-early-return
      void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'D', location: 'Draw.tsx:2403', msg: '[DEBUG] cluster submit early return missing connection/template', data: { isLemonGridConnected, hasSelectedTemplate: Boolean(selectedTemplate), lemonGridServerUrlPresent: Boolean(lemonGridServerUrl) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      return;
    }
    if (isSubmittingCluster) {
      // #region debug-point D:cluster-submit-busy
      void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'D', location: 'Draw.tsx:2406', msg: '[DEBUG] cluster submit ignored because already submitting', data: { selectedTemplateId: selectedTemplate.id }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      return;
    }

    setIsSubmittingCluster(true);
    try {
      const pendingUploadTasks = Object.values(templateUploadTasksRef.current);
      if (pendingUploadTasks.length > 0) {
        await Promise.allSettled(pendingUploadTasks);
      }
      const currentTemplateParams = templateParamsRef.current;
      const currentTemplateImageInputs = templateImageInputsRef.current;
      const currentTemplatePreviews = templateUploadedImagePreviewsRef.current;
      const uploadedImageCount = templateImageSlots.filter((slot) => {
        const previewValue = getTemplateSlotStringValue(currentTemplatePreviews[slot.fieldKey], slot.slotIndex);
        const filenameValue = getTemplateSlotStringValue(currentTemplateImageInputs[slot.fieldKey], slot.slotIndex);
        const assetValue = getTemplateSlotAssetValue(currentTemplateParams[slot.fieldKey], slot.slotIndex);
        return previewValue.trim() || filenameValue.trim() || assetValue.trim();
      }).length;
      // #region debug-point C:cluster-submit-image-state
      void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'C', location: 'Draw.tsx:2424', msg: '[DEBUG] cluster submit image state', data: { selectedTemplateId: selectedTemplate.id, usesImageCountVariants: Boolean(selectedTemplateGroup?.usesImageCountVariants), uploadedImageCount, imageSlots: templateImageSlots.map((slot) => ({ slotKey: slot.slotKey, fieldKey: slot.fieldKey, slotIndex: slot.slotIndex, previewValue: getTemplateSlotStringValue(currentTemplatePreviews[slot.fieldKey], slot.slotIndex), filenameValue: getTemplateSlotStringValue(currentTemplateImageInputs[slot.fieldKey], slot.slotIndex), assetValue: getTemplateSlotAssetValue(currentTemplateParams[slot.fieldKey], slot.slotIndex), rawParamValue: currentTemplateParams[slot.fieldKey] })) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      if (selectedTemplateGroup?.usesImageCountVariants && uploadedImageCount === 0) {
        // #region debug-point C:cluster-submit-zero-images
        void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'C', location: 'Draw.tsx:2427', msg: '[DEBUG] cluster submit aborted because uploadedImageCount is zero', data: { selectedTemplateId: selectedTemplate.id, selectedTemplateGroupKey, usesImageCountVariants: Boolean(selectedTemplateGroup?.usesImageCountVariants) }, ts: Date.now() }) }).catch(() => {});
        // #endregion
        return;
      }

      const targetTemplateSummary = selectedTemplateGroup
        ? resolveClusterTemplateVariant(selectedTemplateGroup, uploadedImageCount)
        : null;
      const targetTemplateDetail = targetTemplateSummary && targetTemplateSummary.id !== selectedTemplate.id
        ? buildTemplateDetail(targetTemplateSummary)
        : selectedTemplate;
      const effectiveState = selectedTemplateGroup?.usesImageCountVariants && targetTemplateSummary
        ? remapTemplateStateToDetail(
            selectedTemplate,
            targetTemplateDetail,
            currentTemplateParams,
            currentTemplateImageInputs,
            currentTemplatePreviews
          )
        : {
            targetParams: currentTemplateParams,
            targetImageInputs: currentTemplateImageInputs,
            targetPreviews: currentTemplatePreviews,
          };

      // Apply seed modes before submitting
      const seedModeUpdates: Record<string, number> = {};
      Object.entries(seedModes).forEach(([fieldName, mode]) => {
        const currentValue = effectiveState.targetParams[fieldName];
        if (typeof currentValue !== 'number') return;
        switch (mode) {
          case 'fixed':
            break;
          case 'increment':
            seedModeUpdates[fieldName] = currentValue + 1;
            break;
          case 'decrement':
            seedModeUpdates[fieldName] = currentValue - 1;
            break;
          case 'randomize':
            seedModeUpdates[fieldName] = Math.floor(Math.random() * 1000000000000000);
            break;
        }
      });
      const seededTemplateParams = Object.keys(seedModeUpdates).length > 0
        ? { ...effectiveState.targetParams, ...seedModeUpdates }
        : effectiveState.targetParams;
      if (Object.keys(seedModeUpdates).length > 0) {
        setTemplateParams(prev => ({ ...prev, ...seedModeUpdates }));
      }

      const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
      // Per D-41: Snapshot parameter values at submit time
      // Build params with node_id.name keys (e.g. "100.upload") as required by API
      const snapshotParams: Record<string, unknown> = {};
      for (const field of targetTemplateDetail.param_schema) {
        // Skip hidden fields — backend uses workflow defaults for those
        if (field.hidden) continue;

        const fieldKey = getTemplateFieldStateKey(field);
        const value = seededTemplateParams[fieldKey] ?? renderParamDefault(field);
        const imageFieldKey = getTemplateFieldStateKey({ node_id: field.node_id, name: 'image' });
        const uploadFieldKey = getTemplateFieldStateKey({ node_id: field.node_id, name: 'upload' });

        // For image fields: only include if user actually uploaded an asset.
        // Default ComfyUI filenames from param_schema are invalid on the cluster server.
        if (field.type === 'image' || isImageParam(field)) {
          const pairedFilenameValue = effectiveState.targetImageInputs[fieldKey]
            ?? effectiveState.targetImageInputs[imageFieldKey]
            ?? effectiveState.targetImageInputs[uploadFieldKey];
          const normalizedFilename = Array.isArray(pairedFilenameValue)
            ? pairedFilenameValue.find((item) => typeof item === 'string' && item.trim() !== '')
            : pairedFilenameValue;

          if ((targetTemplateDetail.template_type || 'COMFYUI') === 'COMFYUI' && field.name === 'image') {
            if (typeof normalizedFilename === 'string' && normalizedFilename.trim() !== '') {
              snapshotParams[`${field.node_id}.${field.name}`] = normalizedFilename.trim();
            }
            continue;
          }

          const pairedAssetValue = seededTemplateParams[fieldKey]
            ?? seededTemplateParams[uploadFieldKey]
            ?? seededTemplateParams[imageFieldKey];
          const normalizedAssetIds = (Array.isArray(pairedAssetValue) ? pairedAssetValue : [pairedAssetValue])
            .map((item) => getTemplateAssetIdFromValue(item).trim())
            .filter((item) => item.includes('-'));
          if (normalizedAssetIds.length > 0) {
            // Looks like a LemonGrid asset ID array — unwrap single-element arrays
            // to string so backend (workflow_merge_service + agent) can resolve them.
            // Backend only accepts str or dict, not arrays.
            snapshotParams[`${field.node_id}.${field.name}`] = normalizedAssetIds.length === 1 ? normalizedAssetIds[0] : normalizedAssetIds;
          }
          // else: no upload yet — skip, let backend use workflow default
          continue;
        }

        snapshotParams[`${field.node_id}.${field.name}`] = value;
      }
      // #region debug-point E:cluster-submit-snapshot
      void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'E', location: 'Draw.tsx:2520', msg: '[DEBUG] cluster submit snapshot params ready', data: { targetTemplateId: targetTemplateDetail.id, snapshotParamKeys: Object.keys(snapshotParams), imageLikeEntries: Object.entries(snapshotParams).filter(([key]) => /(?:^|\.)(?:image|upload)$/i.test(key)).map(([key, value]) => ({ key, valueType: Array.isArray(value) ? 'array' : typeof value, value })) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      const result = await client.submitTask(
        targetTemplateDetail.id,
        snapshotParams,
        targetTemplateDetail.version,
        targetTemplateDetail.template_type || 'COMFYUI'
      );
      recordPromptHistory(collectTemplatePromptHistory(targetTemplateDetail.param_schema, seededTemplateParams));

      // Add task to lemongridStore for tracking
      useLemonGridStore.getState().updateTask(result.id, {
        taskId: result.id,
        templateId: targetTemplateDetail.id,
        templateName: selectedTemplateDisplayName || targetTemplateDetail.name,
        templateType: targetTemplateDetail.template_type || 'COMFYUI',
        status: result.status as 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
        statusLocked: false,
        progress: 0,
        progressDetail: null,
        queuePosition: null,
        errorCode: null,
        errorMessage: null,
        outputAssetIds: [],
        submittedAt: Date.now(),
        completedAt: null,
        durationSeconds: null,
        params: snapshotParams,
        thumbnail: null,
      });

      // Per D-22, D-37: Start WebSocket progress tracking through Bridge
      setClusterSubmitError(null);
      startClusterWebSocket(result.id);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '任务提交失败';

      // AUTH_EXPIRED: ensureValidToken already triggered showLoginModal in store
      if (errMsg === 'AUTH_EXPIRED' || errMsg === 'Not authenticated') {
        setClusterSubmitError('登录已过期，请重新登录');
      } else if (errMsg.includes('concurrent') || errMsg.includes('limit') || errMsg.includes('429')) {
        // Per D-69: Show concurrent limit message
        setClusterSubmitError('已达到同时任务上限，请等待当前任务完成后再提交新任务');
      } else {
        // Per D-45: Show user-friendly error
        const suggestion = LEMONGRID_ERROR_SUGGESTIONS[errMsg] || LEMONGRID_ERROR_SUGGESTIONS.UNKNOWN;
        setClusterSubmitError(`${suggestion}`);
      }
    } finally {
      setIsSubmittingCluster(false);
    }
  };

  const syncGeneratedImageToPs = async (blob: Blob, comfyFilename: string) => {
    if (!isUXPWebView()) {
      return;
    }
    const normalizedName = (comfyFilename || '').trim() || `comfy-output-${Date.now()}.png`;
    const file = new File([blob], normalizedName, { type: 'image/png' });
    const base64Data = await fileToBase64(file);
    await importBase64ToPsLayer({
      base64Data,
      mode: psImportMode,
      workflowName: selectedWorkflow?.name || 'comfyui-output',
      layerName: normalizedName,
      mimeType: 'image/png'
    });
  };

  // Per D-44: Same PS layer import flow for Cluster Mode results
  const syncGeneratedImageToPsLayer = async (blob: Blob, filename: string) => {
    if (!isUXPWebView()) return;
    const normalizedName = (filename || '').trim() || `cluster-${Date.now()}.png`;
    const file = new File([blob], normalizedName, { type: 'image/png' });
    const base64Data = await fileToBase64(file);
    await importBase64ToPsLayer({
      base64Data,
      mode: psImportMode,
      workflowName: 'cluster-output',
      layerName: normalizedName,
      mimeType: 'image/png'
    });
  };

  // Per D-24: Start per-task WebSocket connection through Bridge
  const startClusterWebSocket = async (taskId: string) => {
    try {
      const result = await sendBridgeMessage('lemongrid.websocket', { taskId }) as { connectionId: string };
      wsConnectionRefs.current[taskId] = result.connectionId;
    } catch (error) {
      console.warn('[Draw] WS setup failed, falling back to polling:', error);
      // Per D-38: Auto-fallback to polling, no user prompt
      startPollingForTask(taskId);
    }
  };

  // Per D-24: Close per-task WebSocket connection
  const closeTaskWebSocket = async (taskId: string) => {
    const connectionId = wsConnectionRefs.current[taskId];
    if (connectionId) {
      try {
        await sendBridgeMessage('lemongrid.websocket.close', { connectionId });
      } catch (_e) { /* ignore close errors */ }
      delete wsConnectionRefs.current[taskId];
    }
  };

  const buildClusterTaskUpdateFromStatus = (
    status: LemonGridTaskStatus,
    options?: { lockStatus?: boolean }
  ) => ({
    status: status.status,
    ...(options?.lockStatus ? { statusLocked: true } : {}),
    progress: status.status === 'COMPLETED' ? 100 : status.progress,
    progressDetail: status.progress_detail,
    queuePosition: status.queue_position,
    errorCode: status.error_code,
    errorMessage: status.error_message,
    outputAssetIds: status.output_file_ids || [],
    completedAt: status.completed_at ? new Date(status.completed_at).getTime() : null,
    durationSeconds: status.duration_seconds,
  });

  async function syncClusterTaskStatusFromServer(
    taskId: string,
    options?: { confirmCompletion?: boolean }
  ): Promise<LemonGridTaskStatus | null> {
    const confirmCompletion = options?.confirmCompletion === true;
    const attempts = confirmCompletion ? 6 : 1;
    const serverUrl = useLemonGridStore.getState().serverUrl;
    if (!serverUrl) {
      return null;
    }

    const client = new LemonGridClient({ serverUrl });

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await ensureValidToken();
        const status = await client.getTaskStatus(taskId);

        if (status.status === 'COMPLETED') {
          useLemonGridStore.getState().updateTask(
            taskId,
            buildClusterTaskUpdateFromStatus(status, { lockStatus: true })
          );
          await handleTaskCompletion(taskId);
          return status;
        }

        useLemonGridStore.getState().updateTask(
          taskId,
          buildClusterTaskUpdateFromStatus(status)
        );

        if (status.status === 'FAILED' || status.status === 'CANCELLED') {
          await closeTaskWebSocket(taskId);
          return status;
        }

        if (!confirmCompletion) {
          return status;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg === 'AUTH_EXPIRED' || errMsg === 'Not authenticated') {
          return null;
        }
        if (!confirmCompletion) {
          throw error;
        }
      }

      if (attempt < attempts - 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1200);
        });
      }
    }

    return null;
  }

  // Per D-22, D-28, D-31, D-32, D-38: Polling fallback with adaptive intervals
  const startPollingForTask = (taskId: string) => {
    const poll = async () => {
      try {
        // Per D-42: Auto re-auth on 401
        await ensureValidToken();
        const serverUrl = useLemonGridStore.getState().serverUrl;
        const client = new LemonGridClient({ serverUrl });
        const status = await client.getTaskStatus(taskId);
        const store = useLemonGridStore.getState();

        store.updateTask(
          taskId,
          buildClusterTaskUpdateFromStatus(status, { lockStatus: status.status === 'COMPLETED' })
        );

        if (['PENDING', 'QUEUED', 'SYNCING', 'RUNNING'].includes(status.status)) {
          // Per D-28: Adaptive interval - 1s running, 2s queued/syncing
          const interval = status.status === 'RUNNING' ? 1000 : 2000;
          setTimeout(poll, interval);
        } else {
          // Task reached terminal state
          if (status.status === 'COMPLETED') {
            await handleTaskCompletion(taskId);
          } else {
            await closeTaskWebSocket(taskId);
          }
        }
      } catch (_error) {
        // Per D-42: Stop polling on auth expiry — ensureValidToken already set showLoginModal
        const errMsg = _error instanceof Error ? _error.message : String(_error);
        if (errMsg === 'AUTH_EXPIRED' || errMsg === 'Not authenticated') {
          return; // Stop polling
        }
        // Per D-31: Keep polling on other errors, Per D-32: No client timeout
        setTimeout(poll, 2000);
      }
    };
    poll();
  };

  useEffect(() => {
    const state = location.state as HistoryActionState | null;
    const taskId = state?.trackClusterTaskId;
    if (!taskId || connectionMode !== 'cluster' || !isLemonGridConnected) {
      return;
    }
    if (trackedClusterTaskIdsRef.current.has(taskId)) {
      return;
    }

    trackedClusterTaskIdsRef.current.add(taskId);
    startClusterWebSocket(taskId);
    window.history.replaceState({}, document.title);
  }, [connectionMode, isLemonGridConnected, location.state]);

  // Per D-34, D-35, D-44, D-47: Download all outputs and auto-import to PS
  const completingTaskIds = useRef<Set<string>>(new Set());
  const importedClusterAssetIdsRef = useRef<Record<string, Set<string>>>({});
  async function handleTaskCompletion(taskId: string) {
    // Idempotency guard: prevent duplicate downloads from WS + polling races
    if (completingTaskIds.current.has(taskId)) return;
    completingTaskIds.current.add(taskId);

    try {
      const serverUrl = useLemonGridStore.getState().serverUrl;
      const client = new LemonGridClient({ serverUrl });

      let task = useLemonGridStore.getState().tasks[taskId];

      let resolvedOutputAssetIds = task?.outputAssetIds ?? [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (attempt > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 1200);
          });
        }

        const status = await client.getTaskStatus(taskId);
        const nextOutputAssetIds = status.output_file_ids || [];
        if (nextOutputAssetIds.length > 0) {
          resolvedOutputAssetIds = nextOutputAssetIds;
          useLemonGridStore.getState().updateTask(taskId, {
            status: status.status,
            ...(status.status === 'COMPLETED' ? { statusLocked: true } : {}),
            outputAssetIds: nextOutputAssetIds,
            completedAt: status.completed_at ? new Date(status.completed_at).getTime() : null,
            durationSeconds: status.duration_seconds,
          });
          task = useLemonGridStore.getState().tasks[taskId];
        }

        if (status.status === 'COMPLETED' && nextOutputAssetIds.length > 0) {
          break;
        }
      }

      task = useLemonGridStore.getState().tasks[taskId] || task;
      if (task && resolvedOutputAssetIds.length > 0 && task.outputAssetIds.length === 0) {
        useLemonGridStore.getState().updateTask(taskId, {
          outputAssetIds: resolvedOutputAssetIds,
        });
        task = useLemonGridStore.getState().tasks[taskId];
      }

      if (!task || !task.outputAssetIds.length) {
        return;
      }

      const importedAssetIds = importedClusterAssetIdsRef.current[taskId] || new Set<string>();
      importedClusterAssetIdsRef.current[taskId] = importedAssetIds;
      const pendingAssetIds = task.outputAssetIds.filter((assetId) => !importedAssetIds.has(assetId));

      for (const assetId of pendingAssetIds) {
        try {
          const blob = await client.downloadAsset(assetId);
          const filename = `cluster-${assetId.substring(0, 8)}.png`;
          // Per D-35: Auto-import to PS as separate layer
          await syncGeneratedImageToPsLayer(blob, filename);
          importedAssetIds.add(assetId);
          // Per D-51: Store in clusterOutputImages
          useLemonGridStore.getState().addClusterOutputImage({
            url: URL.createObjectURL(blob),
            blob,
            filename,
            assetId,
          });
          // Also add to outputImages for preview strip and prompt reverse data-asset-id
          setOutputImages(prev => [...prev, { previewUrl: URL.createObjectURL(blob), blob, filename, assetId }]);
        } catch (e) {
          console.error('[Draw] Download/import failed for asset:', assetId, e);
        }
      }
      // Per D-47: Auto-display results
      closeTaskWebSocket(taskId);
      await useHistoryStore.getState().fetchFromCluster(serverUrl);
    } finally {
      completingTaskIds.current.delete(taskId);
    }
  }

  // Per D-43: Retry failed task with same params
  const handleRetryTask = async (taskId: string) => {
    const task = useLemonGridStore.getState().tasks[taskId];
    if (!task) return;

    // Remove the failed task
    useLemonGridStore.getState().removeTask(taskId);

    // Re-submit with same params per D-41
    setIsGenerating(true);
    try {
      const serverUrl = useLemonGridStore.getState().serverUrl;
      const client = new LemonGridClient({ serverUrl });
      const result = await client.submitTask(task.templateId, task.params, 1, task.templateType || 'COMFYUI');

      useLemonGridStore.getState().updateTask(result.id, {
        taskId: result.id,
        templateId: task.templateId,
        templateName: task.templateName,
        templateType: task.templateType || 'COMFYUI',
        status: result.status as 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
        statusLocked: false,
        progress: 0,
        progressDetail: null,
        queuePosition: null,
        errorCode: null,
        errorMessage: null,
        outputAssetIds: [],
        submittedAt: Date.now(),
        completedAt: null,
        durationSeconds: null,
        params: task.params,
        thumbnail: null,
      });

      startClusterWebSocket(result.id);
    } catch (error) {
      console.error('[Draw] Retry failed:', error);
    }
  };

  // Per D-63: Re-import completed task result
  const handleImportClusterResult = async (taskId: string, assetId: string) => {
    void taskId;
    try {
      const serverUrl = useLemonGridStore.getState().serverUrl;
      const client = new LemonGridClient({ serverUrl });
      const blob = await client.downloadAsset(assetId);
      const filename = `cluster-${assetId.substring(0, 8)}.png`;
      await syncGeneratedImageToPsLayer(blob, filename);
    } catch (e) {
      console.error('[Draw] Re-import failed:', e);
    }
  };

  const handleGenerate = async () => {
    // Per D-50: Branch on connectionMode for cluster vs direct
    const currentConnectionMode = useSettingsStore.getState().connectionMode;
    // #region debug-point D:generate-click
    void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'D', location: 'Draw.tsx:2816', msg: '[DEBUG] generate button clicked', data: { currentConnectionMode, isLemonGridConnected, hasSelectedTemplate: Boolean(selectedTemplate), selectedTemplateId: selectedTemplate?.id ?? null, isSubmittingCluster }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    if (currentConnectionMode === 'cluster') {
      // Per D-15: Must be connected to LemonGrid
      if (!isLemonGridConnected || !selectedTemplate) {
        // #region debug-point D:generate-cluster-early-return
        void fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'cluster-reedit-image', runId: 'pre-fix', hypothesisId: 'D', location: 'Draw.tsx:2821', msg: '[DEBUG] generate cluster early return missing connection/template', data: { isLemonGridConnected, hasSelectedTemplate: Boolean(selectedTemplate), selectedTemplateId: selectedTemplate?.id ?? null }, ts: Date.now() }) }).catch(() => {});
        // #endregion
        return;
      }
      await handleClusterSubmit();
      return;
    }

    // Direct Mode (existing flow) continues unchanged below
    // Use ref to get the latest workflow (avoids stale closure issues)
    const currentWorkflow = selectedWorkflowRef.current || selectedWorkflow;
    console.log('[Draw] handleGenerate called, workflow:', currentWorkflow?.name);
    if (!currentWorkflow || !comfyUISettings.isConnected) {
      console.log('[Draw] handleGenerate early return - no workflow or not connected');
      return;
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    setIsGenerating(true);
    setProgress({
      status: 'generating',
      percentage: 0,
      currentNode: '初始化...',
      previewImage: null,
      error: null,
      promptId: null,
    });
    setOutputImages([]);
    setActiveOutputIndex(0);
    setIsViewerOpen(false);
    setLatestGeneratedImageBlob(null);

    try {
      const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
      // 使用设置中存储的 prefixMode，而不是重新探测
      const prefixMode = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
      const prefix = prefixMode === 'api' ? '/api' : '';

      const wsUrl = `${comfyUISettings.baseUrl.replace(/^http/i, 'ws')}${prefix}/ws?clientId=${clientId}`;
      let ws: WebSocket | null = null;
      let wsAvailable = false;

      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('WebSocket 连接超时')), 5000);
          ws!.onopen = () => {
            clearTimeout(timer);
            resolve();
          };
          ws!.onerror = () => {
            clearTimeout(timer);
            reject(new Error('WebSocket 连接失败'));
          };
        });

        wsAvailable = true;
      } catch (error) {
        console.warn('[Draw] WebSocket 连接失败，改用轮询模式:', error);
        if (ws) {
          ws.close();
        }
        wsRef.current = null;
      }

      const currentWorkflowGroup = selectedGroupedWorkflow;
      const currentWorkflowImageEntries = extractOrderedWorkflowImageEntries(
        workflowImageInputs,
        latestInputValuesRef.current,
        uploadedImagePreviewsRef.current,
        uploadedImageBase64Ref.current
      );
      const currentFilledWorkflowImageCount = currentWorkflowImageEntries.length;
      const targetWorkflow = currentWorkflowGroup?.usesImageCountVariants
        ? resolveGroupedWorkflowVariant(currentWorkflowGroup, currentFilledWorkflowImageCount)
        : currentWorkflow;

      if (!targetWorkflow) {
        throw new Error('未找到匹配当前上传数量的工作流变体');
      }

      const workflowData = await client.readWorkflow(targetWorkflow.path || targetWorkflow.name, prefixMode);
      const isResolvedVariant = (targetWorkflow.path || targetWorkflow.name) !== (currentWorkflow.path || currentWorkflow.name);
      const targetWorkflowInputs = isResolvedVariant
        ? parseAndEnrichWorkflowInputs(workflowData, objectInfo, experimentModels)
        : workflowInputs;
      const targetDefaults = targetWorkflowInputs.reduce<Record<string, string | number | boolean>>((acc, input) => {
        if (input.default !== undefined) {
          acc[input.name] = input.default;
        }
        return acc;
      }, {});
      let workingInputValues = isResolvedVariant
        ? {
            ...targetDefaults,
            ...remapInputValuesToWorkflowInputs(workflowInputs, targetWorkflowInputs, latestInputValuesRef.current),
          }
        : { ...latestInputValuesRef.current };
      if (isResolvedVariant && currentWorkflowImageEntries.length > 0) {
        const appliedVariantImages = applyWorkflowImageEntriesToInputs(
          targetWorkflowInputs.filter((input) => input.type === 'image'),
          currentWorkflowImageEntries
        );
        workingInputValues = {
          ...workingInputValues,
          ...appliedVariantImages.values,
        };
      }
      // #region debug-point B:direct-variant-remap
      {
        const sourceImageValues = Object.fromEntries(
          Object.entries(latestInputValuesRef.current).filter(([key, value]) => key.startsWith('image_') && typeof value === 'string')
        );
        const workingImageValues = Object.fromEntries(
          Object.entries(workingInputValues).filter(([key, value]) => key.startsWith('image_') && typeof value === 'string')
        );
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'direct-image-default',
            runId: 'pre',
            hypothesisId: 'B',
            location: 'Draw.tsx:1944',
            msg: '[DEBUG] direct workflow variant resolved',
            data: {
              currentWorkflowName: currentWorkflow.name,
              targetWorkflowName: targetWorkflow.name,
              isResolvedVariant,
              currentFilledWorkflowImageCount,
              sourceImageValues,
              targetWorkflowImageInputs: targetWorkflowInputs.filter((input) => input.type === 'image').map((input) => input.name),
              workingImageValues,
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      const effectiveSeedModes = isResolvedVariant
        ? remapInputValuesToWorkflowInputs(workflowInputs, targetWorkflowInputs, seedModes)
        : seedModes;

      // Save original seed values before applying workflow's control_after_generate
      const originalSeedValues: Record<string, number> = {};
      Object.entries(workingInputValues).forEach(([key, value]) => {
        if (key.toLowerCase().includes('seed') && typeof value === 'number') {
          originalSeedValues[key] = value;
        }
      });

      // Generate random seeds for nodes with "randomize" mode BEFORE compiling
      const workflowDataTyped = workflowData as { nodes?: any[] } | null | undefined;
      if (workflowDataTyped?.nodes && Array.isArray(workflowDataTyped.nodes)) {
        const randomSeedUpdates: Record<string, number> = {};
        workflowDataTyped.nodes.forEach((node: any) => {
          if (!node || node.id === undefined) return;
          const widgetValues = node.widgets_values || [];
          // Check if node has "randomize" mode (second element of widgets_values)
          if (Array.isArray(widgetValues) && widgetValues.length >= 2 && widgetValues[1] === 'randomize') {
            const nodeId = String(node.id);
            // Process inputs array (for nodes like RandomNoise)
            if (Array.isArray(node.inputs)) {
              node.inputs.forEach((input: any) => {
                const inputName = input?.name;
                if (inputName && inputName.toLowerCase().includes('seed')) {
                  const newSeed = Math.floor(Math.random() * 1000000000000000);
                  randomSeedUpdates[`${inputName}_${nodeId}`] = newSeed;
                  console.log(`[Draw] Generated random seed for ${inputName}_${nodeId}: ${newSeed}`);
                }
              });
            }
            // Also process widgets array if present
            if (Array.isArray(node.widgets)) {
              node.widgets.forEach((widget: any) => {
                const widgetName = widget?.name;
                if (widgetName && widgetName.toLowerCase().includes('seed')) {
                  const newSeed = Math.floor(Math.random() * 1000000000000000);
                  randomSeedUpdates[`${widgetName}_${nodeId}`] = newSeed;
                  console.log(`[Draw] Generated random seed for ${widgetName}_${nodeId}: ${newSeed}`);
                }
              });
            }
          }
        });
        // Update inputValues with generated random seeds
        if (Object.keys(randomSeedUpdates).length > 0) {
          console.log('[Draw] Updating inputValues with random seeds:', randomSeedUpdates);
          workingInputValues = { ...workingInputValues, ...randomSeedUpdates };
          if (!isResolvedVariant) {
            setInputValues((prev) => {
              const next = { ...prev, ...randomSeedUpdates };
              latestInputValuesRef.current = next;
              return next;
            });
          }
        }
      }

      // Apply seed modes (override workflow's control_after_generate)
      const seedModeUpdates: Record<string, number> = {};
      Object.entries(effectiveSeedModes).forEach(([fieldName, mode]) => {
        const original = originalSeedValues[fieldName];
        if (typeof original !== 'number') return;
        switch (mode) {
          case 'fixed':
            seedModeUpdates[fieldName] = original;
            break;
          case 'increment':
            seedModeUpdates[fieldName] = original + 1;
            break;
          case 'decrement':
            seedModeUpdates[fieldName] = original - 1;
            break;
          case 'randomize':
            // If workflow's randomize didn't fire, generate one ourselves
            if (latestInputValuesRef.current[fieldName] === original) {
              seedModeUpdates[fieldName] = Math.floor(Math.random() * 1000000000000000);
            }
            break;
        }
      });
      if (Object.keys(seedModeUpdates).length > 0) {
        workingInputValues = { ...workingInputValues, ...seedModeUpdates };
        if (!isResolvedVariant) {
          setInputValues((prev) => {
            const next = { ...prev, ...seedModeUpdates };
            latestInputValuesRef.current = next;
            return next;
          });
        }
      }

      const historyPrompt = pendingRerunPromptRef.current;
      const currentInputValues = workingInputValues;

      // DIAGNOSTIC: log the rerun path taken
      console.log('[Draw-RERUN-DIAG] historyPrompt is', historyPrompt ? 'PRESENT (rerun path)' : 'NULL (fresh compile path)');
      if (historyPrompt) {
        // Log dimension values in the original history prompt
        for (const [nodeId, nodeVal] of Object.entries(historyPrompt)) {
          if (!nodeVal || typeof nodeVal !== 'object') continue;
          const rec = nodeVal as Record<string, unknown>;
          const ins = rec.inputs as Record<string, unknown> | undefined;
          if (ins && (ins.width !== undefined || ins.height !== undefined)) {
            console.log(`[Draw-RERUN-DIAG] historyPrompt node ${nodeId} (${rec.class_type ?? rec.type}): width=${JSON.stringify(ins.width)}, height=${JSON.stringify(ins.height)}`);
          }
        }
      }
      // Log any dimension keys in currentInputValues
      const dimKeys = Object.entries(currentInputValues).filter(([k]) => {
        const base = k.includes('_') ? k.slice(0, k.lastIndexOf('_')) : k;
        return base === 'width' || base === 'height';
      });
      if (dimKeys.length > 0) {
        console.warn('[Draw-RERUN-DIAG] currentInputValues has dimension keys:', Object.fromEntries(dimKeys));
      } else {
        console.log('[Draw-RERUN-DIAG] currentInputValues has NO dimension keys (good)');
      }

      // For rerun: strip dimension-related values from inputValues so they
      // never overwrite the original prompt's dimensions (linked refs or resolved numbers)
      let effectiveValues = currentInputValues;
      if (historyPrompt) {
        const dimensionInputNames = new Set(['width', 'height']);
        const stripped: Record<string, string | number | boolean> = {};
        let hasStrip = false;
        for (const [key, val] of Object.entries(currentInputValues)) {
          const baseName = key.includes('_') ? key.slice(0, key.lastIndexOf('_')) : key;
          if (dimensionInputNames.has(baseName)) {
            hasStrip = true;
            continue;
          }
          stripped[key] = val;
        }
        if (hasStrip) {
          console.log('[Draw-RERUN-DIAG] Stripped dimension keys from effectiveValues');
          effectiveValues = stripped;
        }
      }

      const compiledPrompt = historyPrompt
        ? sanitizePromptGraph(applyInputValuesToPrompt(historyPrompt, effectiveValues))
        : compileWorkflowToPrompt(workflowData, effectiveValues, objectInfo);
      const finalPrompt = enforceLatestImageInputs(compiledPrompt, effectiveValues, targetWorkflowInputs);
      // #region debug-point C:direct-final-prompt
      {
        const effectiveImageValues = Object.fromEntries(
          Object.entries(effectiveValues).filter(([key, value]) => key.startsWith('image_') && typeof value === 'string')
        );
        const loadImageNodes = Object.fromEntries(
          Object.entries(finalPrompt)
            .filter(([, nodeValue]) => {
              if (!nodeValue || typeof nodeValue !== 'object' || Array.isArray(nodeValue)) {
                return false;
              }
              const record = nodeValue as Record<string, unknown>;
              const classType = String(record.class_type ?? record.type ?? '').toLowerCase();
              return classType.includes('loadimage');
            })
            .map(([nodeId, nodeValue]) => {
              const record = nodeValue as Record<string, unknown>;
              const inputs = (record.inputs ?? {}) as Record<string, unknown>;
              return [nodeId, { image: inputs.image ?? null, upload: inputs.upload ?? null }];
            })
        );
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'direct-image-default',
            runId: 'pre',
            hypothesisId: 'C',
            location: 'Draw.tsx:2090',
            msg: '[DEBUG] direct final prompt prepared',
            data: {
              effectiveImageValues,
              loadImageNodes,
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      pendingRerunPromptRef.current = null;

      // DIAGNOSTIC: log final prompt dimensions
      for (const [nodeId, nodeVal] of Object.entries(finalPrompt)) {
        if (!nodeVal || typeof nodeVal !== 'object') continue;
        const rec = nodeVal as Record<string, unknown>;
        const ins = rec.inputs as Record<string, unknown> | undefined;
        if (ins && (ins.width !== undefined || ins.height !== undefined)) {
          console.log(`[Draw-RERUN-DIAG] finalPrompt node ${nodeId} (${rec.class_type ?? rec.type}): width=${JSON.stringify(ins.width)}, height=${JSON.stringify(ins.height)}`);
        }
      }

      let promptId = '';

      const generationCompleted = wsAvailable && ws
        ? new Promise<void>((resolve, reject) => {
        ws!.onmessage = async (event) => {
          if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
              setProgress(prev => ({
                ...prev,
                previewImage: reader.result as string,
              }));
            };
            reader.readAsDataURL(event.data);
            return;
          }

          let data: any;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }

          const messagePromptId = data?.data?.prompt_id || data?.prompt_id;
          const isCurrentPrompt = !messagePromptId || !promptId || messagePromptId === promptId;
          if (!isCurrentPrompt) {
            return;
          }

          switch (data.type) {
            case 'execution_start':
              setProgress(prev => ({
                ...prev,
                status: 'generating',
                currentNode: '开始执行...',
              }));
              break;
            case 'execution_cached':
              setProgress(prev => ({
                ...prev,
                currentNode: '使用缓存节点...',
              }));
              break;
            case 'executing':
              if (data.data?.node) {
                setProgress(prev => ({
                  ...prev,
                  currentNode: `执行节点: ${data.data.node}`,
                }));
              } else if (messagePromptId && messagePromptId === promptId) {
                setProgress(prev => ({
                  ...prev,
                  percentage: 100,
                }));
              }
              break;
            case 'progress': {
              const value = Number(data.data?.value ?? 0);
              const max = Number(data.data?.max ?? 0);
              const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
              setProgress(prev => ({
                ...prev,
                percentage,
              }));
              break;
            }
            case 'executed': {
              const images = data.data?.output?.images;
              if (Array.isArray(images) && images.length > 0) {
                setProgress(prev => ({
                  ...prev,
                  currentNode: '获取输出图像...',
                }));

                try {
                  const outputImages = await Promise.all(
                    images.map((image: any) =>
                      fetchOutputImage(
                        String(image.filename || ''),
                        String(image.subfolder || ''),
                        String(image.type || 'output'),
                        prefix
                      )
                    )
                  );

                  await updateOutputImages(outputImages);
                  resolve();
                } catch (error) {
                  reject(error instanceof Error ? error : new Error('获取输出图像失败'));
                }
              } else {
                setProgress(prev => ({
                  ...prev,
                  status: 'completed',
                  percentage: 100,
                  currentNode: '完成',
                }));
                resolve();
              }
              break;
            }
            default:
              break;
          }
        };

        ws!.onerror = () => {
          reject(new Error('WebSocket 连接中断'));
        };
      })
        : null;

      const submittedInputValues = { ...latestInputValuesRef.current };
      const fetcher = isUXPWebView()
        ? (u: string, o: RequestInit) => bridgeFetch(u, o)
        : (u: string, o: RequestInit) => fetch.call(window, u, o);
      const extraData = {
        workflow_name: currentWorkflow?.name || '',
      };
      console.log('[Draw] Submitting prompt with extra_data:', extraData);
      const response = await fetcher(`${comfyUISettings.baseUrl}${prefix}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          client_id: clientId,
          extra_data: extraData,
        }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        // #region debug-point D:direct-prompt-error
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'direct-image-default',
            runId: 'pre',
            hypothesisId: 'D',
            location: 'Draw.tsx:2234',
            msg: '[DEBUG] direct prompt request failed',
            data: { status: response.status, responseData },
            ts: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        throw new Error(responseData?.error?.message || `HTTP ${response.status}`);
      }

      promptId = responseData.prompt_id;
      recordPromptHistory(collectWorkflowPromptHistory(submittedInputValues));
      setProgress(prev => ({
        ...prev,
        promptId,
      }));

      if (generationCompleted) {
        await generationCompleted;
      } else {
        await pollForHistoryCompletion(client, promptId, prefixMode, prefix);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '生成失败';
      setProgress(prev => ({
        ...prev,
        status: 'error',
        error: errorMsg,
      }));
    } finally {
      setIsGenerating(false);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }
  };


  // Helper to render input controls

  // Helper to render input controls
  const activeOutput = outputImages[activeOutputIndex] || null;

  const openOutputViewer = useCallback((index: number) => {
    if (outputImages.length === 0) return;
    setActiveOutputIndex(index);
    setProgress((prev) => ({
      ...prev,
      previewImage: outputImages[index]?.previewUrl || prev.previewImage,
    }));
    setIsViewerOpen(true);
  }, [outputImages]);

  const closeOutputViewer = () => {
    setIsViewerOpen(false);
  };

  const showPreviousOutput = () => {
    if (outputImages.length === 0) return;
    setActiveOutputIndex((prev) => {
      const nextIndex = (prev - 1 + outputImages.length) % outputImages.length;
      setProgress((state) => ({
        ...state,
        previewImage: outputImages[nextIndex]?.previewUrl || state.previewImage,
      }));
      return nextIndex;
    });
  };

  const showNextOutput = () => {
    if (outputImages.length === 0) return;
    setActiveOutputIndex((prev) => {
      const nextIndex = (prev + 1) % outputImages.length;
      setProgress((state) => ({
        ...state,
        previewImage: outputImages[nextIndex]?.previewUrl || state.previewImage,
      }));
      return nextIndex;
    });
  };

  const inputGroups: WorkflowInputGroup[] = sortedWorkflowInputs.reduce((groups, input) => {
    const classType = input.classType || DEFAULT_CLASS_TYPE;
    const groupKey = input.nodeId ? `node-${input.nodeId}` : `type-${classType}`;
    const groupLabel = input.nodeLabel || getNodeTypeChineseLabel(classType) || classType;
    const existing = groups.find((group) => group.key === groupKey);
    if (existing) {
      existing.items.push(input);
      return groups;
    }

    groups.push({
      key: groupKey,
      label: groupLabel,
      classType,
      items: [input],
    });
    return groups;
  }, [] as WorkflowInputGroup[])
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        const nodeDiff = getInputNodeOrder(a) - getInputNodeOrder(b);
        if (nodeDiff !== 0) {
          return nodeDiff;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      }),
    }))
    .sort((a, b) => {
      // Explicit ordering: image upload groups first, then text/prompt groups, then everything else.
      // Within each tier, preserve original node order.
      const tierOf = (g: typeof a) => {
        if (g.items.some(item => item.type === 'image')) return 0;
        if (g.items.some(item => item.type === 'text' && isPromptWorkflowField(item))) return 1;
        return 2;
      };
      const aTier = tierOf(a);
      const bTier = tierOf(b);
      if (aTier !== bTier) return aTier - bTier;

      const aMin = a.items.reduce((min, item) => Math.min(min, getInputNodeOrder(item)), Number.MAX_SAFE_INTEGER);
      const bMin = b.items.reduce((min, item) => Math.min(min, getInputNodeOrder(item)), Number.MAX_SAFE_INTEGER);
      if (aMin !== bMin) {
        return aMin - bMin;
      }
      return a.label.localeCompare(b.label, 'zh-CN');
    });

  // Filter input groups based on config
  const filteredInputGroups = useMemo(() => {
    console.log('[Draw] Filtering input groups, total:', inputGroups.length);
    inputGroups.forEach(g => {
      console.log(`[Draw]   - Group: ${g.label}, classType: ${g.classType}, items: ${g.items.length}`);
    });
    
    const filtered = inputGroups.filter(group => {
      if (!group.classType) return true;
      const shouldShow = shouldDisplayNode(group.classType);
      console.log(`[Draw]   - shouldDisplayNode("${group.classType}"): ${shouldShow}`);
      return shouldShow;
    }).map(group => {
      const allowedInputs = getAllowedInputs(group.classType);
      console.log(`[Draw]   - getAllowedInputs("${group.classType}"):`, allowedInputs);
      if (allowedInputs === null) {
        return group; // Show all inputs
      }
      return {
        ...group,
        items: group.items.filter(item => {
          // Input names are formatted as `${inputName}_${nodeId}`, so we need to
          // extract the base input name for comparison with allowedInputs
          const lastUnderscore = item.name.lastIndexOf('_');
          const baseInputName = lastUnderscore > 0 ? item.name.slice(0, lastUnderscore) : item.name;
          return allowedInputs.includes(baseInputName);
        })
      };
    }).filter(group => group.items.length > 0); // Remove empty groups
    
    console.log('[Draw] Filtered groups:', filtered.length);
    filtered.forEach(g => {
      console.log(`[Draw]   - Filtered: ${g.label}, items: ${g.items.length}`);
    });
    
    return filtered;
  }, [inputGroups, shouldDisplayNode, getAllowedInputs, config]);

  const groupedWorkflows = useMemo(
    () => groupWorkflowsByImageVariants(workflows),
    [workflows]
  );

  const workflowGroups = useMemo<WorkflowDirectoryGroup[]>(() => {
    const map = new Map<string, GroupedWorkflowEntry[]>();

    groupedWorkflows.forEach((workflow) => {
      const bucket = map.get(workflow.directory);
      if (bucket) {
        bucket.push(workflow);
      } else {
        map.set(workflow.directory, [workflow]);
      }
    });

    const groups = Array.from(map.entries()).map(([directory, items]) => ({
      directory,
      workflows: [...items].sort((a, b) => {
        const aMeta = getWorkflowDisplayMeta(a.representative);
        const bMeta = getWorkflowDisplayMeta(b.representative);
        return aMeta.sortKey.localeCompare(bMeta.sortKey, 'zh-CN');
      }),
    }));

    return groups.sort((a, b) => {
      if (a.directory === ROOT_WORKFLOW_GROUP && b.directory !== ROOT_WORKFLOW_GROUP) return 1;
      if (b.directory === ROOT_WORKFLOW_GROUP && a.directory !== ROOT_WORKFLOW_GROUP) return -1;
      return a.directory.localeCompare(b.directory, 'zh-CN');
    });
  }, [groupedWorkflows]);

  const selectedGroupedWorkflow = useMemo(() => {
    if (!selectedWorkflow) {
      return null;
    }

    const workflowKey = selectedWorkflow.path || selectedWorkflow.name;
    return groupedWorkflows.find((group) =>
      group.variants.some((variant) => (variant.workflow.path || variant.workflow.name) === workflowKey)
    ) ?? null;
  }, [groupedWorkflows, selectedWorkflow]);

  const selectedWorkflowMeta = selectedWorkflow ? getWorkflowDisplayMeta(selectedWorkflow) : null;
  const selectedWorkflowDisplayName = selectedGroupedWorkflow?.name ?? selectedWorkflowMeta?.fileLabel ?? null;
  const selectedWorkflowDirectory = selectedGroupedWorkflow?.directory ?? selectedWorkflowMeta?.directory ?? null;
  const selectedWorkflowImageLimit = selectedGroupedWorkflow?.maxImageCount ?? workflowImageInputs.length;

  const renderTextControl = ({
    key,
    label,
    value,
    onChange,
    placeholder,
    isLongText,
    required = false,
    promptActions,
  }: {
    key: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    isLongText: boolean;
    required?: boolean;
    promptActions?: {
      storageKey: string;
      onOpenHistory: () => void;
      onOpenCustom: () => void;
      onSaveCustom: () => void;
    };
  }) => (
    <div key={key} className={`form-field${isLongText ? ' long-text-field' : ''}`}>
      <div className="field-label">{label}{required && <span className="required-mark">*</span>}</div>
      {isLongText ? (
        <textarea
          className="text-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
        />
      ) : (
        <input
          type="text"
          className="text-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {promptActions && (
        <div className="prompt-library-actions">
          <button type="button" className="prompt-library-btn" onClick={promptActions.onOpenHistory}>
            历史
          </button>
          <button type="button" className="prompt-library-btn" onClick={promptActions.onOpenCustom}>
            自定义
          </button>
          <button
            type="button"
            className="prompt-library-btn prompt-library-btn-primary"
            onClick={promptActions.onSaveCustom}
            disabled={value.trim() === ''}
          >
            {recentlySavedPromptKey === promptActions.storageKey ? '已保存' : '保存'}
          </button>
        </div>
      )}
    </div>
  );

  const renderInput = (input: WorkflowInput) => {
    const value = inputValues[input.name] ?? input.default ?? '';

    switch (input.type) {
      case 'text': {
        // If field has options, render as select dropdown
        if (input.options && input.options.length > 0) {
          return (
            <div key={input.name} className="form-field">
              <div className="field-label">{input.label}</div>
              <select
                className="workflow-select"
                value={String(value)}
                onChange={(e) => handleInputChange(input.name, e.target.value)}
              >
                {input.options.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                ))}
              </select>
            </div>
          );
        }
        const isLongText = isLongTextWorkflowField(input);
        const isPromptField = isPromptWorkflowField(input);
        const promptLibraryKey = buildWorkflowPromptLibraryKey(input);
        console.log('[Draw] text input:', {
          name: input.name,
          label: input.label,
          classType: input.classType,
          isLongText,
          prompt: isPromptField,
        });
        return renderTextControl({
          key: input.name,
          label: input.label,
          value: String(value),
          onChange: (nextValue) => handleInputChange(input.name, nextValue),
          placeholder: input.description || `输入${input.label}...`,
          isLongText,
          required: input.required,
          promptActions: isPromptField
            ? {
                storageKey: promptLibraryKey,
                onOpenHistory: () => openPromptLibraryModal('history', promptLibraryKey, input.label, (text) => {
                  handleInputChange(input.name, text);
                }),
                onOpenCustom: () => openPromptLibraryModal('custom', promptLibraryKey, input.label, (text) => {
                  handleInputChange(input.name, text);
                }),
                onSaveCustom: () => savePromptToCustomLibrary(promptLibraryKey, String(value)),
              }
            : undefined,
        });
      }

      case 'number':
        {
          const numericValue = typeof value === 'number' ? value : Number(value || 0);
          const isSeedField = input.name.toLowerCase().includes('seed');

          if (isSeedField) {
            const currentSeedMode = seedModes[input.name] || 'randomize';
            return (
              <div key={input.name} className="form-field seed-field">
                <div className="field-label">
                  <span>{input.label}</span>
                  <div className="seed-control">
                    <div className="seed-mode-dropdown">
                      <button
                        type="button"
                        className="seed-mode-btn"
                        title={{
                          fixed: '固定值',
                          increment: '递增值',
                          decrement: '递减值',
                          randomize: '随机值',
                        }[currentSeedMode]}
                        onClick={() => setOpenSeedDropdown(openSeedDropdown === input.name ? null : input.name)}
                      >
                        {currentSeedMode === 'fixed' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        )}
                        {currentSeedMode === 'increment' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                        )}
                        {currentSeedMode === 'decrement' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                        )}
                        {currentSeedMode === 'randomize' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                        )}
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {openSeedDropdown === input.name && (
                        <div className="seed-mode-menu" onClick={() => setOpenSeedDropdown(null)}>
                          <button type="button" className={`seed-mode-option ${currentSeedMode === 'fixed' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [input.name]: 'fixed' })); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                            <span>固定值</span>
                          </button>
                          <button type="button" className={`seed-mode-option ${currentSeedMode === 'increment' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [input.name]: 'increment' })); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                            <span>递增值</span>
                          </button>
                          <button type="button" className={`seed-mode-option ${currentSeedMode === 'decrement' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [input.name]: 'decrement' })); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                            <span>递减值</span>
                          </button>
                          <button type="button" className={`seed-mode-option ${currentSeedMode === 'randomize' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [input.name]: 'randomize' })); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                            <span>随机值</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      className="seed-input"
                      value={numericValue}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '' || raw === '-') return;
                        const v = Number(raw);
                        if (!Number.isNaN(v)) handleInputChange(input.name, v);
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          }

          const min = typeof input.min === 'number' ? input.min : 0;
          const step = typeof input.step === 'number' && input.step > 0 ? input.step : 1;
          const max = typeof input.max === 'number'
            ? input.max
            : Math.max(min + step * 100, numericValue + step * 10);
          const sliderValue = Math.min(max, Math.max(min, numericValue));

        return (
            <div key={input.name} className="form-field slider-field">
              <div className="field-label">
                <span>{input.label}</span>
                <div className="number-stepper">
                  <button
                    type="button"
                    className="stepper-btn stepper-minus"
                    onClick={() => {
                      const next = Math.max(min, sliderValue - step);
                      handleInputChange(input.name, next);
                    }}
                    disabled={sliderValue <= min}
                  >−</button>
                  <input
                    type="number"
                    className="stepper-input"
                    value={sliderValue}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') return;
                      const v = Number(raw);
                      if (!Number.isNaN(v)) handleInputChange(input.name, v);
                    }}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      const clamped = Number.isNaN(v) ? min : Math.min(max, Math.max(min, v));
                      handleInputChange(input.name, clamped);
                    }}
                    step={step}
                  />
                  <button
                    type="button"
                    className="stepper-btn stepper-plus"
                    onClick={() => {
                      const next = Math.min(max, sliderValue + step);
                      handleInputChange(input.name, next);
                    }}
                    disabled={sliderValue >= max}
                  >+</button>
                </div>
              </div>
              <input
                type="range"
                className="range-track"
                value={sliderValue}
                onChange={(e) => handleInputChange(input.name, Number(e.target.value))}
                min={min}
                max={max}
                step={step}
              />
            </div>
          );
        }

      case 'select':
        return (
          <div key={input.name} className="form-field">
            <label>{input.label}</label>
            <select
              value={value as string}
              onChange={(e) => handleInputChange(input.name, e.target.value)}
            >
              {input.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        );

      case 'boolean':
        return (
          <div key={input.name} className="toggle-wrap">
            <span className="toggle-label">{input.label}</span>
            <button
              type="button"
              className={`toggle ${Boolean(value) ? 'on' : ''}`}
              onClick={() => handleInputChange(input.name, !Boolean(value))}
            />
          </div>
        );

      case 'image':
        return (
          <div key={input.name} className="form-field image-field">
            {input.label !== '参考图片' && <label>{input.label}</label>}
            <div className="image-upload-area">
              {uploadedImagePreviews[input.name] && (
                <div className="image-preview-container">
                  <img
                    src={Array.isArray(uploadedImagePreviews[input.name]) ? (uploadedImagePreviews[input.name] as string[])[0] : (uploadedImagePreviews[input.name] as string)}
                    alt="上传预览"
                    className="image-preview"
                    data-prompt-reverse
                  />
                  <div className="image-preview-info">
                    <span className="image-filename">{inputValues[input.name] as string}</span>
                    <button
                      type="button"
                      className="remove-image-btn"
                      onClick={() => {
                        handleInputChange(input.name, '');
                        setUploadedImagePreviews(prev => {
                          const next = { ...prev };
                          delete next[input.name];
                          return next;
                        });
                      }}
                    >
                      移除
                    </button>
                  </div>
                </div>
              )}
              <div className="image-upload-actions">
                {isUXPWebView() && (
                  <PsExportButton
                    mode="layer"
                    label="上传图层"
                    fullWidth
                    onExport={(blob) => handlePsExportToWorkflow(blob, input.name)}
                    onError={(err) => console.error('Layer export error:', err)}
                  />
                )}
                {isUXPWebView() && (
                  <PsExportButton
                    mode="selection"
                    label="上传选区"
                    fullWidth
                    onExport={(blob) => handlePsExportToWorkflow(blob, input.name)}
                    onError={(err) => console.error('Selection export error:', err)}
                  />
                )}
                <label className="image-upload-local-btn">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        try {
                          console.log('[Draw] 开始上传图片到 ComfyUI:', file.name);
                          const uploadedName = await uploadImageFileToInput(file, input.name);
                          console.log('[Draw] 上传成功，文件名:', uploadedName);
                        } catch (error) {
                          console.error('[Draw] 上传图片失败:', error);
                          alert(`上传图片失败: ${error instanceof Error ? error.message : '未知错误'}`);
                        }
                      }
                    }}
                  />
                  <span>上传本地图片</span>
                </label>
              </div>
            </div>
            {invalidImageRefs.has(input.name) && (
              <div className="image-ref-warning">
                图片引用已失效，请重新上传
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="draw-page">
      {/* Queue status moved to global topbar (App.tsx). Draw page starts directly with viewer/picker modals + control panel. */}

      {isViewerOpen && activeOutput?.previewUrl && (
        <div className="draw-viewer-overlay" onClick={closeOutputViewer}>
          <div className="draw-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="draw-viewer-header">
              <span>输出预览 {activeOutputIndex + 1} / {outputImages.length}</span>
              <button type="button" className="btn-close-viewer" onClick={closeOutputViewer}>
                关闭
              </button>
            </div>
            <div className="draw-viewer-body">
              <img src={activeOutput.previewUrl} alt={`viewer-output-${activeOutputIndex + 1}`} data-prompt-reverse {...(activeOutput.assetId ? { 'data-asset-id': activeOutput.assetId } : {})} />
            </div>
            {outputImages.length > 1 && (
              <div className="draw-viewer-controls">
                <button type="button" onClick={showPreviousOutput}>上一张</button>
                <button type="button" onClick={showNextOutput}>下一张</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isWorkflowPickerOpen && (
        <div className="workflow-toolkit-overlay" onClick={() => setIsWorkflowPickerOpen(false)}>
          <div className="workflow-toolkit-modal" onClick={(event) => event.stopPropagation()}>
            <div className="workflow-toolkit-header">
              <div>
                <h4>工具集</h4>
              </div>
              <button
                type="button"
                className="workflow-toolkit-close"
                onClick={() => setIsWorkflowPickerOpen(false)}
              >
                关闭
              </button>
            </div>

            {workflowGroups.length === 0 ? (
              <div className="workflow-toolkit-empty">当前没有可用工作流</div>
            ) : (
              <div className="workflow-toolkit-body">
                {workflowGroups.map((group) => (
                  <section key={group.directory} className="workflow-toolkit-group">
                    <header>
                      <h5>{group.directory}</h5>
                      <span>{group.workflows.length} 个</span>
                    </header>
                    <div className="workflow-toolkit-grid">
                      {group.workflows.map((workflowGroup) => {
                        const isActive = selectedGroupedWorkflow?.key === workflowGroup.key;
                        const variantLabel = workflowGroup.usesImageCountVariants
                          ? workflowGroup.variants
                              .map((variant) => variant.imageCount)
                              .filter((count): count is number => count !== null)
                              .join(' / ')
                          : '';
                        return (
                          <button
                            key={workflowGroup.key}
                            type="button"
                            className={`workflow-toolkit-item ${isActive ? 'active' : ''}`}
                            onClick={() => {
                              handleWorkflowSelect(workflowGroup.representative);
                              setIsWorkflowPickerOpen(false);
                            }}
                          >
                            <span className="workflow-item-name">{workflowGroup.name}</span>
                            {variantLabel && (
                              <span className="workflow-item-meta">{variantLabel} 图</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lower Section: Control Panel */}
      <div className="control-panel">
        {/* Workflow/Template Selector */}
        <div className="control-section workflow-selector">
          <div className="section-label">
            {connectionMode === 'cluster' ? '模板' : '工作流'}
          </div>

          {connectionMode === 'cluster' ? (
            // Cluster Mode: Template selector per D-04, D-05
            <>
              {!isLemonGridConnected ? (
                // Per D-15: Block until connected
                <div className="workflow-notice">
                  <span className="notice-icon">⚠️</span>
                  <p>请先在设置中连接 LemonGrid</p>
                </div>
              ) : (
                <>
                  <div className="workflow-dropdown" ref={templatePickerRef}>
                    <button
                      type="button"
                      className="workflow-picker-trigger template-picker-trigger"
                      onClick={() => setIsTemplatePickerOpen((open) => !open)}
                      disabled={isLoadingTemplates || clusterTemplates.length === 0}
                      aria-haspopup="listbox"
                      aria-expanded={isTemplatePickerOpen}
                    >
                      <span className="workflow-picker-title">
                        {selectedTemplateDisplayName || (isLoadingTemplates ? '加载模板中...' : '选择模板')}
                      </span>
                      <span className="workflow-picker-subtitle">
                        {selectedTemplate?.template_type === 'THIRD_PARTY_API' ? '云端模型' : '工作流模板'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="workflow-refresh-btn"
                      onClick={async () => {
                        if (!lemonGridServerUrl) return;
                        setIsLoadingTemplates(true);
                        try {
                          const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
                          const templates = await client.listTemplates({ status_filter: 'ACTIVE', page_size: 100 });
                          setClusterTemplates(templates);
                        } catch (error) {
                          console.error('[Draw] Failed to refresh templates:', error);
                        } finally {
                          setIsLoadingTemplates(false);
                        }
                      }}
                      disabled={isLoadingTemplates}
                      title="刷新模板列表"
                    >
                      {isLoadingTemplates ? '...' : '\u21BB'}
                    </button>
                    {isTemplatePickerOpen && (
                      <div className="template-picker-panel" role="listbox">
                        <div className="template-picker-columns">
                          <section className="template-picker-column">
                            <header className="template-picker-column-header">工作流模板</header>
                            <div className="template-picker-column-body">
                              {groupedClusterWorkflowTemplates.length === 0 ? (
                                <div className="template-picker-empty">暂无可用工作流模板</div>
                              ) : (
                                <div className="template-picker-group">
                                  <div className="template-picker-list">
                                    {groupedClusterWorkflowTemplates.map((templateGroup) => (
                                      <button
                                        key={templateGroup.key}
                                        type="button"
                                        className={`template-picker-item ${selectedTemplateGroupKey === templateGroup.key ? 'active' : ''}`}
                                        onClick={() => handleGroupedTemplateSelect(templateGroup)}
                                      >
                                        {templateGroup.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </section>
                          <section className="template-picker-column">
                            <header className="template-picker-column-header">云端模型</header>
                            <div className="template-picker-column-body">
                              {clusterCloudTemplateGroups.length === 0 ? (
                                <div className="template-picker-empty">暂无可用云端模型</div>
                              ) : (
                                clusterCloudTemplateGroups.map((group) => (
                                  <div key={`cloud-${group.category}`} className="template-picker-group">
                                    <div className="template-picker-list">
                                      {group.templates.map((template) => (
                                        <button
                                          key={template.id}
                                          type="button"
                                          className={`template-picker-item ${selectedTemplate?.id === template.id ? 'active' : ''}`}
                                          onClick={() => handleTemplateSelect(template, null)}
                                        >
                                          {template.name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </section>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Per D-11: Show template thumbnail */}
                  {selectedTemplate?.thumbnail_url && (
                    <div className="template-thumbnail">
                      <img src={selectedTemplate.thumbnail_url} alt={selectedTemplate.name} />
                    </div>
                  )}
                  {/* Per D-12: Show template description */}
                  {selectedTemplate && (
                    <div className="template-description">
                      <p className="template-desc-text">{selectedTemplate.description}</p>
                      {selectedTemplate.help_text && (
                        <p className="template-help-text">{selectedTemplate.help_text}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            // Direct Mode: Existing workflow selector (unchanged)
            <>
              {!comfyUISettings.isConnected ? (
                <div className="workflow-notice">
                  <span className="notice-icon">⚠️</span>
                  <p>请先在设置页面连接ComfyUI</p>
                </div>
              ) : (
                <>
                  <div className="workflow-dropdown">
                    <button
                      type="button"
                      className="workflow-picker-trigger"
                      onClick={() => setIsWorkflowPickerOpen(true)}
                      disabled={isLoadingWorkflows || workflowGroups.length === 0}
                    >
                      <span className="workflow-picker-title">
                        {isLoadingWorkflows
                          ? '加载工作流中...'
                          : selectedWorkflowDisplayName
                            ? selectedWorkflowDisplayName
                            : '选择工作流'}
                      </span>
                      <span className="workflow-picker-subtitle">
                        {selectedWorkflowDirectory
                          ? `${selectedWorkflowDirectory}`
                          : '点击打开工具集面板'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="workflow-refresh-btn"
                      onClick={fetchWorkflows}
                      disabled={isLoadingWorkflows}
                      title="刷新工作流列表"
                    >
                      {isLoadingWorkflows ? '...' : '\u21BB'}
                    </button>
                  </div>

                  {workflowError && (
                    <div className="workflow-error">
                      <span className="error-icon">⚠</span>
                      {workflowError}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Dynamic Form + Generate */}
        <div className="control-section dynamic-form">
          <div className="section-label">
            参考图片
            {connectionMode !== 'cluster' && selectedWorkflow && (
              <span className="section-label-note">
                {workflowImageInputs.length > 0
                  ? `当前工作流最多 ${selectedWorkflowImageLimit} 张，已上传 ${filledWorkflowImageCount} 张`
                  : '当前工作流无图片输入节点'}
              </span>
            )}
          </div>

          {connectionMode === 'cluster' ? (
            // Cluster Mode: Dynamic parameter UI from param_schema per D-02, D-09
            <>
              {!selectedTemplate ? (
                <div className="form-placeholder">
                  <span className="placeholder-icon">📝</span>
                  <p>请先选择一个模板</p>
                </div>
              ) : visibleTemplateFields.length === 0 ? (
                <div className="form-placeholder">
                  <span className="placeholder-icon">✓</span>
                  <p>此模板无需配置参数</p>
                </div>
              ) : (
                <div className="form-fields" key={selectedTemplate.id}>
                  {templateImageFields.length > 0 && (
                    <div key={`${selectedTemplate.id}-image-group`} className="form-field image-field">
                      <div className="field-label">
                        参考图片
                        <span className="section-label-note">
                          {`已上传 ${uploadedTemplateImageItems.length}/${selectedTemplate?.template_type === 'THIRD_PARTY_API' ? templateImageSlots.length : selectedTemplateGroup?.maxImageCount ?? templateImageSlots.length} 张`}
                        </span>
                      </div>
                      <div className="image-upload-area multi-image-area">
                        {uploadedTemplateImageItems.length > 0 && (
                          <div className="multi-image-list">
                            {uploadedTemplateImageItems.map((item) => (
                              <div
                                key={item.slotKey}
                                className={`multi-image-item${draggingTemplateImageFieldKey === item.slotKey ? ' dragging' : ''}${templateImageDropTargetKey === item.slotKey ? ' drop-target' : ''}${item.isUploading ? ' uploading' : ''}`}
                                draggable={!item.isUploading}
                                onDragStart={(event) => {
                                  if (item.isUploading) {
                                    event.preventDefault();
                                    return;
                                  }
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', item.slotKey);
                                  setDraggingTemplateImageFieldKey(item.slotKey);
                                  setTemplateImageDropTargetKey(item.slotKey);
                                }}
                                onDragOver={(event) => {
                                  if (!draggingTemplateImageFieldKey || draggingTemplateImageFieldKey === item.slotKey || item.isUploading) {
                                    return;
                                  }
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = 'move';
                                  if (templateImageDropTargetKey !== item.slotKey) {
                                    setTemplateImageDropTargetKey(item.slotKey);
                                  }
                                }}
                                onDragLeave={() => {
                                  if (templateImageDropTargetKey === item.slotKey && draggingTemplateImageFieldKey !== item.slotKey) {
                                    setTemplateImageDropTargetKey(null);
                                  }
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const sourceSlotKey = event.dataTransfer.getData('text/plain') || draggingTemplateImageFieldKey;
                                  if (!sourceSlotKey || sourceSlotKey === item.slotKey || item.isUploading) {
                                    setDraggingTemplateImageFieldKey(null);
                                    setTemplateImageDropTargetKey(null);
                                    return;
                                  }
                                  handleTemplateImageReorder(sourceSlotKey, item.slotKey);
                                  setDraggingTemplateImageFieldKey(null);
                                  setTemplateImageDropTargetKey(null);
                                }}
                                onDragEnd={() => {
                                  setDraggingTemplateImageFieldKey(null);
                                  setTemplateImageDropTargetKey(null);
                                }}
                                title={item.isUploading ? '上传中，暂不可拖动' : '拖动可调换映射位置'}
                              >
                                {item.isUploading && !item.previewUrl ? (
                                  <div className="multi-image-uploading" aria-label="上传中">
                                    <div className="spinner" />
                                  </div>
                                ) : (
                                  <img src={item.previewUrl} alt={`图片 ${item.index + 1}`} className="multi-image-preview" />
                                )}
                                {!item.isUploading && (
                                  <button
                                    type="button"
                                    className="multi-image-remove"
                                    onClick={() => handleTemplateImageRemove(item.slotKey)}
                                    title="移除"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <line x1="18" y1="6" x2="6" y2="18" />
                                      <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                  </button>
                                )}
                                <span className="multi-image-name">{item.isUploading ? '上传中…' : (item.filename || `图片 ${item.index + 1}`)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="image-upload-actions">
                          {isUXPWebView() && (
                            <PsExportButton
                              mode="layer"
                              label="上传图层"
                              fullWidth
                              onExport={(blob) => {
                                const file = new File([blob], `ps-export-${Date.now()}.png`, { type: 'image/png' });
                                handleTemplateCombinedImageUpload(file).catch((error) => {
                                  console.error('[Draw] 上传图片到 LemonGrid 失败:', error);
                                  alert(error instanceof Error ? error.message : '上传图片失败');
                                });
                              }}
                              onError={(err) => console.error('Layer export error:', err)}
                            />
                          )}
                          {isUXPWebView() && (
                            <PsExportButton
                              mode="selection"
                              label="上传选区"
                              fullWidth
                              onExport={(blob) => {
                                const file = new File([blob], `ps-export-${Date.now()}.png`, { type: 'image/png' });
                                handleTemplateCombinedImageUpload(file).catch((error) => {
                                  console.error('[Draw] 上传图片到 LemonGrid 失败:', error);
                                  alert(error instanceof Error ? error.message : '上传图片失败');
                                });
                              }}
                              onError={(err) => console.error('Selection export error:', err)}
                            />
                          )}
                          <label className="image-upload-local-btn">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  try {
                                    await handleTemplateCombinedImageUpload(file);
                                  } catch (error) {
                                    console.error('[Draw] 上传图片到 LemonGrid 失败:', error);
                                    alert(error instanceof Error ? error.message : '上传图片失败');
                                  }
                                }
                                e.target.value = '';
                              }}
                            />
                            <span>上传本地图片</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                  {templateNonImageFields.map((field) => {
                    const fieldKey = getTemplateFieldStateKey(field);
                    const value = templateParams[fieldKey] ?? renderParamDefault(field);

                    // Per D-09: Render inputs based on param_schema type
                    switch (field.type) {
                      case 'text': {
                        // If field has options, render as select dropdown
                        if (field.options && field.options.length > 0) {
                          return (
                            <div key={fieldKey} className="form-field">
                              <div className="field-label">{field.label}{field.required && <span className="required-mark">*</span>}</div>
                              <select
                                className="workflow-select"
                                value={String(value)}
                                onChange={(e) => handleTemplateParamChange(fieldKey, e.target.value)}
                              >
                                {field.options.map((opt) => (
                                  <option key={String(opt.value)} value={String(opt.value)}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }
                        const isPromptField = isPromptTemplateField(field);
                        const promptLibraryKey = buildTemplatePromptLibraryKey(field);
                        return renderTextControl({
                          key: fieldKey,
                          label: field.label,
                          value: String(value),
                          onChange: (nextValue) => handleTemplateParamChange(fieldKey, nextValue),
                          placeholder: field.description || `输入${field.label}...`,
                          isLongText: isPromptField,
                          required: field.required,
                          promptActions: isPromptField
                            ? {
                                storageKey: promptLibraryKey,
                                onOpenHistory: () => openPromptLibraryModal('history', promptLibraryKey, field.label, (text) => {
                                  handleTemplateParamChange(fieldKey, text);
                                }),
                                onOpenCustom: () => openPromptLibraryModal('custom', promptLibraryKey, field.label, (text) => {
                                  handleTemplateParamChange(fieldKey, text);
                                }),
                                onSaveCustom: () => savePromptToCustomLibrary(promptLibraryKey, String(value)),
                              }
                            : undefined,
                        });
                      }

                      case 'number': {
                        const numericValue = typeof value === 'number' ? value : Number(value || 0);
                        const isSeedField = field.name.toLowerCase().includes('seed');

                        if (isSeedField) {
                          const currentSeedMode = seedModes[fieldKey] || 'randomize';
                          return (
                            <div key={fieldKey} className="form-field seed-field">
                              <div className="field-label">
                                <span>{field.label}{field.required && <span className="required-mark">*</span>}</span>
                                <div className="seed-control">
                                  <div className="seed-mode-dropdown">
                                    <button
                                      type="button"
                                      className="seed-mode-btn"
                                      title={{
                                        fixed: '固定值',
                                        increment: '递增值',
                                        decrement: '递减值',
                                        randomize: '随机值',
                                      }[currentSeedMode]}
                                      onClick={() => setOpenSeedDropdown(openSeedDropdown === fieldKey ? null : fieldKey)}
                                    >
                                      {currentSeedMode === 'fixed' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                      )}
                                      {currentSeedMode === 'increment' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                                      )}
                                      {currentSeedMode === 'decrement' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                                      )}
                                      {currentSeedMode === 'randomize' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                                      )}
                                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>
                                    {openSeedDropdown === fieldKey && (
                                      <div className="seed-mode-menu" onClick={() => setOpenSeedDropdown(null)}>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'fixed' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'fixed' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                          <span>固定值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'increment' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'increment' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                                          <span>递增值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'decrement' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'decrement' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                                          <span>递减值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'randomize' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'randomize' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                                          <span>随机值</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <input
                                    type="number"
                                    className="seed-input"
                                    value={numericValue}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      if (raw === '' || raw === '-') return;
                                      const v = Number(raw);
                                      if (!Number.isNaN(v)) handleTemplateParamChange(fieldKey, v);
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        }

                        const min = typeof field.min === 'number' ? field.min : 0;
                        const step = typeof field.step === 'number' && field.step > 0 ? field.step : 1;
                        const max = typeof field.max === 'number'
                          ? field.max
                          : Math.max(min + step * 100, numericValue + step * 10);
                        const sliderValue = Math.min(max, Math.max(min, numericValue));
                        return (
                          <div key={fieldKey} className="form-field slider-field">
                            <div className="field-label">
                              <span>{field.label}{field.required && <span className="required-mark">*</span>}</span>
                              <div className="number-stepper">
                                <button
                                  type="button"
                                  className="stepper-btn stepper-minus"
                                  onClick={() => {
                                    const next = Math.max(min, sliderValue - step);
                                    handleTemplateParamChange(fieldKey, next);
                                  }}
                                  disabled={sliderValue <= min}
                                >−</button>
                                <input
                                  type="number"
                                  className="stepper-input"
                                  value={sliderValue}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === '' || raw === '-') return;
                                    const v = Number(raw);
                                    if (!Number.isNaN(v)) handleTemplateParamChange(fieldKey, v);
                                  }}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value);
                                    const clamped = Number.isNaN(v) ? min : Math.min(max, Math.max(min, v));
                                    handleTemplateParamChange(fieldKey, clamped);
                                  }}
                                  step={step}
                                />
                                <button
                                  type="button"
                                  className="stepper-btn stepper-plus"
                                  onClick={() => {
                                    const next = Math.min(max, sliderValue + step);
                                    handleTemplateParamChange(fieldKey, next);
                                  }}
                                  disabled={sliderValue >= max}
                                >+</button>
                              </div>
                            </div>
                            <input
                              type="range"
                              className="range-track"
                              value={sliderValue}
                              onChange={(e) => handleTemplateParamChange(fieldKey, Number(e.target.value))}
                              min={min}
                              max={max}
                              step={step}
                            />
                          </div>
                        );
                      }

                      case 'slider': {
                        const sliderValue = typeof value === 'number' ? value : Number(value || 0);
                        const isSeedField = field.name.toLowerCase().includes('seed');

                        if (isSeedField) {
                          const currentSeedMode = seedModes[fieldKey] || 'randomize';
                          return (
                            <div key={fieldKey} className="form-field seed-field">
                              <div className="field-label">
                                <span>{field.label}{field.required && <span className="required-mark">*</span>}</span>
                                <div className="seed-control">
                                  <div className="seed-mode-dropdown">
                                    <button
                                      type="button"
                                      className="seed-mode-btn"
                                      title={{
                                        fixed: '固定值',
                                        increment: '递增值',
                                        decrement: '递减值',
                                        randomize: '随机值',
                                      }[currentSeedMode]}
                                      onClick={() => setOpenSeedDropdown(openSeedDropdown === fieldKey ? null : fieldKey)}
                                    >
                                      {currentSeedMode === 'fixed' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                      )}
                                      {currentSeedMode === 'increment' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                                      )}
                                      {currentSeedMode === 'decrement' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                                      )}
                                      {currentSeedMode === 'randomize' && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                                      )}
                                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                                    </button>
                                    {openSeedDropdown === fieldKey && (
                                      <div className="seed-mode-menu" onClick={() => setOpenSeedDropdown(null)}>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'fixed' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'fixed' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                          <span>固定值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'increment' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'increment' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                                          <span>递增值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'decrement' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'decrement' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                                          <span>递减值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'randomize' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [fieldKey]: 'randomize' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                                          <span>随机值</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <input
                                    type="number"
                                    className="seed-input"
                                    value={sliderValue}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      if (raw === '' || raw === '-') return;
                                      const v = Number(raw);
                                      if (!Number.isNaN(v)) handleTemplateParamChange(fieldKey, v);
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        }

                        const min = typeof field.min === 'number' ? field.min : 0;
                        const step = typeof field.step === 'number' && field.step > 0 ? field.step : 1;
                        const max = typeof field.max === 'number'
                          ? field.max
                          : Math.max(min + step * 100, sliderValue + step * 10);
                        const clampedValue = Math.min(max, Math.max(min, sliderValue));
                        return (
                          <div key={fieldKey} className="form-field slider-field">
                            <div className="field-label">
                              <span>{field.label}{field.required && <span className="required-mark">*</span>}</span>
                              <div className="number-stepper">
                                <button
                                  type="button"
                                  className="stepper-btn stepper-minus"
                                  onClick={() => {
                                    const next = Math.max(min, clampedValue - step);
                                    handleTemplateParamChange(fieldKey, next);
                                  }}
                                  disabled={clampedValue <= min}
                                >−</button>
                                <input
                                  type="number"
                                  className="stepper-input"
                                  value={clampedValue}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === '' || raw === '-') return;
                                    const v = Number(raw);
                                    if (!Number.isNaN(v)) handleTemplateParamChange(fieldKey, v);
                                  }}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value);
                                    const clamped = Number.isNaN(v) ? min : Math.min(max, Math.max(min, v));
                                    handleTemplateParamChange(fieldKey, clamped);
                                  }}
                                  step={step}
                                />
                                <button
                                  type="button"
                                  className="stepper-btn stepper-plus"
                                  onClick={() => {
                                    const next = Math.min(max, clampedValue + step);
                                    handleTemplateParamChange(fieldKey, next);
                                  }}
                                  disabled={clampedValue >= max}
                                >+</button>
                              </div>
                            </div>
                            <input
                              type="range"
                              className="range-track"
                              value={clampedValue}
                              onChange={(e) => handleTemplateParamChange(fieldKey, Number(e.target.value))}
                              min={min}
                              max={max}
                              step={step}
                            />
                          </div>
                        );
                      }

                      case 'select':
                        return (
                          <div key={fieldKey} className="form-field">
                            <label>{field.label}{field.required && <span className="required-mark">*</span>}</label>
                            <select
                              value={String(value)}
                              onChange={(e) => handleTemplateParamChange(fieldKey, e.target.value)}
                            >
                              {field.options?.map((opt) => (
                                <option key={String(opt.value)} value={String(opt.value)}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );

                      case 'boolean':
                        return (
                          <div key={fieldKey} className="toggle-wrap">
                            <span className="toggle-label">{field.label}{field.required && <span className="required-mark">*</span>}</span>
                            <button
                              type="button"
                              className={`toggle ${Boolean(value) ? 'on' : ''}`}
                              onClick={() => handleTemplateParamChange(fieldKey, !Boolean(value))}
                            />
                          </div>
                        );

                      default:
                        return null;
                    }
                  })}
                </div>
              )}
            </>
          ) : (
            // Direct Mode: Existing form rendering (unchanged)
            <>
              {!selectedWorkflow ? (
                <div className="form-placeholder">
                  <span className="placeholder-icon">📝</span>
                  <p>请先选择一个工作流</p>
                </div>
              ) : workflowInputs.length === 0 ? (
                <div className="form-placeholder">
                  <span className="placeholder-icon">✓</span>
                  <p>此工作流无需配置参数</p>
                </div>
              ) : (
                <div className="form-fields">
                  {filteredInputGroups.flatMap((group) =>
                    group.items.map((input) => renderInput(input))
                  )}
                </div>
              )}
            </>
          )}
          <div className="action-buttons">
            {/* Inline generation progress (replaces removed preview-section progress bar) */}
            {progress.status !== 'idle' && (
              <div className="inline-progress">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <div className="progress-info">
                  <span className="progress-percentage">{progress.percentage}%</span>
                  {progress.currentNode && (
                    <span className="current-node">{progress.currentNode}</span>
                  )}
                </div>
                {progress.error && (
                  <div className="progress-error">
                    <span className="error-icon">⚠</span>
                    {progress.error}
                  </div>
                )}
              </div>
            )}
            <button
              className={`generate-btn ${connectionMode === 'cluster' ? (isSubmittingCluster ? 'generating' : '') : isGenerating ? 'generating' : ''}`}
              onClick={handleGenerate}
              disabled={
                connectionMode === 'cluster'
                  ? !selectedTemplate || !isLemonGridConnected || isSubmittingCluster
                  : !selectedWorkflow || isGenerating || !comfyUISettings.isConnected
              }
            >
              {connectionMode === 'cluster' ? (
                isSubmittingCluster ? (
                  <>
                    <span className="spinner"></span>
                    提交中...
                  </>
                ) : (
                  <>
                    <span className="btn-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>
                    生成图像
                  </>
                )
              ) : isGenerating ? (
                <>
                  <span className="spinner"></span>
                  生成中...
                </>
              ) : (
                <>
                  <span className="btn-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>
                  生成图像
                </>
              )}
            </button>
          </div>

          {connectionMode === 'cluster' ? (
            !isLemonGridConnected && (
              <div className="connection-notice">
                <span className="notice-icon">⚠️</span>
                <p>请先在设置中连接 LemonGrid</p>
              </div>
            )
          ) : (
            !comfyUISettings.isConnected && (
              <div className="connection-notice">
                <span className="notice-icon">⚠️</span>
                <p>请先在设置页面连接ComfyUI</p>
              </div>
            )
          )}

          {/* Per D-40, D-55: Mini task list below Generate button in Cluster Mode */}
          {connectionMode === 'cluster' && (
            <>
              {clusterSubmitError && (
                <div className="connection-notice" style={{ marginTop: '8px' }}>
                  <span className="notice-icon">⚠️</span>
                  <p>{clusterSubmitError}</p>
                </div>
              )}
              <MiniTaskList
                onRetry={handleRetryTask}
                onImportResult={handleImportClusterResult}
              />
            </>
          )}

          {/* Output thumbnails strip — compact entry into the viewer modal,
              replaces the removed 180px preview-section. Click to enlarge. */}
          {outputImages.length > 0 && (
            <div className="output-strip">
              {outputImages.map((image, index) => (
                <OutputImageItem
                  key={`draw-output-${index}`}
                  image={image}
                  index={index}
                  isActive={index === activeOutputIndex}
                  onSelect={openOutputViewer}
                  assetId={image.assetId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <PromptReverseFlow onFillPrompt={handleFillPrompt} />
      {promptLibraryModal && (
        <div className="prompt-library-modal-overlay" onClick={closePromptLibraryModal}>
          <div className="prompt-library-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="prompt-library-modal-header">
              <div>
                <h3>{promptLibraryModal.kind === 'history' ? '历史提示词' : '自定义提示词'}</h3>
                <p>{promptLibraryModal.label}</p>
              </div>
              <button
                type="button"
                className="prompt-library-modal-close"
                onClick={closePromptLibraryModal}
                title="关闭弹窗"
                aria-label="关闭弹窗"
              >
                X
              </button>
            </div>
            <div className="prompt-library-modal-body">
              {promptLibraryEntries.length === 0 ? (
                <div className="prompt-library-empty">
                  {promptLibraryModal.kind === 'history' ? '暂无历史提示词' : '暂无自定义提示词'}
                </div>
              ) : (
                <div className="prompt-library-list">
                  {promptLibraryEntries.map((entry) => (
                    <div
                      key={entry.text}
                      className="prompt-library-item"
                    >
                      <button
                        type="button"
                        className="prompt-library-item-main"
                        onClick={() => applyPromptLibraryEntry(entry.text)}
                        title="点击载入到输入框"
                      >
                        <span className="prompt-library-item-text">{entry.text}</span>
                      </button>
                      <button
                        type="button"
                        className="prompt-library-item-delete"
                        onClick={() => deletePromptLibraryEntry(entry.text)}
                        title="删除这条提示词"
                        aria-label="删除这条提示词"
                      >
                        X
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
