import { isUXPWebView, bridgeFetch, hasBridgeTransport } from './upload';

export type PrefixMode = 'oss' | 'api';
export type EndpointStatus = 'ok' | 'failed' | 'unknown';
export type ComfyUIErrorType = 'cors' | 'timeout' | 'network' | 'invalid_url' | 'http' | 'unknown';

export interface ComfyUIError {
  type: ComfyUIErrorType;
  message: string;
  status?: number;
  endpoint?: string;
}

export interface EndpointProbeResult {
  url: string;
  status: EndpointStatus;
  httpStatus?: number;
  error?: ComfyUIError;
}

export type EndpointKey =
  | 'objectInfo'
  | 'prompt'
  | 'history'
  | 'uploadImage'
  | 'viewImage'
  | 'ws'
  | 'userdata'
  | 'workflowList'
  | 'workflowRead';

type CoreEndpointResults = {
  objectInfo: EndpointProbeResult;
  prompt: EndpointProbeResult;
  history: EndpointProbeResult;
};

export interface ComfyUICapabilities {
  baseUrl: string;
  prefixMode: PrefixMode | 'unknown';
  endpoints: Record<EndpointKey, EndpointProbeResult>;
  version?: string;
  checkedAt: string;
}

export interface ComfyUIWorkflowInfo {
  name: string;
  path: string;
  size?: number;
  modified?: string;
  isDirectory?: boolean;
}

export type ExperimentModelCatalog = Record<string, string[]>;

export interface ComfyUIHistoryEntry {
  prompt: Record<string, unknown>;
  outputs: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
  status?: string | Record<string, unknown>;
  start_time?: number;
  end_time?: number;
  extra_data?: {
    workflow_name?: string;
    [key: string]: unknown;
  };
}

export interface ComfyUIQueueItem {
  jobNumber: number;
  promptId: string;
  workflow: unknown;
  outputNodeIds: string[];
  metadata: {
    createTime?: number;
  };
}

export interface ComfyUIQueueStatus {
  queueRunning: ComfyUIQueueItem[];
  queuePending: ComfyUIQueueItem[];
}

export interface ViewImageOptions {
  filename: string;
  type?: 'output' | 'input' | 'temp';
  subfolder?: string;
  preview?: boolean;
}

export const isComfyUIError = (error: unknown): error is ComfyUIError => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  return typeof record.type === 'string' && typeof record.message === 'string';
};

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PROBE_TIMEOUT_MS = 45000;

const OSS_PATHS = {
  objectInfo: '/object_info',
  prompt: '/prompt',
  history: '/history',
  uploadImage: '/upload/image',
  viewImage: '/view',
  ws: '/ws',
  userdata: '/userdata',
  systemStats: '/system_stats',
  queue: '/queue',
} as const;

const API_PATHS = {
  objectInfo: '/api/object_info',
  prompt: '/api/prompt',
  history: '/api/history',
  uploadImage: '/api/upload/image',
  viewImage: '/api/view',
  ws: '/api/ws',
  userdata: '/api/userdata',
  systemStats: '/api/system_stats',
  queue: '/api/queue',
} as const;

const WORKFLOW_LIST_QUERY = 'dir=ps-workflows&recurse=true&split=false&full_info=true';

export const normalizeBaseUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw createComfyUIError('invalid_url', 'Base URL is required.');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw createComfyUIError('invalid_url', 'Base URL must start with http:// or https://.');
  }
  return trimmed.replace(/\/+$/, '');
};

const createComfyUIError = (
  type: ComfyUIErrorType,
  message: string,
  options?: { status?: number; endpoint?: string }
): ComfyUIError => ({
  type,
  message,
  status: options?.status,
  endpoint: options?.endpoint,
});

const classifyFetchError = (error: unknown, endpoint?: string): ComfyUIError => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return createComfyUIError('timeout', 'Request timed out.', { endpoint });
    }
    if (error instanceof TypeError) {
      return createComfyUIError(
        'cors',
        'Request blocked by CORS or a network error occurred.',
        { endpoint }
      );
    }
    return createComfyUIError('network', error.message, { endpoint });
  }
  return createComfyUIError('unknown', 'Unknown error.', { endpoint });
};

