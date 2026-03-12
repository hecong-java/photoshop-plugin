import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ComfyUIClient, type ComfyUIWorkflowInfo, type ComfyUIHistoryEntry, type ExperimentModelCatalog } from '../services/comfyui';
import { useSettingsStore } from '../stores/settingsStore';
import { useConfigStore } from '../stores/configStore';
import { useWorkflowCacheStore, blobToBase64, base64ToBlobUrl } from '../stores/workflowCacheStore';
import { useComfyUIStore } from '../stores/comfyui';
import { PsExportButton } from '../components/upload/PsExportButton';
import { uploadToComfyUI, isUXPWebView, bridgeFetch, fileToBase64, importBase64ToPsLayer } from '../services/upload';
import './Draw.css';

// Types for workflow inputs
interface WorkflowInput {
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
}

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
}

interface WorkflowInputGroup {
  key: string;
  label: string;
  classType: string;
  items: WorkflowInput[];
}

type ComfyInputConfig = [unknown, Record<string, unknown>?] | undefined;

interface WorkflowDirectoryGroup {
  directory: string;
  workflows: ComfyUIWorkflowInfo[];
}

const SKIPPED_NODE_TYPES = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode']);
const DEFAULT_CLASS_TYPE = 'General';
const ROOT_WORKFLOW_GROUP = '根目录';
const NODE_TYPE_LABELS_ZH: Record<string, string> = {
  loadimage: '加载图片',
  saveimage: '保存图片',
  cliptextencode: '提示词编码',
  cliploader: 'CLIP 加载器',
  dualcliploader: '双 CLIP 加载器',
  unetloader: 'UNET 加载器',
  vaeloader: 'VAE 加载器',
  vaedecode: 'VAE 解码',
  vaeencode: 'VAE 编码',
  fluxguidance: 'Flux 引导',
  flux2scheduler: 'Flux 调度器',
  cfgguider: 'CFG 引导器',
  samplercustomadvanced: '高级采样器',
  ksampler: '采样器',
  ksamplerselect: '采样器选择',
  randomnoise: '随机噪声',
  getimagesize: '图像尺寸',
  emptyflux2latentimage: '空 Latent 图',
  referencelatent: '参考 Latent',
  conditioningzeroout: '条件清零',
  inpaintmodelconditioning: '局部重绘条件',
  layerutilityimagescalebyaspectratiov2: '按比例缩放',
  layermasksegmentanythingultrav2: '智能分割',
  growmaskwithblur: '蒙版扩展与模糊',
  kienanobanana2image: 'Nano Banana 2 图像',
  kienanobananaproimage: 'Nano Banana Pro 图像',
  kieseedream45edit: 'Seedream 4.5 编辑',
  sam2segment: 'SAM2 分割',
};
const INPUT_NAME_LABELS_ZH: Record<string, string> = {
  image: '图片',
  images: '图片',
  upload: '上传',
  text: '文本',
  prompt: '提示词',
  aspectratio: '宽高比',
  resolution: '分辨率',
  outputformat: '输出格式',
  googlesearch: '联网搜索',
  log: '日志',
  seed: '随机种子',
  noiseseed: '噪声种子',
  steps: '步数',
  cfg: 'CFG',
  guidance: '引导强度',
  samplername: '采样器',
  scheduler: '调度器',
  denoise: '去噪强度',
  vaename: 'VAE 模型',
  unetname: 'UNET 模型',
  clipname: 'CLIP 模型',
  model: '模型',
  sammodel: 'SAM 模型',
  groundingdinomodel: 'GroundingDINO 模型',
};

const normalizeNameKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
const containsChinese = (value: string): boolean => /[\u3400-\u9FFF]/.test(value);
const getNodeTypeChineseLabel = (nodeType: string): string | undefined => NODE_TYPE_LABELS_ZH[normalizeNameKey(nodeType)];
const getInputChineseLabel = (inputName: string): string | undefined => INPUT_NAME_LABELS_ZH[normalizeNameKey(inputName)];

