// LemonGrid API client service
// Per D-97, D-101: Mirrors ComfyUIClient interface pattern. Independent class.

import { lemongridFetch, ensureValidToken } from './lemongrid-auth';
import { useLemonGridStore } from '../stores/lemongridStore';
import { sendBridgeMessage, isUXPWebView, fileToBase64 } from './upload';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type TemplateType = 'COMFYUI' | 'THIRD_PARTY_API';

export interface LemonGridTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail_url: string | null;
  tags: string[];
  version: number;
  updated_at: string;
  template_type?: TemplateType;
  param_schema?: unknown[];
}

export interface TemplateListParams {
  status_filter?: string;
  template_type?: TemplateType;
  page_size?: number;
  category?: string;
  search?: string;
}

export interface ParamSchemaField {
  name: string;
  node_id: string;
  type: 'text' | 'number' | 'image' | 'select' | 'boolean' | 'slider';
  label: string;
  default: unknown;
  required: boolean;
  hidden?: boolean;
  group?: string;
  options?: Array<{ label: string; value: unknown }>;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  source_class_type?: string | null;
}

export interface LemonGridTemplateDetail {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail_url: string | null;
  help_text: string | null;
  param_schema: ParamSchemaField[];
  version: number;
  example_outputs: string[];
  template_type?: TemplateType;
}

export interface LemonGridTaskSubmitResult {
  id: string;
  status: string;
  progress: number;
  priority_score: number;
  created_at: string;
}