const buildUrl = (baseUrl: string, path: string): string => {
  if (!path.startsWith('/')) {
    return `${baseUrl}/${path}`;
  }
  return `${baseUrl}${path}`;
};

const buildPaths = (prefixMode: PrefixMode) => (prefixMode === 'api' ? API_PATHS : OSS_PATHS);

const encodeWorkflowPath = (name: string): string => {
  const trimmed = name.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const withPrefix = trimmed.startsWith('ps-workflows/') ? trimmed : `ps-workflows/${trimmed}`;
  const withExtension = withPrefix.endsWith('.json') ? withPrefix : `${withPrefix}.json`;
  return encodeURIComponent(withExtension);
};

const parseWorkflowList = (data: unknown): ComfyUIWorkflowInfo[] => {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (typeof item === 'string') {
          return { name: item, path: item };
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name : '';
          const path = typeof record.path === 'string' ? record.path : name;
          return {
            name: name || path,
            path,
            size: typeof record.size === 'number' ? record.size : undefined,
            modified: typeof record.modified === 'string' ? record.modified : undefined,
            isDirectory: typeof record.is_dir === 'boolean' ? record.is_dir : undefined,
          };
        }
        return null;
      })
      .filter((item): item is ComfyUIWorkflowInfo => Boolean(item && item.name));
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.files)) {
      return parseWorkflowList(record.files);
    }
    if (Array.isArray(record.items)) {
      return parseWorkflowList(record.items);
    }
  }

  return [];
};

const normalizeModelNames = (data: unknown): string[] => {
  const collected: string[] = [];

  const pushMaybeName = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.includes('.') || trimmed.includes('/')) {
      collected.push(trimmed);
    }
  };

  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      pushMaybeName(value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

    const record = value as Record<string, unknown>;
    pushMaybeName(record.name);
    pushMaybeName(record.model_name);
    pushMaybeName(record.filename);
    pushMaybeName(record.file);
    pushMaybeName(record.path);

    Object.entries(record).forEach(([key, nested]) => {
      pushMaybeName(key);
      if (nested && typeof nested === 'object') {
        walk(nested);
      }
    });
  };

  walk(data);
  return Array.from(new Set(collected));
};

const parseExperimentModelCatalog = (data: unknown): ExperimentModelCatalog => {
  const source = data && typeof data === 'object'
    ? (data as Record<string, unknown>)
    : {};
  if (Array.isArray(source.models)) {
    const grouped: ExperimentModelCatalog = {};
    source.models.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : 'default';
      const names = normalizeModelNames(record);
      if (names.length === 0) {
        return;
      }
      grouped[type] = Array.from(new Set([...(grouped[type] ?? []), ...names]));
    });
    return grouped;
  }

  const payload = source.models && typeof source.models === 'object'
    ? (source.models as Record<string, unknown>)
    : source;

  const result: ExperimentModelCatalog = {};
  Object.entries(payload).forEach(([key, value]) => {
    const normalized = normalizeModelNames(value);
    if (normalized.length > 0) {
      result[key] = normalized;
    }
  });

  return result;
};

export class ComfyUIClient {
  private baseUrl: string;
  private fetcher: Fetcher;
  private timeoutMs: number;
  private totalProbeTimeoutMs: number;
  private capabilities: ComfyUICapabilities | null = null;

