// LemonGrid API client service
// Per D-97, D-101: Mirrors ComfyUIClient interface pattern. Independent class.

import { lemongridFetch, ensureValidToken } from './lemongrid-auth';
import { useLemonGridStore } from '../stores/lemongridStore';
import { sendBridgeMessage, isUXPWebView, fileToBase64 } from './upload';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface LemonGridTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail_url: string | null;
  tags: string[];
  version: number;
  updated_at: string;
}

export interface ParamSchemaField {
  name: string;
  type: 'text' | 'number' | 'image' | 'select' | 'boolean' | 'slider';
  label: string;
  default: unknown;
  required: boolean;
  options?: Array<{ label: string; value: unknown }>;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
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

/**
 * Per D-19: Auto-detect image inputs from param_schema.
 */
export function isImageParam(field: ParamSchemaField): boolean {
  return field.type === 'image';
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
  private async fetchWithAuth(path: string, options?: RequestInit): Promise<Response> {
    await ensureValidToken();
    const token = useLemonGridStore.getState().accessToken;
    const url = `${this.serverUrl}${path}`;
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return lemongridFetch(url, { ...options, headers });
  }

  /**
   * Internal: fetch JSON with auth, throws on non-ok response.
   */
  private async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await this.fetchWithAuth(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string> || {}),
      },
    });
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
   * List all available templates.
   * Per D-01, D-07, D-20: Full template list with categories from metadata.
   * Per D-14: Server does role-based filtering, no client filtering needed.
   */
  async listTemplates(): Promise<LemonGridTemplateSummary[]> {
    return this.fetchJson<LemonGridTemplateSummary[]>('/api/v1/templates');
  }

  /**
   * Get full template detail with param_schema.
   * Per D-08: Fetch on demand when user selects a template.
   */
  async getTemplateDetail(templateId: string): Promise<LemonGridTemplateDetail> {
    return this.fetchJson<LemonGridTemplateDetail>(`/api/v1/templates/${templateId}`);
  }

  // -------------------------------------------------------------------------
  // Task API methods
  // -------------------------------------------------------------------------

  /**
   * Submit a new task.
   * Per D-03: Sends template_id + params only, not full workflow JSON.
   * Per D-41: Parameter values are snapshot at submit time.
   */
  async submitTask(
    templateId: string,
    params: Record<string, unknown>
  ): Promise<LemonGridTaskSubmitResult> {
    return this.fetchJson<LemonGridTaskSubmitResult>('/api/v1/tasks/submit', {
      method: 'POST',
      body: JSON.stringify({
        template_id: templateId,
        parameters: params,
      }),
    });
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

  // -------------------------------------------------------------------------
  // Asset API methods
  // -------------------------------------------------------------------------

  /**
   * Upload an asset (image) to LemonGrid.
   * Per D-18: Same image input UI, only upload target changes.
   * Uses sendBridgeMessage('lemongrid.uploadAsset') in UXP mode,
   * or direct multipart fetch in browser mode.
   */
  async uploadAsset(
    file: File,
    libraryType: string = 'REFERENCE'
  ): Promise<{ id: string; filename: string }> {
    await ensureValidToken();
    const token = useLemonGridStore.getState().accessToken;

    if (isUXPWebView()) {
      // Use Bridge proxy for upload
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
      // Browser mode: direct multipart fetch
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