export interface LemonGridTaskStatus {
  id: string;
  status: 'PENDING' | 'QUEUED' | 'SYNCING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  progress_detail: string | null;
  queue_position: number | null;
  error_code: string | null;
  error_message: string | null;
  output_file_ids: string[];
  duration_seconds: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface LemonGridTaskHistoryItem {
  id: string;
  status: string;
  progress: number;
  parameters: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
  template_id: string;
  template_category: string;
  param_schema: unknown[];
  output_file_ids: string[];
  workflow_name: string;
  error_code: string | null;
  error_message: string | null;
  duration_seconds: number | null;
}

export interface LemonGridTaskHistoryResponse {
  items: LemonGridTaskHistoryItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface TaskQueueSummary {
  queued_count: number;
  running_count: number;
  completed_today: number;
  failed_today: number;
  active_nodes: number;
  avg_wait_seconds: number | null;
  avg_duration_seconds: number | null;
}

export interface TaskETAResponse {
  task_id: string;
  queue_position: number;
  total_workers: number;
  avg_duration_seconds: number;
  estimated_wait_seconds: number;
}

// ---------------------------------------------------------------------------
// Error suggestions per D-45
// ---------------------------------------------------------------------------

export const LEMONGRID_ERROR_SUGGESTIONS: Record<string, string> = {
  OOM: '图片尺寸过大，请减小分辨率',
  DEPENDENCY_MISSING: '输入图片缺失，请重新上传',
  TIMEOUT: '任务超时，请重试',
  RATE_LIMITED: '请求过于频繁，请稍后重试',
  AUTH_EXPIRED: '登录已过期，请重新登录',
  NETWORK_ERROR: '网络连接失败，请检查网络',
  UNKNOWN: '未知错误，请重试',
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Raw param_schema field as returned by the LemonGrid API */
interface RawParamSchemaField {
  input_name: string;
  type: string;       // "STRING", "INT", "FLOAT", "BOOLEAN", "IMAGEUPLOAD", "COMBO"
  label: string;
  default: unknown;
  group: string;
  node_id: string;
  options?: Array<{ label: string; value: unknown }> | string[] | null;
  visible?: boolean | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  description?: string | null;
  source_class_type?: string | null;
}

/** Map API type strings to ParamSchemaField type literals */
function mapApiType(apiType: string): ParamSchemaField['type'] {
  switch (apiType?.toUpperCase()) {
    case 'STRING': return 'text';
    case 'INT':
    case 'FLOAT': return 'number';
    case 'IMAGEUPLOAD': return 'image';
    case 'COMBO': return 'select';
    case 'BOOLEAN': return 'boolean';
    default: return 'text';
  }
}

/** Check if a raw field is marked invisible */
function isHidden(raw: RawParamSchemaField): boolean {
  return raw.visible === false;
}

/**
 * Normalize options to uniform {label, value} format.
 * COMFYUI templates return [{label, value}] objects.
 * THIRD_PARTY_API templates return plain string arrays like ["auto","1:1",...].
 */
function normalizeOptions(
  raw: Array<{ label: string; value: unknown } | string> | null | undefined,
): Array<{ label: string; value: unknown }> | undefined {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return undefined;
  // Already in object format
  if (typeof raw[0] === 'object' && raw[0] !== null && 'value' in raw[0]) {
    return raw as Array<{ label: string; value: unknown }>;
  }
  // Plain string/number array — convert to {label, value}
  return raw.map((item) => {
    const val = typeof item === 'object' && item !== null && 'value' in item ? item.value : item;
    const lbl = typeof item === 'object' && item !== null && 'label' in item ? item.label : String(val);
    return { label: lbl, value: val };
  });
}

/** Convert raw API param_schema field to ParamSchemaField interface */
function normalizeParamField(raw: RawParamSchemaField): ParamSchemaField {
  // Infer boolean type from default value when API misreports type (e.g. log=true typed as INT)
  const inferredType = typeof raw.default === 'boolean' ? 'boolean' : mapApiType(raw.type);
  return {
    name: raw.input_name,
    node_id: String(raw.node_id),
    type: inferredType,
    label: raw.label || raw.input_name,
    default: raw.default,
    required: false,
    hidden: isHidden(raw) || undefined,
    options: normalizeOptions(raw.options as Array<{ label: string; value: unknown } | string> | null | undefined),
    min: raw.min ?? undefined,
    max: raw.max ?? undefined,
    step: raw.step ?? undefined,
    description: raw.description ?? undefined,
    source_class_type: raw.source_class_type ?? undefined,
    group: raw.group || undefined,
  };
}

/** Normalize param_schema array from API response — keeps all fields (hidden ones marked for UI skip) */
function normalizeParamSchema(rawSchema: RawParamSchemaField[]): ParamSchemaField[] {
  if (!Array.isArray(rawSchema)) return [];
  const hiddenCount = rawSchema.filter(isHidden).length;
  console.log('[LemonGrid] normalizeParamSchema:', rawSchema.length, 'total,', hiddenCount, 'hidden');
  return rawSchema.map(normalizeParamField);
}

/**
 * Per D-19: Auto-detect image inputs from param_schema.
 */
export function isImageParam(field: ParamSchemaField): boolean {
  return field.type === 'image';
}

/**
 * Normalize a raw template object (from list API) into LemonGridTemplateDetail.
 * The list API returns full template objects with param_schema already included,
 * so we can skip the separate getTemplateDetail call.
 */
export function normalizeTemplateDetail(raw: Record<string, unknown>): LemonGridTemplateDetail {
  const rawSchema = raw.param_schema;
  if (!rawSchema) {
    console.warn('[LemonGrid] normalizeTemplateDetail: param_schema missing for', raw.id, '- keys:', Object.keys(raw));
  }
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string,
    category: raw.category as string,
    thumbnail_url: (raw.thumbnail_url as string | null) ?? null,
    help_text: (raw.help_text as string | null) ?? null,
    param_schema: normalizeParamSchema((rawSchema as RawParamSchemaField[] | undefined) ?? []),
    version: raw.version as number,
    example_outputs: (raw.example_outputs as string[]) ?? [],
    template_type: (raw.template_type as TemplateType | undefined) ?? undefined,
  };
}

/**
 * Returns the default value for a param field based on its type.
 */
export function renderParamDefault(field: ParamSchemaField): unknown {
  if (field.default !== undefined && field.default !== null) {
    return field.default;
  }
  switch (field.type) {
    case 'text':
      return '';
    case 'number':
    case 'slider':
      return field.min ?? 0;
    case 'boolean':
      return false;
    case 'select':
      return field.options?.[0]?.value ?? '';
    case 'image':
      return '';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// LemonGridClient class
// ---------------------------------------------------------------------------

export class LemonGridClient {
  private serverUrl: string;

  constructor(options: { serverUrl: string }) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
  }

  /**
   * Internal: authenticated fetch with auto token refresh.
   */
  private async fetchWithAuth(path: string, options?: RequestInit, timeout?: number): Promise<Response> {
    await ensureValidToken();
    const token = useLemonGridStore.getState().accessToken;
    const url = `${this.serverUrl}${path}`;
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return lemongridFetch(url, { ...options, headers }, timeout);
  }

  /**
   * Internal: fetch JSON with auth, throws on non-ok response.
   */
  private async fetchJson<T>(path: string, options?: RequestInit, timeout?: number): Promise<T> {
    const response = await this.fetchWithAuth(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string> || {}),
      },
    }, timeout);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LemonGrid API error ${response.status}: ${errorBody.substring(0, 200)}`);
    }
    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Template API methods
  // -------------------------------------------------------------------------

  /**
   * List available templates with optional filtering.
   * Per D-01, D-07, D-20: Full template list with categories from metadata.
   * Per D-14: Server does role-based filtering, no client filtering needed.
   * Supports LemonGrid template_type filtering (COMFYUI / THIRD_PARTY_API).
   */
  async listTemplates(params?: TemplateListParams): Promise<LemonGridTemplateSummary[]> {
    const query = new URLSearchParams();
    if (params?.status_filter) query.set('status_filter', params.status_filter);
    if (params?.template_type) query.set('template_type', params.template_type);
    if (params?.page_size) query.set('page_size', String(params.page_size));
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    const path = `/api/v1/templates${qs ? `?${qs}` : ''}`;
    const raw = await this.fetchJson<unknown>(path);
    // API may return a bare array or a wrapper like { data: [...] } / { templates: [...] } / { items: [...] }
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const arr = obj.data ?? obj.templates ?? obj.items ?? obj.results;
      if (Array.isArray(arr)) return arr as LemonGridTemplateSummary[];
    }
    console.warn('[LemonGrid] Unexpected listTemplates response:', raw);
    return [];
  }

  /**
   * Get full detail for a single template, including complete param_schema with visible flags.
   * Falls back to list data if detail endpoint is unavailable.
   */
  async getTemplateDetail(templateId: string): Promise<LemonGridTemplateDetail> {
    try {
      const raw = await this.fetchJson<Record<string, unknown>>(`/api/v1/templates/${templateId}`);
      return normalizeTemplateDetail(raw);
    } catch (err) {
      console.warn('[LemonGrid] getTemplateDetail failed, falling back to list data:', err);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Task API methods
  // -------------------------------------------------------------------------

  /**
   * Submit a new task.
   * Per D-03: Sends template_id + params only, not full workflow JSON.
   * Per D-41: Parameter values are snapshot at submit time.
   * taskType: 'COMFYUI' (default) or 'THIRD_PARTY_API' based on template_type.
   */
  async submitTask(
    templateId: string,
    params: Record<string, unknown>,
    templateVersion: number = 1,
    taskType: TemplateType = 'COMFYUI',
  ): Promise<LemonGridTaskSubmitResult> {
    return this.fetchJson<LemonGridTaskSubmitResult>('/api/v1/tasks/submit', {
      method: 'POST',
      body: JSON.stringify({
        task_type: taskType,
        task_mode: 'SPLIT',
        template_id: templateId,
        template_version: templateVersion,
        parameters: params,
      }),
    }, 300000);
  }

  /**
   * Get task status.
   * Per D-52, D-53: Returns status, progress, queue_position.
   */
  async getTaskStatus(taskId: string): Promise<LemonGridTaskStatus> {
    return this.fetchJson<LemonGridTaskStatus>(`/api/v1/tasks/${taskId}`);
  }

  /**
   * Cancel a running task.
   * Per D-33: Cancel via DELETE /api/v1/tasks/{task_id}.
   */
  async cancelTask(taskId: string): Promise<void> {
    await this.fetchJson<unknown>(`/api/v1/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get task history for the current user.
   * Calls GET /api/v1/tasks?history_only=true with optional pagination.
   */
  async getTaskHistory(params?: { page?: number; pageSize?: number }): Promise<LemonGridTaskHistoryResponse> {
    const query = new URLSearchParams({ history_only: 'true' });
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('page_size', String(params.pageSize));
    return this.fetchJson<LemonGridTaskHistoryResponse>(`/api/v1/tasks?${query.toString()}`);
  }