  constructor(options: {
    baseUrl: string;
    fetcher?: Fetcher;
    timeoutMs?: number;
    totalProbeTimeoutMs?: number;
  }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    
    // 在 UXP WebView 环境中使用 Bridge 代理，否则使用原生 fetch
    if (options.fetcher) {
      this.fetcher = options.fetcher;
    } else if (isUXPWebView()) {
      console.log('[ComfyUI] Using Bridge proxy for network requests');
      this.fetcher = (url, init) => bridgeFetch(url.toString(), init, this.timeoutMs);
    } else {
      this.fetcher = fetch.bind(window);
    }
    
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.totalProbeTimeoutMs = options.totalProbeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  getCapabilities(): ComfyUICapabilities | null {
    return this.capabilities;
  }

  async probeEndpoints(): Promise<ComfyUICapabilities> {
    const startedAt = Date.now();

    const ossCore = await this.probeCoreEndpoints('oss', startedAt);
    const ossCoreMissing = this.isCoreMissing(ossCore);

    let selectedPrefix: PrefixMode = 'oss';
    let selectedCore = ossCore;

    if (ossCoreMissing) {
      const apiCore = await this.probeCoreEndpoints('api', startedAt);
      const apiCoreMissing = this.isCoreMissing(apiCore);
      if (!apiCoreMissing || this.countReachableCore(apiCore) > this.countReachableCore(ossCore)) {
        selectedPrefix = 'api';
        selectedCore = apiCore;
      }
    }

    const finalResult = await this.probePrefix(selectedPrefix, startedAt, selectedCore);

    this.capabilities = finalResult;
    return finalResult;
  }

  async listWorkflows(prefixMode?: PrefixMode): Promise<ComfyUIWorkflowInfo[]> {
    const mode = this.resolvePrefixMode(prefixMode);
    const paths = buildPaths(mode);
    const url = buildUrl(this.baseUrl, `${paths.userdata}?${WORKFLOW_LIST_QUERY}`);
    const response = await this.fetchJson(url);
    return parseWorkflowList(response);
  }

  async getObjectInfo(prefixMode?: PrefixMode): Promise<Record<string, unknown>> {
    const mode = this.resolvePrefixMode(prefixMode);
    const paths = buildPaths(mode);
    const url = buildUrl(this.baseUrl, paths.objectInfo);
    return this.fetchJson(url) as Promise<Record<string, unknown>>;
  }

  async getExperimentModels(): Promise<ExperimentModelCatalog> {
    const url = buildUrl(this.baseUrl, '/api/experiment/models');
    const response = await this.fetchJson(url);
    return parseExperimentModelCatalog(response);
  }

  async readWorkflow(name: string, prefixMode?: PrefixMode): Promise<unknown> {
    const mode = this.resolvePrefixMode(prefixMode);
    const paths = buildPaths(mode);
    const encoded = encodeWorkflowPath(name);
    const url = buildUrl(this.baseUrl, `${paths.userdata}/${encoded}`);
    return this.fetchJson(url);
  }

  async getHistory(prefixMode?: PrefixMode): Promise<Record<string, ComfyUIHistoryEntry>> {
    const mode = this.resolvePrefixMode(prefixMode);
    const paths = buildPaths(mode);
    const url = buildUrl(this.baseUrl, paths.history);
    return this.fetchJson(url) as Promise<Record<string, ComfyUIHistoryEntry>>;
  }

  async getHistoryDetail(promptId: string, prefixMode?: PrefixMode): Promise<ComfyUIHistoryEntry> {
    const mode = this.resolvePrefixMode(prefixMode);
    const paths = buildPaths(mode);
    const url = buildUrl(this.baseUrl, `${paths.history}/${promptId}`);
    return this.fetchJson(url) as Promise<ComfyUIHistoryEntry>;
  }

  async getQueue(prefixMode?: PrefixMode): Promise<ComfyUIQueueStatus> {
    const mode = this.resolvePrefixMode(prefixMode);
    const paths = buildPaths(mode);
    const url = buildUrl(this.baseUrl, paths.queue);
    const response = await this.fetchJson(url) as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };

    const parseQueueItem = (item: unknown): ComfyUIQueueItem | null => {
      if (!Array.isArray(item) || item.length < 2) return null;
      return {
        jobNumber: typeof item[0] === 'number' ? item[0] : 0,
        promptId: typeof item[1] === 'string' ? item[1] : '',
        workflow: item[2] ?? null,
        outputNodeIds: Array.isArray(item[3]) ? item[3] as string[] : [],
        metadata: (item[4] && typeof item[4] === 'object') ? item[4] as ComfyUIQueueItem['metadata'] : {},
      };
    };

    return {
      queueRunning: (response.queue_running ?? [])
        .map(parseQueueItem)
        .filter((item): item is ComfyUIQueueItem => item !== null),
      queuePending: (response.queue_pending ?? [])
        .map(parseQueueItem)
        .filter((item): item is ComfyUIQueueItem => item !== null),
    };
  }