const getWorkflowDisplayMeta = (workflow: ComfyUIWorkflowInfo) => {
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

const getDefaultWorkflow = (workflowList: ComfyUIWorkflowInfo[]): ComfyUIWorkflowInfo | null => {
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

interface PromptNodeInfo {
  nodeIds: Set<string>;
  nodeTypes: Set<string>;
  inputKeysByType: Map<string, Set<string>>;
}

const sanitizePromptGraph = (prompt: Record<string, unknown>): Record<string, unknown> => {
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

interface HistoryActionState {
  rerunItem?: {
    workflowName?: string;
    params?: Record<string, unknown>;
  };
  editItem?: {
    workflowName?: string;
    params?: Record<string, unknown>;
  };
}

export const Draw = () => {
  const location = useLocation();
  // Settings
  // Settings
  const comfyUISettings = useSettingsStore((state) => state.comfyUI);
  const psImportMode = useSettingsStore((state) => state.psImportMode);

  // Config store for filtering displayed nodes
  const { shouldDisplayNode, getAllowedInputs, loadConfig } = useConfigStore();

  // ComfyUI queue store
  const { queueRunning, queuePending, fetchQueue, isLoadingQueue, setBaseUrl: setComfyUIBaseUrl } = useComfyUIStore();

  // Workflows
  const [workflows, setWorkflows] = useState<ComfyUIWorkflowInfo[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ComfyUIWorkflowInfo | null>(null);
  const [workflowInputs, setWorkflowInputs] = useState<WorkflowInput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false);
  const [objectInfo, setObjectInfo] = useState<Record<string, unknown> | null>(null);
  const [experimentModels, setExperimentModels] = useState<ExperimentModelCatalog>({});
  const [isWorkflowPickerOpen, setIsWorkflowPickerOpen] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [uploadedImagePreviews, setUploadedImagePreviews] = useState<Record<string, string>>({});
  const latestInputValuesRef = useRef<Record<string, string | number | boolean>>({});
  // Refs for workflow cache - store blob and base64 data for image inputs
  const uploadedImageBlobsRef = useRef<Record<string, Blob>>({});
  const uploadedImageBase64Ref = useRef<Record<string, string>>({});
  const currentWorkflowKeyRef = useRef<string | null>(null);
  const uploadedImagePreviewsRef = useRef<Record<string, string>>({});

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
  const [, setLatestGeneratedImageBlob] = useState<Blob | null>(null);
  const [outputImages, setOutputImages] = useState<OutputImageData[]>([]);
  const [activeOutputIndex, setActiveOutputIndex] = useState(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // WebSocket for progress
  // WebSocket for progress
  const wsRef = useRef<WebSocket | null>(null);
  
  // Track if we've handled rerun/edit to avoid duplicate execution
  const hasHandledHistoryAction = useRef(false);
  const pendingRerunPromptRef = useRef<Record<string, unknown> | null>(null);

  const applyInputValuesToPrompt = (
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

      (inputs as Record<string, unknown>)[inputName] = value;
    });

    return updated;
  };

  // Fetch workflows on mount
  useEffect(() => {
    if (comfyUISettings.isConnected) {
      fetchWorkflows();
    }
  }, [comfyUISettings.isConnected]);

  useEffect(() => {
    latestInputValuesRef.current = inputValues;
  }, [inputValues]);

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

      // Cleanup all blob URLs
      Object.values(uploadedImagePreviewsRef.current).forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
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

  // Fetch queue on mount and when connection status changes
  useEffect(() => {
    if (comfyUISettings.isConnected) {
      fetchQueue().catch(console.error);
    }
  }, [comfyUISettings.isConnected, fetchQueue]);

  // Refresh queue periodically during generation
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      fetchQueue().catch(console.error);
    }, 1000);
    return () => clearInterval(interval);
  }, [isGenerating, fetchQueue]);


  const extractInputValuesFromHistoryParams = (
    params: Record<string, unknown>,
    targetInputs: WorkflowInput[]
  ) => {
    const promptData = params as Record<string, unknown>;
    const restoredValues: Record<string, string | number | boolean> = {};

    targetInputs.forEach((input) => {
      const splitIndex = input.name.lastIndexOf('_');
      if (splitIndex <= 0 || splitIndex >= input.name.length - 1) {
        return;
      }

      const inputName = input.name.slice(0, splitIndex);
      const nodeId = input.name.slice(splitIndex + 1);
      const nodeValue = promptData[nodeId];
      if (!nodeValue || typeof nodeValue !== 'object' || Array.isArray(nodeValue)) {
        return;
      }

      const nodeRecord = nodeValue as Record<string, unknown>;
      const historyClassType = nodeRecord.class_type ?? nodeRecord.type;
      if (
        typeof historyClassType === 'string' &&
        typeof input.classType === 'string' &&
        input.classType !== historyClassType
      ) {
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

      const stringCandidate = typeof candidate === 'string' ? candidate : String(candidate);
      if (input.type === 'select' && input.options && !input.options.includes(stringCandidate)) {
        return;
      }
      restoredValues[input.name] = stringCandidate;
    });

    return restoredValues;
  };

  const enforceLatestImageInputs = (
    prompt: Record<string, unknown>,
    values: Record<string, string | number | boolean>,
    inputsMeta: WorkflowInput[]
  ): Record<string, unknown> => {
    const imageInputs = inputsMeta.filter((input) => input.type === 'image');

    imageInputs.forEach((inputMeta) => {
      const rawValue = values[inputMeta.name];
      if (typeof rawValue !== 'string') {
        return;
      }

      const imageValue = rawValue.trim();
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

  const getPromptNodeInfo = (params: Record<string, unknown> | undefined): PromptNodeInfo => {
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

  const findBestMatchingWorkflow = async (
    params: Record<string, unknown> | undefined,
    workflowName?: string
  ): Promise<ComfyUIWorkflowInfo | null> => {
    if (workflows.length === 0) return null;

    if (!params || Object.keys(params).length === 0) {
      return workflows[0] ?? null;
    }

    const expected = getPromptNodeInfo(params);
    if (expected.nodeTypes.size === 0) {
      return workflows[0] ?? null;
    }

    let bestWorkflow: ComfyUIWorkflowInfo | null = null;
    let bestScore = -1;

    const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
    const prefixMode = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';

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

        if (workflowName) {
          const normalized = workflowName.trim().toLowerCase().replace(/\.json$/, '');
          const workflowLabel = workflow.name.toLowerCase().replace(/\.json$/, '');
          if (workflowLabel === normalized) {
            score += 1;
          } else if (workflowLabel.includes(normalized)) {
            score += 0;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestWorkflow = workflow;
        }
      } catch (error) {
        console.warn('[Draw] Failed to inspect workflow for history matching:', workflow.name, error);
      }
    }

    return bestWorkflow ?? workflows[0] ?? null;
  };

  // Handle rerun/edit from history
  useEffect(() => {
    if (hasHandledHistoryAction.current || workflows.length === 0 || !comfyUISettings.baseUrl) {
      return;
    }

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

    hasHandledHistoryAction.current = true;
    const shouldAutoGenerate = Boolean(state?.rerunItem || storedRerun);

    const applyHistoryAction = async () => {
      try {
        const targetWorkflow = await findBestMatchingWorkflow(historyItem.params, historyItem.workflowName);
        if (!targetWorkflow) {
          console.warn('[Draw] No workflow available for history action');
          return;
        }

        const loadedInputs = await handleWorkflowSelect(targetWorkflow);

        if (historyItem.params) {
          pendingRerunPromptRef.current = historyItem.params;
          const restored = extractInputValuesFromHistoryParams(historyItem.params, loadedInputs);
          if (Object.keys(restored).length > 0) {
            setInputValues((prev) => {
              const next = { ...prev, ...restored };
              latestInputValuesRef.current = next;
              return next;
            });
          }
        }

        if (shouldAutoGenerate) {
          setTimeout(() => {
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
  }, [location.state, workflows, comfyUISettings.baseUrl]);
  const fetchWorkflows = async () => {
    if (!comfyUISettings.isConnected) return;

    setIsLoadingWorkflows(true);
    setWorkflowError(null);

    try {
      const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
      const workflowList = await client.listWorkflows();
      setWorkflows(workflowList);

      let loadedObjectInfo: Record<string, unknown> | null = objectInfo;

      if (!objectInfo) {
        try {
          const info = await client.getObjectInfo();
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
      
      if (!selectedWorkflow) {
        const defaultWorkflow = getDefaultWorkflow(workflowList);
        if (defaultWorkflow) {
          handleWorkflowSelect(defaultWorkflow, loadedObjectInfo, Object.keys(experimentModels).length > 0 ? experimentModels : undefined);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workflows';
      setWorkflowError(message);
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

    // Clean up old blob URLs
    Object.values(uploadedImagePreviews).forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
    setUploadedImagePreviews({});

    // Clear image refs
    uploadedImageBlobsRef.current = {};
    uploadedImageBase64Ref.current = {};

    setSelectedWorkflow(workflow);
    setWorkflowInputs([]);
    setInputValues({});
    latestInputValuesRef.current = {};

    if (!comfyUISettings.isConnected) {
      console.log('[Draw] Not connected to ComfyUI, returning empty inputs');
      return [];
    }

    try {
      const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
      const prefixMode = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
      const workflowData = await client.readWorkflow(workflow.path || workflow.name, prefixMode);

      console.log('[Draw] Workflow data loaded, parsing inputs...');

      // Parse workflow inputs
      const inputs = parseWorkflowInputs(
        workflowData,
        objectInfoOverride ?? objectInfo,
        modelCatalogOverride ?? experimentModels
      );

      console.log('[Draw] Parsed inputs:', inputs.length);
      inputs.forEach(input => {
        console.log(`[Draw]   - Input: ${input.name}, type: ${input.type}, classType: ${input.classType}`);
      });

      setWorkflowInputs(inputs);

      // Try to load from cache first
      const workflowKey = workflow.path || workflow.name;
      const cached = loadCache(workflowKey);

      if (cached) {
        console.log('[Draw] Restoring from cache for:', workflowKey);
        console.log('[Draw] Cached imageData keys:', Object.keys(cached.imageData));

        // Restore input values
        const restoredValues: Record<string, string | number | boolean> = {};
        inputs.forEach(input => {
          if (cached.inputValues[input.name] !== undefined) {
            restoredValues[input.name] = cached.inputValues[input.name];
          } else if (input.default !== undefined) {
            restoredValues[input.name] = input.default;
          }
        });
        setInputValues(restoredValues);
        latestInputValuesRef.current = restoredValues;

        // Restore image previews from base64 data
        const restoredPreviews: Record<string, string> = {};
        for (const [inputName, base64] of Object.entries(cached.imageData)) {
          console.log('[Draw] Restoring image for input:', inputName, 'base64 length:', base64.length);
          const blobUrl = base64ToBlobUrl(base64);
          if (blobUrl) {
            restoredPreviews[inputName] = blobUrl;
            uploadedImageBase64Ref.current[inputName] = base64;
            console.log('[Draw] Created blob URL:', blobUrl);
          } else {
            console.warn('[Draw] Failed to create blob URL for:', inputName);
          }
        }
        console.log('[Draw] Restored previews:', Object.keys(restoredPreviews));
        setUploadedImagePreviews(restoredPreviews);
      } else {
        // Set default values if no cache
        const defaults: Record<string, string | number | boolean> = {};
        inputs.forEach(input => {
          if (input.default !== undefined) {
            defaults[input.name] = input.default;
          }
        });
        setInputValues(defaults);
        latestInputValuesRef.current = defaults;
      }

      return inputs;
    } catch (error) {
      console.error('[Draw] Failed to load workflow details:', error);
      return [];
    }
  };

  const parseWorkflowInputs = (
    workflowData: unknown,
    workflowObjectInfo: Record<string, unknown> | null = objectInfo,
    workflowModelCatalog: ExperimentModelCatalog = experimentModels
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
            inputs.push({
              name: `text_${nodeId}`,
              type: 'text',
              label: nodeDisplayName,
              default: (widgetValues?.[0] as string) || '',
            });
          }

          const widgetValueByName = buildWidgetValueByName();

          const widgets = Array.isArray(nodeData.widgets)
            ? nodeData.widgets.filter((widget) => widget && typeof widget === 'object') as Array<Record<string, unknown>>
            : [];
          widgets.forEach((widget, idx) => {
            const widgetName = typeof widget.name === 'string' ? widget.name : '';
            if (!widgetName) return;

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
              inputs.push({
                name: generatedName,
                type: 'text',
                label: resolveInputLabel(widgetName, widget.label),
                default: typeof defaultValue === 'string' ? defaultValue : (configDefault as string),
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

              const generatedName = `${inputName}_${nodeId}`;
              if (inputs.some((item) => item.name === generatedName)) return;

              const config = getInputConfig(inputName);
              const configOptions = extractOptions(config);
              const modelOptions = resolveModelOptions(inputName);
              const numericMeta = extractNumericMeta(config);
              const inputTypeTag = extractInputTypeTag(config);

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

  const handleInputChange = (name: string, value: string | number | boolean) => {
    pendingRerunPromptRef.current = null;
    setInputValues(prev => {
      const next = { ...prev, [name]: value };
      latestInputValuesRef.current = next;
      return next;
    });
  };

  const compileWorkflowToPrompt = (
    workflow: any,
    values: Record<string, string | number | boolean>
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

      prompt[nodeId] = {
        inputs,
        class_type: classType,
        _meta: { title: node.title || nodeId },
      };
    });

    return prompt;
  };

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
      setInputValues((prev) => {
        const next = {
          ...prev,
          [inputName]: uploadedName
        };
        latestInputValuesRef.current = next;
        return next;
      });
      return uploadedName;
    } catch (error) {
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

  const handleGenerate = async () => {
    if (!selectedWorkflow || !comfyUISettings.isConnected) return;

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

      const workflowData = await client.readWorkflow(selectedWorkflow.path || selectedWorkflow.name, prefixMode);
      const historyPrompt = pendingRerunPromptRef.current;
      const currentInputValues = latestInputValuesRef.current;
      const compiledPrompt = historyPrompt
        ? sanitizePromptGraph(applyInputValuesToPrompt(historyPrompt, currentInputValues))
        : compileWorkflowToPrompt(workflowData, currentInputValues);
      const finalPrompt = enforceLatestImageInputs(compiledPrompt, currentInputValues, workflowInputs);
      pendingRerunPromptRef.current = null;

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

      const fetcher = isUXPWebView() 
        ? (u: string, o: RequestInit) => bridgeFetch(u, o)
        : (u: string, o: RequestInit) => fetch.call(window, u, o);
      const response = await fetcher(`${comfyUISettings.baseUrl}${prefix}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          client_id: clientId,
        }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData?.error?.message || `HTTP ${response.status}`);
      }

      promptId = responseData.prompt_id;
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

  const openOutputViewer = (index: number) => {
    if (outputImages.length === 0) return;
    setActiveOutputIndex(index);
    setProgress((prev) => ({
      ...prev,
      previewImage: outputImages[index]?.previewUrl || prev.previewImage,
    }));
    setIsViewerOpen(true);
  };

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
  }, [inputGroups, shouldDisplayNode, getAllowedInputs]);

  const workflowGroups = useMemo<WorkflowDirectoryGroup[]>(() => {
    const files = workflows.filter((workflow) => !workflow.isDirectory);
    const map = new Map<string, ComfyUIWorkflowInfo[]>();

    files.forEach((workflow) => {
      const meta = getWorkflowDisplayMeta(workflow);
      const bucket = map.get(meta.directory);
      if (bucket) {
        bucket.push(workflow);
      } else {
        map.set(meta.directory, [workflow]);
      }
    });

    const groups = Array.from(map.entries()).map(([directory, items]) => ({
      directory,
      workflows: [...items].sort((a, b) => {
        const aMeta = getWorkflowDisplayMeta(a);
        const bMeta = getWorkflowDisplayMeta(b);
        return aMeta.sortKey.localeCompare(bMeta.sortKey, 'zh-CN');
      }),
    }));

    return groups.sort((a, b) => {
      if (a.directory === ROOT_WORKFLOW_GROUP && b.directory !== ROOT_WORKFLOW_GROUP) return 1;
      if (b.directory === ROOT_WORKFLOW_GROUP && a.directory !== ROOT_WORKFLOW_GROUP) return -1;
      return a.directory.localeCompare(b.directory, 'zh-CN');
    });
  }, [workflows]);

  const selectedWorkflowMeta = selectedWorkflow ? getWorkflowDisplayMeta(selectedWorkflow) : null;

  const renderInput = (input: WorkflowInput) => {
    const value = inputValues[input.name] ?? input.default ?? '';

    switch (input.type) {
      case 'text':
        return (
          <div key={input.name} className="form-field">
            <label>{input.label}</label>
            <textarea
              value={value as string}
              onChange={(e) => handleInputChange(input.name, e.target.value)}
              rows={4}
              placeholder={`输入${input.label}...`}
            />
          </div>
        );

      case 'number':
        {
          const numericValue = typeof value === 'number' ? value : Number(value || 0);
          const min = typeof input.min === 'number' ? input.min : 0;
          const step = typeof input.step === 'number' && input.step > 0 ? input.step : 1;
          const max = typeof input.max === 'number'
            ? input.max
            : Math.max(min + step * 100, numericValue + step * 10);
          const sliderValue = Math.min(max, Math.max(min, numericValue));

        return (
            <div key={input.name} className="form-field slider-field">
              <div className="slider-header">
                <label>{input.label}</label>
                <span className="slider-badge">{sliderValue}</span>
              </div>
              <input
                type="range"
                value={sliderValue}
                onChange={(e) => handleInputChange(input.name, Number(e.target.value))}
                min={min}
                max={max}
                step={step}
              />
              <div className="slider-meta">
                <span>{min}</span>
                <input
                  type="number"
                  value={sliderValue}
                  onChange={(e) => handleInputChange(input.name, Number(e.target.value))}
                  min={min}
                  max={max}
                  step={step}
                />
                <span>{max}</span>
              </div>
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
          <div key={input.name} className="form-field boolean-field">
            <label>{input.label}</label>
            <label className="boolean-toggle">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => handleInputChange(input.name, e.target.checked)}
              />
              <span>{Boolean(value) ? '开启' : '关闭'}</span>
            </label>
          </div>
        );

      case 'image':
        return (
          <div key={input.name} className="form-field image-field">
            <label>{input.label}</label>
            {isUXPWebView() && (
              <div className="image-upload-ps-buttons">
                <div className="image-upload-ps-item">
                  <span className="image-upload-ps-label">选区</span>
                  <PsExportButton
                    mode="selection"
                    label="从 PS 选区加载"
                    iconOnly
                    compact
                    onExport={(blob) => handlePsExportToWorkflow(blob, input.name)}
                    onError={(err) => console.error('Selection export error:', err)}
                  />
                </div>
                <div className="image-upload-ps-item">
                  <span className="image-upload-ps-label">图层</span>
                  <PsExportButton
                    mode="layer"
                    label="从 PS 图层加载"
                    iconOnly
                    compact
                    onExport={(blob) => handlePsExportToWorkflow(blob, input.name)}
                    onError={(err) => console.error('Layer export error:', err)}
                  />
                </div>
              </div>
            )}
            <div className="image-upload-area">
              {uploadedImagePreviews[input.name] ? (
                <div className="image-preview-container">
                  <img 
                    src={uploadedImagePreviews[input.name]} 
                    alt="上传预览" 
                    className="image-preview"
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
              ) : (
                <>
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
                  <span className="upload-hint">点击或拖拽上传图片</span>
                </>
              )}
            </div>
            
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="draw-page">
      {/* Upper Section: Preview Area */}
      <div className="preview-section">
        <div className="preview-header">
          <h2>预览</h2>
          {/* Queue Status Display - always show when connected */}
          {comfyUISettings.isConnected && (
            <div className="queue-status">
              <span className="queue-badge queue-running">
                <span className="queue-icon">&#9881;</span>
                {queueRunning.length}
              </span>
              <span className="queue-badge queue-pending">
                <span className="queue-icon">&#8987;</span>
                {queuePending.length}
              </span>
            </div>
          )}
          {isGenerating && (
            <span className="generating-badge">生成中...</span>
          )}
        </div>

        <div className="preview-content">
          {progress.previewImage ? (
            <img 
              src={progress.previewImage} 
              alt="Preview" 
              className="preview-image"
            />
          ) : (
            <div className="preview-placeholder">
              <div className="placeholder-icon">🖼️</div>
              <p>生成结果将在此显示</p>
            </div>
          )}
        </div>

        {outputImages.length > 1 && (
          <div className="preview-strip">
            {outputImages.map((image, index) => (
              <button
                key={`draw-output-${index}`}
                type="button"
                className={`preview-strip-item ${index === activeOutputIndex ? 'active' : ''}`}
                onClick={() => openOutputViewer(index)}
                title={`查看第 ${index + 1} 张输出`}
              >
                <img src={image.previewUrl} alt={`output-${index + 1}`} />
              </button>
            ))}
          </div>
        )}

        {/* Progress Bar */}
        {progress.status !== 'idle' && (
          <div className="progress-container">
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
      </div>

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
              <img src={activeOutput.previewUrl} alt={`viewer-output-${activeOutputIndex + 1}`} />
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
                      {group.workflows.map((workflow) => {
                        const meta = getWorkflowDisplayMeta(workflow);
                        const isActive = selectedWorkflow?.name === workflow.name;
                        return (
                          <button
                            key={workflow.path || workflow.name}
                            type="button"
                            className={`workflow-toolkit-item ${isActive ? 'active' : ''}`}
                            onClick={() => {
                              handleWorkflowSelect(workflow);
                              setIsWorkflowPickerOpen(false);
                            }}
                          >
                            <span className="workflow-item-name">{meta.fileLabel}</span>
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
        {/* Left: Workflow Selector */}
        <div className="control-section workflow-selector">
          <h3>工作流</h3>
          
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
                      : selectedWorkflowMeta
                        ? selectedWorkflowMeta.fileLabel
                        : '选择工作流'}
                  </span>
                  <span className="workflow-picker-subtitle">
                    {selectedWorkflowMeta
                      ? `${selectedWorkflowMeta.directory}`
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
        </div>

        {/* Middle: Dynamic Form */}
        <div className="control-section dynamic-form">
          <h3>参数设置</h3>
          
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
              {filteredInputGroups.map((group) => (
                <section key={group.key} className="form-group-card">
                  <header className="form-group-header">
                    <h4>{group.label}</h4>
                    <span>{group.items.length} 项</span>
                  </header>
                  <div className="form-group-fields">
                    {group.items.map((input) => renderInput(input))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Right: Generate Button + PS Operations */}
        <div className="control-section action-panel">
          <h3>操作</h3>
          
          <div className="action-buttons">
            <button
              className={`generate-btn ${isGenerating ? 'generating' : ''}`}
              onClick={handleGenerate}
              disabled={!selectedWorkflow || isGenerating || !comfyUISettings.isConnected}
            >
              {isGenerating ? (
                <>
                  <span className="spinner"></span>
                  生成中...
                </>
              ) : (
                <>
                  <span className="btn-icon">✨</span>
                  开始生成
                </>
              )}
            </button>
          </div>


          {!comfyUISettings.isConnected && (
            <div className="connection-notice">
              <span className="notice-icon">⚠️</span>
              <p>请先在设置页面连接ComfyUI</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