  /**
   * Get platform-wide queue summary.
   * Returns total queued/running counts and estimated average wait time.
   */
  async getQueueSummary(): Promise<TaskQueueSummary> {
    return this.fetchJson<TaskQueueSummary>('/api/v1/tasks/queue');
  }

  /**
   * Get estimated wait time for a specific queued task.
   * Only call for QUEUED tasks -- returns 404 for tasks not in the queue ZSET.
   */
  async getTaskETA(taskId: string): Promise<TaskETAResponse> {
    return this.fetchJson<TaskETAResponse>(`/api/v1/tasks/${taskId}/eta`);
  }

  // -------------------------------------------------------------------------
  // Asset API methods
  // -------------------------------------------------------------------------

  /**
   * Get the thumbnail URL for an asset. Returns a URL string that the browser
   * can load directly via <img src> with auth cookies or token in query params.
   * The LemonGrid backend serves pre-generated resized thumbnails at this endpoint.
   * NOTE: This URL requires Bearer auth. For <img> tags that cannot send auth headers,
   * use getThumbnailUrlWithToken() instead, or download the thumbnail blob manually.
   */
  getThumbnailUrl(assetId: string): string {
    return `${this.serverUrl}/api/v1/assets/library/${assetId}/thumbnail`;
  }

  /**
   * Get thumbnail URL with access_token as query parameter.
   * This allows <img> tags to load thumbnails without custom auth headers.
   * Falls back to the full download URL if no token is available.
   */
  getThumbnailUrlWithToken(assetId: string): string {
    const token = useLemonGridStore.getState().accessToken;
    const base = `${this.serverUrl}/api/v1/assets/library/${assetId}/thumbnail`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }

  /**
   * Get the full-resolution download URL for an asset (requires Bearer auth).
   */
  getDownloadUrl(assetId: string): string {
    return `${this.serverUrl}/api/v1/assets/library/${assetId}/download`;
  }

  /**
   * Upload an asset (image) to LemonGrid.
   * Per D-18: Same image input UI, only upload target changes.
   * Uses sendBridgeMessage('lemongrid.uploadAsset') in UXP mode,
   * or direct multipart fetch in browser mode.
   * Single attempt — main.js handler already retries with exponential backoff.
   */
  async uploadAsset(
    file: File,
    libraryType: string = 'REFERENCE'
  ): Promise<{ id: string; filename: string }> {
    await ensureValidToken();
    const token = useLemonGridStore.getState().accessToken;

    if (isUXPWebView()) {
      const base64Data = await fileToBase64(file);
      const uploadUrl = `${this.serverUrl}/api/v1/assets/library/upload`;
      const result = await sendBridgeMessage('lemongrid.uploadAsset', {
        url: uploadUrl,
        filename: file.name,
        base64Data,
        mimeType: file.type || 'image/png',
        libraryType,
      }) as { ok: boolean; status: number; data: { id: string; filename: string } };

      if (!result.ok) {
        throw new Error(`LemonGrid asset upload failed: HTTP ${result.status}`);
      }
      return result.data;
    } else {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('library_type', libraryType);

      const url = `${this.serverUrl}/api/v1/assets/library/upload`;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LemonGrid asset upload failed: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      return response.json() as Promise<{ id: string; filename: string }>;
    }
  }

  /**
   * Download an asset from LemonGrid.
   * Per D-34: Download all output images from completed tasks.
   */
  async downloadAsset(assetId: string): Promise<Blob> {
    const response = await this.fetchWithAuth(
      `/api/v1/assets/library/${assetId}/download`
    );
    if (!response.ok) {
      throw new Error(`LemonGrid asset download failed: HTTP ${response.status}`);
    }
    return response.blob();
  }
}