  getViewUrl(options: ViewImageOptions): string {
    const { filename, type = 'output', subfolder = '', preview = false } = options;
    const params = new URLSearchParams({
      filename,
      type,
      subfolder,
    });
    if (preview) {
      params.set('preview', 'webp;quality=80');
    }
    return buildUrl(this.baseUrl, `/view?${params.toString()}`);
  }

  private async probePrefix(
    prefixMode: PrefixMode,
    startedAt: number,
    coreEndpoints?: CoreEndpointResults
  ): Promise<ComfyUICapabilities> {
    const paths = buildPaths(prefixMode);
    const endpoints: Record<EndpointKey, EndpointProbeResult> = {
      objectInfo: coreEndpoints?.objectInfo ?? await this.probeEndpoint(buildUrl(this.baseUrl, paths.objectInfo), startedAt),
      prompt: coreEndpoints?.prompt ?? await this.probeEndpoint(buildUrl(this.baseUrl, paths.prompt), startedAt),
      history: coreEndpoints?.history ?? await this.probeEndpoint(buildUrl(this.baseUrl, paths.history), startedAt),
      uploadImage: await this.probeUploadEndpoint(buildUrl(this.baseUrl, paths.uploadImage), startedAt),
      viewImage: await this.probeViewEndpoint(buildUrl(this.baseUrl, paths.viewImage), startedAt),
      ws: await this.probeWebSocketEndpoint(buildUrl(this.baseUrl, paths.ws), startedAt),
      userdata: await this.probeEndpoint(buildUrl(this.baseUrl, paths.userdata), startedAt),
      workflowList: { url: buildUrl(this.baseUrl, `${paths.userdata}?${WORKFLOW_LIST_QUERY}`), status: 'unknown' },
      workflowRead: { url: buildUrl(this.baseUrl, `${paths.userdata}/ps-workflows%2F<workflow>.json`), status: 'unknown' },
    };

    if (endpoints.userdata.status === 'ok' || endpoints.userdata.status === 'unknown') {
      endpoints.workflowList = await this.probeWorkflowList(prefixMode, startedAt);
      endpoints.workflowRead = await this.probeWorkflowRead(prefixMode, endpoints.workflowList, startedAt);
    }

    const version = await this.probeVersion(prefixMode, startedAt);

    const hasReachableCoreEndpoint =
      endpoints.objectInfo.status !== 'failed' ||
      endpoints.prompt.status !== 'failed' ||
      endpoints.history.status !== 'failed';
    const coreMissing = this.isCoreMissing({
      objectInfo: endpoints.objectInfo,
      prompt: endpoints.prompt,
      history: endpoints.history,
    });
    const prefixState: PrefixMode | 'unknown' = !coreMissing && hasReachableCoreEndpoint ? prefixMode : 'unknown';

    return {
      baseUrl: this.baseUrl,
      prefixMode: prefixState,
      endpoints,
      version,
      checkedAt: new Date().toISOString(),
    };
  }

  private async probeCoreEndpoints(prefixMode: PrefixMode, startedAt: number): Promise<CoreEndpointResults> {
    const paths = buildPaths(prefixMode);
    const objectInfo = await this.probeEndpoint(buildUrl(this.baseUrl, paths.objectInfo), startedAt);
    const prompt = await this.probeEndpoint(buildUrl(this.baseUrl, paths.prompt), startedAt);
    const history = await this.probeEndpoint(buildUrl(this.baseUrl, paths.history), startedAt);
    return { objectInfo, prompt, history };
  }

  private async probeVersion(prefixMode: PrefixMode, startedAt: number): Promise<string | undefined> {
    const paths = buildPaths(prefixMode);
    const url = buildUrl(this.baseUrl, paths.systemStats);
    const response = await this.safeFetchJson(url, startedAt);
    if (!response) {
      return undefined;
    }
    const record = response as Record<string, unknown>;
    const version = record.version || record.comfyui_version;
    return typeof version === 'string' ? version : undefined;
  }

