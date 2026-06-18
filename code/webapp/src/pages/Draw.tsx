import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { ComfyUIClient, type ComfyUIWorkflowInfo, type ComfyUIHistoryEntry, type ExperimentModelCatalog } from '../services/comfyui';
import { useSettingsStore } from '../stores/settingsStore';
import { useConfigStore } from '../stores/configStore';
import { useWorkflowCacheStore, blobToBase64, base64ToBlobUrl } from '../stores/workflowCacheStore';
import { useComfyUIStore } from '../stores/comfyui';
import { PsExportButton } from '../components/upload/PsExportButton';
import { uploadToComfyUI, isUXPWebView, bridgeFetch, fileToBase64, importBase64ToPsLayer, sendBridgeMessage } from '../services/upload';
import { PresetToolbar } from '../components/preset/PresetToolbar';
import { usePresetStore } from '../stores/presetStore';
import type { PresetFile } from '../types/preset';
import { PromptReverseFlow } from '../components/promptReverse/PromptReverseFlow';
import { useKeyboardPassthrough } from '../hooks/useKeyboardPassthrough';
import { LemonGridClient, isImageParam, renderParamDefault, normalizeTemplateDetail, LEMONGRID_ERROR_SUGGESTIONS, type LemonGridTemplateSummary, type LemonGridTemplateDetail } from '../services/lemongrid';
import { useLemonGridStore } from '../stores/lemongridStore';
import { ensureValidToken } from '../services/lemongrid-auth';
import { LoginModal } from '../components/LoginModal';
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
  getDefaultWorkflow,
  sanitizePromptGraph,
  applyInputValuesToPrompt,
  enforceLatestImageInputs,
  extractInputValuesFromHistoryParams,
  findBestMatchingWorkflow,
  parseWorkflowInputs,
  compileWorkflowToPrompt,
} from '../services/workflowEngine';



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
  workflows: ComfyUIWorkflowInfo[];
}