  private async probeWorkflowList(
    prefixMode: PrefixMode,
    startedAt: number
  ): Promise<EndpointProbeResult> {
    const paths = buildPaths(prefixMode);
    const url = buildUrl(this.baseUrl, `${paths.userdata}?${WORKFLOW_LIST_QUERY}`);
    try {
      const response = await this.fetchJson(url, startedAt);
      const items = parseWorkflowList(response);
      return {
        url,
        status: 'ok',
        httpStatus: 200,
        error: items.length === 0 ? undefined : undefined,
      };
    } catch (error) {
      const friendly = isComfyUIError(error) ? error : classifyFetchError(error, url);
      return { url, status: 'failed', error: friendly, httpStatus: friendly.status };
    }
  }

  private async probeWorkflowRead(
    prefixMode: PrefixMode,
    listResult: EndpointProbeResult,
    startedAt: number
  ): Promise<EndpointProbeResult> {
    const paths = buildPaths(prefixMode);
    const placeholderUrl = buildUrl(this.baseUrl, `${paths.userdata}/ps-workflows%2F<workflow>.json`);
    if (listResult.status !== 'ok') {
      return { url: placeholderUrl, status: 'unknown' };
    }

    try {
      const listResponse = await this.fetchJson(
        buildUrl(this.baseUrl, `${paths.userdata}?${WORKFLOW_LIST_QUERY}`),
        startedAt
      );
      const workflows = parseWorkflowList(listResponse);
      if (workflows.length === 0) {
        return { url: placeholderUrl, status: 'unknown' };
      }
      const target = workflows[0];
      const encoded = encodeWorkflowPath(target.path || target.name);
      const url = buildUrl(this.baseUrl, `${paths.userdata}/${encoded}`);
      await this.fetchJson(url, startedAt);
      return { url, status: 'ok', httpStatus: 200 };
    } catch (error) {
      const friendly = isComfyUIError(error)
        ? { ...error, endpoint: error.endpoint ?? placeholderUrl }
        : classifyFetchError(error, placeholderUrl);
      return { url: placeholderUrl, status: 'failed', error: friendly, httpStatus: friendly.status };
    }
  }

  private async probeEndpoint(url: string, startedAt: number): Promise<EndpointProbeResult> {
    try {
      const response = await this.fetchWithTimeout(url, { method: 'GET' }, startedAt, {
        retryOnAbort: false,
      });
      const status = response.status;
    const isOk = response.ok;
    const endpointStatus: EndpointStatus = isOk ? 'ok' : 'unknown';
    return { url, status: endpointStatus, httpStatus: status };
    } catch (error) {
      const friendly = isComfyUIError(error)
        ? { ...error, endpoint: error.endpoint ?? url }
        : classifyFetchError(error, url);
      return { url, status: 'failed', error: friendly, httpStatus: friendly.status };
    }
  }

  private isCoreMissing(endpoints: CoreEndpointResults): boolean {
    return (
      endpoints.objectInfo.status === 'failed' ||
      endpoints.prompt.status === 'failed' ||
      endpoints.history.status === 'failed'
    );
  }

  private countReachableCore(endpoints: CoreEndpointResults): number {
    return [endpoints.objectInfo, endpoints.prompt, endpoints.history].filter((endpoint) => endpoint.status !== 'failed').length;
  }

  private async probeUploadEndpoint(url: string, startedAt: number): Promise<EndpointProbeResult> {
    try {
      const response = await this.fetchWithTimeout(url, { method: 'OPTIONS' }, startedAt, {
        retryOnAbort: false,
      });
      const status = response.status;
      const endpointStatus: EndpointStatus =
        response.ok || status === 405 || status === 415 || status === 400
          ? 'ok'
          : status === 404
          ? 'failed'
          : 'unknown';
      return { url, status: endpointStatus, httpStatus: status };
    } catch (error) {
      const friendly = isComfyUIError(error)
        ? { ...error, endpoint: error.endpoint ?? url }
        : classifyFetchError(error, url);
      return { url, status: 'failed', error: friendly, httpStatus: friendly.status };
    }
  }

  private async probeViewEndpoint(url: string, startedAt: number): Promise<EndpointProbeResult> {
    const probeUrl = `${url}?filename=${encodeURIComponent('__probe__.png')}&type=output&subfolder=`;
    try {
      const response = await this.fetchWithTimeout(probeUrl, { method: 'GET' }, startedAt, {
        retryOnAbort: false,
      });
      const status = response.status;
      const endpointStatus: EndpointStatus =
        response.ok || status === 400 || status === 404
          ? 'ok'
          : status === 401 || status === 403
          ? 'failed'
          : 'unknown';
      return { url, status: endpointStatus, httpStatus: status };
    } catch (error) {
      const friendly = isComfyUIError(error)
        ? { ...error, endpoint: error.endpoint ?? url }
        : classifyFetchError(error, url);
      return { url, status: 'failed', error: friendly, httpStatus: friendly.status };
    }
  }

  private async probeWebSocketEndpoint(url: string, startedAt: number): Promise<EndpointProbeResult> {
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    const remaining = this.totalProbeTimeoutMs - elapsed;
    if (startedAt && remaining <= 0) {
      return { url, status: 'failed', error: createComfyUIError('timeout', 'Probe timed out.', { endpoint: url }) };
    }

    if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') {
      return { url, status: 'unknown' };
    }

    const timeoutMs = Math.min(5000, Math.max(remaining, 1000));
    const wsUrl = url.replace(/^http/i, 'ws');
    const clientId = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<EndpointProbeResult>((resolve) => {
      let settled = false;
      let socket: WebSocket | null = null;
      const finalize = (result: EndpointProbeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
        resolve(result);
      };

      const timer = window.setTimeout(() => {
        finalize({
          url,
          status: 'failed',
          error: createComfyUIError('timeout', 'WebSocket probe timed out.', { endpoint: wsUrl }),
        });
      }, timeoutMs);

      try {
        socket = new WebSocket(`${wsUrl}?clientId=${encodeURIComponent(clientId)}`);
        socket.onopen = () => finalize({ url, status: 'ok', httpStatus: 101 });
        socket.onerror = () => {
          finalize({
            url,
            status: 'failed',
            error: createComfyUIError('network', 'WebSocket connection failed.', { endpoint: wsUrl }),
          });
        };
      } catch (error) {
        const friendly = isComfyUIError(error)
          ? { ...error, endpoint: error.endpoint ?? wsUrl }
          : classifyFetchError(error, wsUrl);
        finalize({ url, status: 'failed', error: friendly, httpStatus: friendly.status });
      }
    });
  }

  private async fetchJson(url: string, startedAt?: number): Promise<unknown> {
    const response = await this.fetchWithTimeout(url, { method: 'GET' }, startedAt);
    if (!response.ok) {
      throw createComfyUIError('http', `Request failed with status ${response.status}.`, {
        status: response.status,
        endpoint: url,
      });
    }
    return response.json();
  }

  private async safeFetchJson(url: string, startedAt: number): Promise<unknown | null> {
    try {
      return await this.fetchJson(url, startedAt);
    } catch {
      return null;
    }
  }

  private resolvePrefixMode(prefixMode?: PrefixMode): PrefixMode {
    if (prefixMode) {
      return prefixMode;
    }
    if (this.capabilities?.prefixMode === 'api' || this.capabilities?.prefixMode === 'oss') {
      return this.capabilities.prefixMode;
    }
    return 'oss';
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    startedAt?: number,
    options?: { retryOnAbort?: boolean }
  ): Promise<Response> {
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    const remaining = this.totalProbeTimeoutMs - elapsed;
    const timeoutMs = Math.min(this.timeoutMs, Math.max(remaining, 0));
    if (startedAt && remaining <= 0) {
      throw createComfyUIError('timeout', 'Probe timed out.', { endpoint: url });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      return response;
    } catch (error) {
      const isCorsLikeError = error instanceof TypeError;
      const canUseBridgeFallback = hasBridgeTransport();

      if (isCorsLikeError && canUseBridgeFallback) {
        return bridgeFetch(url, init, timeoutMs, {
          retryOnAbort: options?.retryOnAbort ?? true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