interface HistoryActionState {
  rerunItem?: {
    workflowName?: string;
    imageName?: string;
    params?: Record<string, unknown>;
  };
  editItem?: {
    workflowName?: string;
    imageName?: string;
    params?: Record<string, unknown>;
  };
}

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
  const { fetchQueue, setBaseUrl: setComfyUIBaseUrl, queueRunning, queuePending } = useComfyUIStore();

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

  // Cluster Mode state per D-50, D-51
  const connectionMode = useSettingsStore((s) => s.connectionMode);
  const lemonGridStore = useLemonGridStore();
  const { isConnected: isLemonGridConnected, serverUrl: lemonGridServerUrl, showLoginModal: lgShowLoginModal, setShowLoginModal: lgSetShowLoginModal } = lemonGridStore;
  const queueSummary = useLemonGridStore((s) => s.queueSummary);

  // Template state (replaces workflow state in Cluster Mode)
  const [clusterTemplates, setClusterTemplates] = useState<LemonGridTemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<LemonGridTemplateDetail | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templateParams, setTemplateParams] = useState<Record<string, unknown>>({});
  const [templateImageInputs, setTemplateImageInputs] = useState<Record<string, string | string[]>>({});
  // Per D-24: WebSocket connection refs for per-task connections
  const wsConnectionRefs = useRef<Record<string, string>>({});
  const latestInputValuesRef = useRef<Record<string, string | number | boolean>>({});
  // Refs for workflow cache - store blob and base64 data for image inputs
  const uploadedImageBlobsRef = useRef<Record<string, Blob>>({});
  const uploadedImageBase64Ref = useRef<Record<string, string>>({});
  const currentWorkflowKeyRef = useRef<string | null>(null);
  const uploadedImagePreviewsRef = useRef<Record<string, string | string[]>>({});

  // Preset store (only what Draw.tsx uses directly; PresetToolbar accesses the store itself)
  const {
    loadPresets,
    clearSelection,
    setLastAppliedValues,
  } = usePresetStore();

  // Invalid image references tracking
  const [invalidImageRefs, setInvalidImageRefs] = useState<Set<string>>(new Set());

  // Image filenames derived from inputValues for image-type inputs
  const currentImageFilenames = useMemo(() => {
    const filenames: Record<string, string> = {};
    for (const input of workflowInputs) {
      if (input.type === 'image' && typeof inputValues[input.name] === 'string') {
        filenames[input.name] = inputValues[input.name] as string;
      }
    }
    return filenames;
  }, [workflowInputs, inputValues]);

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

  // WebSocket for progress
  // WebSocket for progress
  const wsRef = useRef<WebSocket | null>(null);
  
  // Track if we've handled rerun/edit to avoid duplicate execution
  const hasHandledHistoryAction = useRef(false);
  const pendingRerunPromptRef = useRef<Record<string, unknown> | null>(null);


  // Per D-01/D-02: Forward PS keyboard shortcuts when webview has focus
  useKeyboardPassthrough();

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

  // Cluster Mode: Load presets when template changes
  // Per D-10, D-104: Presets work per-template using template_id as key
  useEffect(() => {
    if (connectionMode !== 'cluster') return;
    if (selectedTemplate) {
      loadPresets(selectedTemplate.id);
    } else {
      clearSelection();
    }
  }, [connectionMode, selectedTemplate?.id]);

  // Per T-08-06: Clear preset selection on mode switch to prevent cross-mode data leak
  useEffect(() => {
    usePresetStore.getState().clearSelection();
  }, [connectionMode]);

  // Per D-22, D-23, D-37, D-38: WebSocket progress through Bridge + auto-fallback to polling
  useEffect(() => {
    if (connectionMode !== 'cluster') return;

    const handleWsMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'lemongrid.ws.message' && data.taskId && data.data) {
        const { taskId, data: wsData } = data as { taskId: string; data: { type: string; progress?: number; detail?: string; duration_seconds?: number; error_code?: string; error_message?: string } };
        const store = useLemonGridStore.getState();

        switch (wsData.type) {
          case 'task_started':
            store.updateTask(taskId, {
              status: 'RUNNING',
              progress: 0,
              progressDetail: '任务开始执行...',
            });
            break;
          case 'task_progress':
            store.updateTask(taskId, {
              status: 'RUNNING',
              progress: wsData.progress || 0,
              progressDetail: wsData.detail || null,
            });
            break;
          case 'task_completed':
            store.updateTask(taskId, {
              status: 'COMPLETED',
              progress: 100,
              completedAt: Date.now(),
              durationSeconds: wsData.duration_seconds || null,
            });
            // Per D-47: auto-download and import results
            handleTaskCompletion(taskId);
            break;
          case 'task_failed':
            store.updateTask(taskId, {
              status: 'FAILED',
              errorCode: wsData.error_code || 'UNKNOWN',
              errorMessage: wsData.error_message || '任务失败',
            });
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

  // Load presets when workflow changes
  useEffect(() => {
    if (selectedWorkflow) {
      const wfName = selectedWorkflow.name;
      loadPresets(wfName);
    } else {
      clearSelection();
    }
  }, [selectedWorkflow?.name]);

  // Check image reference validity on ComfyUI
  const checkImageReference = async (inputName: string, filename: string) => {
    try {
      const comfyUrl = comfyUISettings.baseUrl || 'http://127.0.0.1:8188';
      const response = await bridgeFetch(`${comfyUrl}/view?filename=${encodeURIComponent(filename)}&type=input`, { method: 'HEAD' });
      if (!response.ok) {
        setInvalidImageRefs(prev => new Set(prev).add(inputName));
      } else {
        setInvalidImageRefs(prev => {
          const next = new Set(prev);
          next.delete(inputName);
          return next;
        });
      }
    } catch {
      // Network error -- don't mark as invalid, might be transient
    }
  };

  // Apply preset values to Draw state
  const handleApplyPreset = useCallback((preset: PresetFile) => {
    const currentInputNames = new Set(workflowInputs.map(i => i.name));
    const appliedValues: Record<string, string | number | boolean> = { ...inputValues };

    for (const [key, value] of Object.entries(preset.inputValues)) {
      if (currentInputNames.has(key)) {
        appliedValues[key] = value;
      }
    }

    setInputValues(appliedValues);

    // Apply image filenames: restore uploaded image references
    for (const [inputName, filename] of Object.entries(preset.imageFilenames)) {
      if (currentInputNames.has(inputName)) {
        checkImageReference(inputName, filename);
      }
    }

    // Update cache with preset values
    if (selectedWorkflow) {
      const cacheKey = selectedWorkflow.path || selectedWorkflow.name;
      const { saveCache } = useWorkflowCacheStore.getState();
      saveCache(cacheKey, {
        inputValues: appliedValues,
        imageData: uploadedImageBase64Ref.current,
        imageFilenames: preset.imageFilenames,
      });
    }

    // Track applied values for dirty checking
    setLastAppliedValues(appliedValues, preset.imageFilenames);
  }, [workflowInputs, inputValues, selectedWorkflow, setLastAppliedValues]);






  // Handle rerun/edit from history
  useEffect(() => {
    console.log('[Draw] History useEffect triggered:', {
      hasHandledHistoryAction: hasHandledHistoryAction.current,
      workflowsLength: workflows.length,
      hasBaseUrl: !!comfyUISettings.baseUrl,
      locationState: location.state,
      sessionStorageRerun: sessionStorage.getItem('rerunItem') ? 'present' : 'empty',
      sessionStorageEdit: sessionStorage.getItem('editItem') ? 'present' : 'empty'
    });

    if (hasHandledHistoryAction.current || workflows.length === 0 || !comfyUISettings.baseUrl) {
      console.log('[Draw] History useEffect SKIPPED:', {
        reason: hasHandledHistoryAction.current ? 'already_handled' :
                workflows.length === 0 ? 'no_workflows' :
                'no_baseUrl'
      });
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
      const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
      const prefixMode: 'api' | 'oss' = comfyUISettings.prefixMode === 'api' ? 'api' : 'oss';
      try {
        console.log('[Draw] ========== HISTORY ACTION START ==========');
        console.log('[Draw] History action triggered:', {
          workflowName: historyItem.workflowName,
          imageName: historyItem.imageName,
          paramsKeys: historyItem.params ? Object.keys(historyItem.params) : 'undefined',
          shouldAutoGenerate
        });
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
            const client = new ComfyUIClient({ baseUrl: comfyUISettings.baseUrl });
            const newPreviews: Record<string, string> = {};
            for (const imgInput of imageInputs) {
              const filename = restored[imgInput.name];
              if (typeof filename === 'string' && filename.trim() !== '') {
                // Generate preview URL from ComfyUI
                const previewUrl = client.getViewUrl({
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
  }, [location.state, workflows, comfyUISettings.baseUrl]);
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
        const defaultWorkflow = getDefaultWorkflow(workflowList);
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
    Object.values(uploadedImagePreviews).forEach((url: string | string[]) => {
      const urls = Array.isArray(url) ? url : [url];
      urls.forEach(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); });
    });
    setUploadedImagePreviews({});

    // Clear image refs
    uploadedImageBlobsRef.current = {};
    uploadedImageBase64Ref.current = {};

    setSelectedWorkflow(workflow);
    selectedWorkflowRef.current = workflow;
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
      let inputs = parseWorkflowInputs(
        workflowData,
        effectiveObjectInfo,
        modelCatalogOverride ?? experimentModels
      );

      // Post-parse enrichment: for text inputs that should be selects,
      // resolve options from objectInfo using classType
      if (effectiveObjectInfo && typeof effectiveObjectInfo === 'object') {
        const oi = effectiveObjectInfo as Record<string, unknown>;
        inputs = inputs.map(input => {
          // Only enrich text inputs without options
          if (input.type !== 'text' || (input.options && input.options.length > 0)) {
            return input;
          }
          // Extract the original input name (strip _nodeId suffix)
          const splitIdx = input.name.lastIndexOf('_');
          const originalInputName = splitIdx > 0 ? input.name.slice(0, splitIdx) : input.name;
          const classType = input.classType;
          if (!classType || !originalInputName) return input;

          // Look up this node type in objectInfo
          const nodeInfo = oi[classType];
          if (!nodeInfo || typeof nodeInfo !== 'object') return input;
          const nodeInput = (nodeInfo as Record<string, unknown>).input;
          if (!nodeInput || typeof nodeInput !== 'object') return input;

          const required = (nodeInput as Record<string, unknown>).required;
          const optional = (nodeInput as Record<string, unknown>).optional;
          const config = (required && typeof required === 'object')
            ? (required as Record<string, unknown>)[originalInputName]
            : undefined;
          const configAlt = (!config && optional && typeof optional === 'object')
            ? (optional as Record<string, unknown>)[originalInputName]
            : undefined;
          const effectiveConfig = config ?? configAlt;
          if (!effectiveConfig || !Array.isArray(effectiveConfig as unknown[])) return input;

          const cfgArr = effectiveConfig as unknown[];
          // Check if config[0] is an array of string options (COMBO type)
          if (Array.isArray(cfgArr[0]) && (cfgArr[0] as unknown[]).length > 0) {
            const options = (cfgArr[0] as unknown[]).map(v => String(v));
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

  const handleFillPrompt = useCallback((text: string) => {
    // Find the first text input (CLIPTextEncode node prompt)
    const firstTextInput = sortedWorkflowInputs.find(input => input.type === 'text');
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

  // Cluster Mode: Handle template selection
  // Synchronous — same pattern as direct mode's handleWorkflowSelect.
  // Deep clone param_schema to prevent shared reference issues across templates.
  const handleTemplateSelect = (template: LemonGridTemplateSummary) => {
    const raw = template as unknown as Record<string, unknown>;
    // Deep clone to break any shared references in the list API response
    const cloned = {
      ...raw,
      param_schema: JSON.parse(JSON.stringify(raw.param_schema ?? [])),
    };
    const detail = normalizeTemplateDetail(cloned as Record<string, unknown>);

    // Enrich param_schema: convert COMBO fields that API mis-typed as STRING/text to select
    // Uses objectInfo to look up actual options for each field
    const oi = objectInfo as Record<string, unknown> | null;
    if (oi) {
      for (const field of detail.param_schema) {
        if (field.type === 'text' && !field.hidden) {
          const classType = field.source_class_type;
          const inputName = field.name;
          // Try to find options from objectInfo using source_class_type
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
                field.options = opts.map(v => ({ label: String(v), value: v }));
              }
            }
          }
        }
        // Also fix select fields that have no options — enrich from objectInfo
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
                field.options = opts.map(v => ({ label: String(v), value: v }));
              }
            }
          }
        }
      }
    }

    // Per D-09: Initialize templateParams with defaults from param_schema
    const defaults: Record<string, unknown> = {};
    for (const field of detail.param_schema) {
      defaults[field.name] = renderParamDefault(field);
    }
    setTemplateParams(defaults);

    // Per D-19: Auto-detect image inputs (skip hidden fields)
    const imageInputs: Record<string, string> = {};
    for (const field of detail.param_schema) {
      if (!field.hidden && isImageParam(field)) {
        imageInputs[field.name] = '';
      }
    }
    setTemplateImageInputs(imageInputs);
    setSelectedTemplate(detail);
    setUploadedImagePreviews({});
  };

  // Cluster Mode: Handle template parameter change
  const handleTemplateParamChange = (paramName: string, value: unknown) => {
    setTemplateParams(prev => ({ ...prev, [paramName]: value }));
  };

  // Cluster Mode: Handle image upload for a template image param (supports multi-image)
  // Per D-18, D-19: Same image input UI, upload target is LemonGrid asset API
  const handleTemplateImageUpload = async (file: File, paramName: string) => {
    if (!lemonGridServerUrl) return;

    // Show preview immediately — append to array
    const previewUrl = URL.createObjectURL(file);
    setUploadedImagePreviews(prev => {
      const existing = prev[paramName];
      const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
      return { ...prev, [paramName]: [...arr, previewUrl] };
    });

    try {
      const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
      const result = await client.uploadAsset(file);
      // Store asset_id array as param value
      setTemplateParams(prev => {
        const existing = prev[paramName];
        const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
        return { ...prev, [paramName]: [...arr, result.id] };
      });
      setTemplateImageInputs(prev => {
        const existing = prev[paramName];
        const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
        return { ...prev, [paramName]: [...arr, result.filename] };
      });
    } catch (error) {
      console.error('[Draw] Failed to upload image to LemonGrid:', error);
      // Remove the failed preview
      setUploadedImagePreviews(prev => {
        const existing = prev[paramName];
        const arr = Array.isArray(existing) ? existing : existing ? [existing] : [];
        return { ...prev, [paramName]: arr.slice(0, -1) };
      });
    }
  };

  // Cluster Mode: Submit task stub
  // Per D-50: Same handleGenerate function with connectionMode branch
  // Per D-41: Snapshot parameter values at submit time
  // NOTE: Polling/WS progress tracking and result download are handled by Plan 06-03
  // Per D-39: Support concurrent tasks — no isGenerating lock in Cluster Mode
  const handleClusterSubmit = async () => {
    if (!isLemonGridConnected || !selectedTemplate || !lemonGridServerUrl) return;
    if (isSubmittingCluster) return;

    setIsSubmittingCluster(true);
    try {
      // Apply seed modes before submitting
      const seedModeUpdates: Record<string, number> = {};
      Object.entries(seedModes).forEach(([fieldName, mode]) => {
        const currentValue = templateParams[fieldName];
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
      if (Object.keys(seedModeUpdates).length > 0) {
        setTemplateParams(prev => ({ ...prev, ...seedModeUpdates }));
      }

      const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
      // Per D-41: Snapshot parameter values at submit time
      // Build params with node_id.name keys (e.g. "100.upload") as required by API
      const snapshotParams: Record<string, unknown> = {};
      for (const field of selectedTemplate.param_schema) {
        // Skip hidden fields — backend uses workflow defaults for those
        if (field.hidden) continue;

        const value = templateParams[field.name] ?? renderParamDefault(field);

        // For image fields: only include if user actually uploaded an asset.
        // Default ComfyUI filenames from param_schema are invalid on the cluster server.
        if (field.type === 'image' || isImageParam(field)) {
          if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string' && value[0].includes('-')) {
            // Looks like a LemonGrid asset ID array — unwrap single-element arrays
            // to string so backend (workflow_merge_service + agent) can resolve them.
            // Backend only accepts str or dict, not arrays.
            snapshotParams[`${field.node_id}.${field.name}`] = value.length === 1 ? value[0] : value;
          }
          // else: no upload yet — skip, let backend use workflow default
          continue;
        }

        snapshotParams[`${field.node_id}.${field.name}`] = value;
      }
      const result = await client.submitTask(selectedTemplate.id, snapshotParams, selectedTemplate.version, selectedTemplate.template_type || 'COMFYUI');

      // Add task to lemongridStore for tracking
      useLemonGridStore.getState().updateTask(result.id, {
        taskId: result.id,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        templateType: selectedTemplate.template_type || 'COMFYUI',
        status: result.status as 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
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

        store.updateTask(taskId, {
          status: status.status,
          progress: status.progress,
          progressDetail: status.progress_detail,
          queuePosition: status.queue_position,
          errorCode: status.error_code,
          errorMessage: status.error_message,
          outputAssetIds: status.output_file_ids || [],
          completedAt: status.completed_at ? new Date(status.completed_at).getTime() : null,
          durationSeconds: status.duration_seconds,
        });

        if (['PENDING', 'QUEUED', 'SYNCING', 'RUNNING'].includes(status.status)) {
          // Per D-28: Adaptive interval - 1s running, 2s queued/syncing
          const interval = status.status === 'RUNNING' ? 1000 : 2000;
          setTimeout(poll, interval);
        } else {
          // Task reached terminal state
          if (status.status === 'COMPLETED') {
            await handleTaskCompletion(taskId);
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

  // Per D-34, D-35, D-44, D-47: Download all outputs and auto-import to PS
  const completingTaskIds = useRef<Set<string>>(new Set());
  const handleTaskCompletion = async (taskId: string) => {
    // Idempotency guard: prevent duplicate downloads from WS + polling races
    if (completingTaskIds.current.has(taskId)) return;
    completingTaskIds.current.add(taskId);

    const serverUrl = useLemonGridStore.getState().serverUrl;
    const client = new LemonGridClient({ serverUrl });

    let task = useLemonGridStore.getState().tasks[taskId];
    // If outputAssetIds is empty (e.g. WebSocket completion without file IDs),
    // fetch latest status from API to get output_file_ids
    if (task && !task.outputAssetIds.length) {
      try {
        const status = await client.getTaskStatus(taskId);
        if (status.output_file_ids?.length) {
          useLemonGridStore.getState().updateTask(taskId, {
            outputAssetIds: status.output_file_ids,
          });
          task = useLemonGridStore.getState().tasks[taskId];
        }
      } catch (e) {
        console.error('[Draw] Failed to fetch task status for output files:', e);
      }
    }

    if (!task || !task.outputAssetIds.length) {
      return;
    }

    for (const assetId of task.outputAssetIds) {
      try {
        const blob = await client.downloadAsset(assetId);
        const filename = `cluster-${assetId.substring(0, 8)}.png`;
        // Per D-35: Auto-import to PS as separate layer
        await syncGeneratedImageToPsLayer(blob, filename);
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
  };

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
    if (currentConnectionMode === 'cluster') {
      // Per D-15: Must be connected to LemonGrid
      if (!isLemonGridConnected || !selectedTemplate) return;
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

      const workflowData = await client.readWorkflow(currentWorkflow.path || currentWorkflow.name, prefixMode);

      // Save original seed values before applying workflow's control_after_generate
      const originalSeedValues: Record<string, number> = {};
      Object.entries(latestInputValuesRef.current).forEach(([key, value]) => {
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
          setInputValues(prev => {
            const next = { ...prev, ...randomSeedUpdates };
            latestInputValuesRef.current = next;
            return next;
          });
        }
      }

      // Apply seed modes (override workflow's control_after_generate)
      const seedModeUpdates: Record<string, number> = {};
      Object.entries(seedModes).forEach(([fieldName, mode]) => {
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
        setInputValues(prev => {
          const next = { ...prev, ...seedModeUpdates };
          latestInputValuesRef.current = next;
          return next;
        });
      }

      const historyPrompt = pendingRerunPromptRef.current;
      const currentInputValues = latestInputValuesRef.current;

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
      const finalPrompt = enforceLatestImageInputs(compiledPrompt, effectiveValues, workflowInputs);
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
        // Long-text (prompt) → textarea; short-text → input
        const isLongText = /prompt|提示词|description|描述/i.test(input.label);
        if (isLongText) {
          return (
            <div key={input.name} className="form-field">
              <div className="field-label">{input.label}</div>
              <textarea
                className="text-input"
                value={value as string}
                onChange={(e) => handleInputChange(input.name, e.target.value)}
                rows={2}
                placeholder={`输入${input.label}...`}
              />
            </div>
          );
        }
        return (
          <div key={input.name} className="form-field">
            <div className="field-label">{input.label}</div>
            <input
              type="text"
              className="text-input"
              value={value as string}
              onChange={(e) => handleInputChange(input.name, e.target.value)}
              placeholder={`输入${input.label}...`}
            />
          </div>
        );
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
      {/* Upper Section: Preview Area */}
      <div className="preview-section">
        {/* Queue status badge */}
        {connectionMode !== 'cluster' && comfyUISettings.isConnected && (queueRunning.length > 0 || queuePending.length > 0) && (
          <div className="queue-status-badge">
            <span className="queue-dot"></span>
            <span className="queue-text">
              {queueRunning.length > 0 && `${queueRunning.length} 运行中`}
              {queueRunning.length > 0 && queuePending.length > 0 && ' · '}
              {queuePending.length > 0 && `${queuePending.length} 排队中`}
            </span>
          </div>
        )}
        {/* Cluster Mode: Platform queue status badge */}
        {connectionMode === 'cluster' && isLemonGridConnected && queueSummary && (queueSummary.queued_count > 0 || queueSummary.running_count > 0) && (
          <div className="queue-status-badge cluster-queue-badge">
            <span className="queue-dot"></span>
            <span className="queue-text cluster-queue-text">
              平台: {queueSummary.running_count > 0 && `${queueSummary.running_count} 运行中`}
              {queueSummary.running_count > 0 && queueSummary.queued_count > 0 && ' · '}
              {queueSummary.queued_count > 0 && `${queueSummary.queued_count} 排队中`}
              {queueSummary.avg_wait_seconds != null && queueSummary.queued_count > 0 && ` · ~${Math.ceil(queueSummary.avg_wait_seconds / 60)}分钟`}
            </span>
          </div>
        )}
        <div className="preview-content">
          {progress.previewImage ? (
            <img
              src={progress.previewImage}
              alt="Preview"
              className="preview-image"
              data-prompt-reverse
              {...(outputImages[activeOutputIndex]?.assetId ? { 'data-asset-id': outputImages[activeOutputIndex].assetId } : {})}
            />
          ) : (
            <div className="preview-placeholder">
              <div className="placeholder-icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>
              <p>选择工作流并生成图像</p>
            </div>
          )}
        </div>

        {outputImages.length > 1 && (
          <div className="preview-strip">
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
                  <div className="workflow-dropdown">
                    <select
                      className="template-select"
                      value={selectedTemplate?.id || ''}
                      onChange={(e) => {
                        const template = clusterTemplates.find(t => t.id === e.target.value);
                        if (template) handleTemplateSelect(template);
                      }}
                      disabled={isLoadingTemplates}
                    >
                      <option value="">
                        {isLoadingTemplates ? '加载模板中...' : '选择模板'}
                      </option>
                      {/* Group by template_type first, then by category — flat optgroups */}
                      {(['COMFYUI', 'THIRD_PARTY_API'] as const).filter(
                        type => clusterTemplates.some(t => (t.template_type || 'COMFYUI') === type)
                      ).flatMap(type => {
                        const typeLabel = type === 'COMFYUI' ? '工作流模板' : '云端模型';
                        const typeTemplates = clusterTemplates.filter(t => (t.template_type || 'COMFYUI') === type);
                        const categories = Array.from(new Set(typeTemplates.map(t => t.category || '未分类')));
                        // Single category: use type label directly
                        if (categories.length <= 1) {
                          return [(
                            <optgroup key={type} label={typeLabel}>
                              {typeTemplates.map(template => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                            </optgroup>
                          )];
                        }
                        // Multiple categories: one optgroup per category with type prefix
                        return categories.map(category => (
                          <optgroup key={`${type}-${category}`} label={`${typeLabel} - ${category}`}>
                            {typeTemplates
                              .filter(t => (t.category || '未分类') === category)
                              .map(template => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                          </optgroup>
                        ));
                      })}
                    </select>
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
            </>
          )}
        </div>

        {/* Dynamic Form + Generate */}
        <div className="control-section dynamic-form">
          <div className="section-label">参数</div>

          {connectionMode === 'cluster' ? (
            // Cluster Mode: Dynamic parameter UI from param_schema per D-02, D-09
            <>
              {/* Preset Toolbar - per D-10, D-104: template_id as key */}
              <PresetToolbar
                workflowName={selectedTemplate?.id ?? null}
                workflowPath={undefined}
                inputValues={templateParams as Record<string, string | number | boolean>}
                imageFilenames={templateImageInputs as Record<string, string>}
                onApplyPreset={(preset) => {
                  // Apply preset values to template params
                  const applied: Record<string, unknown> = { ...templateParams };
                  for (const [key, value] of Object.entries(preset.inputValues)) {
                    if (key in applied) {
                      applied[key] = value;
                    }
                  }
                  setTemplateParams(applied);
                }}
              />

              {!selectedTemplate ? (
                <div className="form-placeholder">
                  <span className="placeholder-icon">📝</span>
                  <p>请先选择一个模板</p>
                </div>
              ) : selectedTemplate.param_schema.filter(f => !f.hidden).length === 0 ? (
                <div className="form-placeholder">
                  <span className="placeholder-icon">✓</span>
                  <p>此模板无需配置参数</p>
                </div>
              ) : (
                <div className="form-fields" key={selectedTemplate.id}>
                  {selectedTemplate.param_schema
                    .filter(f => !f.hidden)
                    .filter((field, idx, arr) => arr.findIndex(f => f.label === field.label) === idx)
                    .map((field) => {
                    const value = templateParams[field.name] ?? renderParamDefault(field);

                    // Per D-09: Render inputs based on param_schema type
                    switch (field.type) {
                      case 'text': {
                        // If field has options, render as select dropdown
                        if (field.options && field.options.length > 0) {
                          return (
                            <div key={field.name} className="form-field">
                              <div className="field-label">{field.label}{field.required && <span className="required-mark">*</span>}</div>
                              <select
                                className="workflow-select"
                                value={String(value)}
                                onChange={(e) => handleTemplateParamChange(field.name, e.target.value)}
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
                        // Determine if this is a long-text (prompt) field or short-text field
                        const isLongText = /prompt|提示词|description|描述/i.test(field.label + (field.description || ''));
                        if (isLongText) {
                          return (
                            <div key={field.name} className="form-field">
                              <div className="field-label">{field.label}{field.required && <span className="required-mark">*</span>}</div>
                              <textarea
                                className="text-input"
                                value={String(value)}
                                onChange={(e) => handleTemplateParamChange(field.name, e.target.value)}
                                rows={2}
                                placeholder={field.description || `输入${field.label}...`}
                              />
                            </div>
                          );
                        }
                        // Short text: model names, paths, etc. → single-line input
                        return (
                          <div key={field.name} className="form-field">
                            <div className="field-label">{field.label}{field.required && <span className="required-mark">*</span>}</div>
                            <input
                              type="text"
                              className="text-input"
                              value={String(value)}
                              onChange={(e) => handleTemplateParamChange(field.name, e.target.value)}
                              placeholder={field.description || ''}
                            />
                          </div>
                        );
                      }

                      case 'number': {
                        const numericValue = typeof value === 'number' ? value : Number(value || 0);
                        const isSeedField = field.name.toLowerCase().includes('seed');

                        if (isSeedField) {
                          const currentSeedMode = seedModes[field.name] || 'randomize';
                          return (
                            <div key={field.name} className="form-field seed-field">
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
                                      onClick={() => setOpenSeedDropdown(openSeedDropdown === field.name ? null : field.name)}
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
                                    {openSeedDropdown === field.name && (
                                      <div className="seed-mode-menu" onClick={() => setOpenSeedDropdown(null)}>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'fixed' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'fixed' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                          <span>固定值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'increment' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'increment' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                                          <span>递增值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'decrement' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'decrement' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                                          <span>递减值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'randomize' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'randomize' })); }}>
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
                                      if (!Number.isNaN(v)) handleTemplateParamChange(field.name, v);
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
                          <div key={field.name} className="form-field slider-field">
                            <div className="field-label">
                              <span>{field.label}{field.required && <span className="required-mark">*</span>}</span>
                              <div className="number-stepper">
                                <button
                                  type="button"
                                  className="stepper-btn stepper-minus"
                                  onClick={() => {
                                    const next = Math.max(min, sliderValue - step);
                                    handleTemplateParamChange(field.name, next);
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
                                    if (!Number.isNaN(v)) handleTemplateParamChange(field.name, v);
                                  }}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value);
                                    const clamped = Number.isNaN(v) ? min : Math.min(max, Math.max(min, v));
                                    handleTemplateParamChange(field.name, clamped);
                                  }}
                                  step={step}
                                />
                                <button
                                  type="button"
                                  className="stepper-btn stepper-plus"
                                  onClick={() => {
                                    const next = Math.min(max, sliderValue + step);
                                    handleTemplateParamChange(field.name, next);
                                  }}
                                  disabled={sliderValue >= max}
                                >+</button>
                              </div>
                            </div>
                            <input
                              type="range"
                              className="range-track"
                              value={sliderValue}
                              onChange={(e) => handleTemplateParamChange(field.name, Number(e.target.value))}
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
                          const currentSeedMode = seedModes[field.name] || 'randomize';
                          return (
                            <div key={field.name} className="form-field seed-field">
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
                                      onClick={() => setOpenSeedDropdown(openSeedDropdown === field.name ? null : field.name)}
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
                                    {openSeedDropdown === field.name && (
                                      <div className="seed-mode-menu" onClick={() => setOpenSeedDropdown(null)}>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'fixed' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'fixed' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                          <span>固定值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'increment' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'increment' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="18 11 12 5 6 11"/></svg>
                                          <span>递增值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'decrement' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'decrement' })); }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="18 13 12 19 6 13"/></svg>
                                          <span>递减值</span>
                                        </button>
                                        <button type="button" className={`seed-mode-option ${currentSeedMode === 'randomize' ? 'active' : ''}`} onClick={() => { setSeedModes(prev => ({ ...prev, [field.name]: 'randomize' })); }}>
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
                                      if (!Number.isNaN(v)) handleTemplateParamChange(field.name, v);
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
                          <div key={field.name} className="form-field slider-field">
                            <div className="field-label">
                              <span>{field.label}{field.required && <span className="required-mark">*</span>}</span>
                              <div className="number-stepper">
                                <button
                                  type="button"
                                  className="stepper-btn stepper-minus"
                                  onClick={() => {
                                    const next = Math.max(min, clampedValue - step);
                                    handleTemplateParamChange(field.name, next);
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
                                    if (!Number.isNaN(v)) handleTemplateParamChange(field.name, v);
                                  }}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value);
                                    const clamped = Number.isNaN(v) ? min : Math.min(max, Math.max(min, v));
                                    handleTemplateParamChange(field.name, clamped);
                                  }}
                                  step={step}
                                />
                                <button
                                  type="button"
                                  className="stepper-btn stepper-plus"
                                  onClick={() => {
                                    const next = Math.min(max, clampedValue + step);
                                    handleTemplateParamChange(field.name, next);
                                  }}
                                  disabled={clampedValue >= max}
                                >+</button>
                              </div>
                            </div>
                            <input
                              type="range"
                              className="range-track"
                              value={clampedValue}
                              onChange={(e) => handleTemplateParamChange(field.name, Number(e.target.value))}
                              min={min}
                              max={max}
                              step={step}
                            />
                          </div>
                        );
                      }

                      case 'select':
                        return (
                          <div key={field.name} className="form-field">
                            <label>{field.label}{field.required && <span className="required-mark">*</span>}</label>
                            <select
                              value={String(value)}
                              onChange={(e) => handleTemplateParamChange(field.name, e.target.value)}
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
                          <div key={field.name} className="toggle-wrap">
                            <span className="toggle-label">{field.label}{field.required && <span className="required-mark">*</span>}</span>
                            <button
                              type="button"
                              className={`toggle ${Boolean(value) ? 'on' : ''}`}
                              onClick={() => handleTemplateParamChange(field.name, !Boolean(value))}
                            />
                          </div>
                        );

                      case 'image': {
                        // Per D-18, D-19: Multi-image upload UI, target is LemonGrid asset API
                        const previews = uploadedImagePreviews[field.name];
                        const previewArr: string[] = Array.isArray(previews) ? previews : previews ? [previews] : [];
                        const filenames = templateImageInputs[field.name];
                        const filenameArr: string[] = Array.isArray(filenames) ? filenames : filenames ? [filenames] : [];
                        return (
                          <div key={field.name} className="form-field image-field">
                            <label>{field.label}{field.required && <span className="required-mark">*</span>}</label>
                            {isUXPWebView() && (
                              <div className="image-upload-ps-buttons">
                                <div className="image-upload-ps-item">
                                  <span className="image-upload-ps-label">选区</span>
                                  <PsExportButton
                                    mode="selection"
                                    label="从 PS 选区加载"
                                    iconOnly
                                    compact
                                    onExport={(blob) => {
                                      const file = new File([blob], `ps-export-${Date.now()}.png`, { type: 'image/png' });
                                      handleTemplateImageUpload(file, field.name);
                                    }}
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
                                    onExport={(blob) => {
                                      const file = new File([blob], `ps-export-${Date.now()}.png`, { type: 'image/png' });
                                      handleTemplateImageUpload(file, field.name);
                                    }}
                                    onError={(err) => console.error('Layer export error:', err)}
                                  />
                                </div>
                              </div>
                            )}
                            <div className="image-upload-area multi-image-area">
                              {previewArr.length > 0 && (
                                <div className="multi-image-list">
                                  {previewArr.map((previewUrl, idx) => (
                                    <div key={idx} className="multi-image-item">
                                      <img src={previewUrl} alt={`图片 ${idx + 1}`} className="multi-image-preview" />
                                      <button
                                        type="button"
                                        className="multi-image-remove"
                                        onClick={() => {
                                          setUploadedImagePreviews(prev => {
                                            const arr = Array.isArray(prev[field.name]) ? [...(prev[field.name] as string[])] : [];
                                            arr.splice(idx, 1);
                                            return { ...prev, [field.name]: arr };
                                          });
                                          setTemplateImageInputs(prev => {
                                            const arr = Array.isArray(prev[field.name]) ? [...(prev[field.name] as string[])] : [];
                                            arr.splice(idx, 1);
                                            return { ...prev, [field.name]: arr };
                                          });
                                          setTemplateParams(prev => {
                                            const arr = Array.isArray(prev[field.name]) ? [...(prev[field.name] as string[])] : [];
                                            arr.splice(idx, 1);
                                            return { ...prev, [field.name]: arr };
                                          });
                                        }}
                                        title="移除"
                                      >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <line x1="18" y1="6" x2="6" y2="18" />
                                          <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                      </button>
                                      <span className="multi-image-name">{filenameArr[idx] || `图片 ${idx + 1}`}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <label className="multi-image-add">
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      try {
                                        await handleTemplateImageUpload(file, field.name);
                                      } catch (error) {
                                        console.error('[Draw] 上传图片到 LemonGrid 失败:', error);
                                      }
                                    }
                                    // Reset so same file can be re-selected
                                    e.target.value = '';
                                  }}
                                />
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <rect x="3" y="3" width="18" height="18" rx="3" />
                                  <line x1="12" y1="8" x2="12" y2="16" />
                                  <line x1="8" y1="12" x2="16" y2="12" />
                                </svg>
                                <span>添加图片</span>
                              </label>
                            </div>
                          </div>
                        );
                      }

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
              {/* Preset Toolbar */}
              <PresetToolbar
                workflowName={selectedWorkflow?.name ?? null}
                workflowPath={selectedWorkflow?.path}
                inputValues={inputValues}
                imageFilenames={currentImageFilenames}
                onApplyPreset={handleApplyPreset}
              />

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
        </div>
      </div>
      <PromptReverseFlow onFillPrompt={handleFillPrompt} />
      {connectionMode === 'cluster' && (
        <LoginModal
          isOpen={lgShowLoginModal}
          onClose={() => lgSetShowLoginModal(false)}
          onLoginSuccess={() => lgSetShowLoginModal(false)}
        />
      )}
    </div>
  );
};
