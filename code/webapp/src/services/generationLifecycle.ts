// Generation Lifecycle — runs a compiled ComfyUI prompt to completion.
//
// This module owns:
//   - Submitting the prompt via HTTP
//   - Watching for completion via WebSocket (primary) or polling (fallback)
//   - Fetching the output image blobs
//
// It does NOT own:
//   - Compiling the prompt (that's workflowEngine.ts)
//   - React/UI state updates (the caller passes an onProgress callback)
//   - Photoshop sync (caller handles the returned blobs)
//
// Two adapters sit behind the PromptWatcher seam:
//   - WebSocketWatcher: real-time progress via the ComfyUI WS protocol
//   - PollingWatcher:    polls /history/{promptId} until outputs appear
// Both are real because production uses WS and the fallback path uses polling —
// we don't introduce the seam speculatively.

import { ComfyUIClient } from './comfyui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { kind: 'started' }
  | { kind: 'cached' }
  | { kind: 'executing'; currentNode: string }
  | { kind: 'finished-node' }
  | { kind: 'progress'; percentage: number }
  | { kind: 'preview'; base64: string }
  | { kind: 'output'; images: OutputImageRef[] }
  | { kind: 'completed' };

export interface OutputImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export interface FetchedOutputImage {
  ref: OutputImageRef;
  blob: Blob;
  previewUrl: string;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RunGenerationOptions {
  baseUrl: string;
  prefixMode: 'api' | 'oss';
  clientId: string;
  prompt: Record<string, unknown>;
  extraData: { workflow_name?: string };
  fetcher: Fetcher;
  onProgress: (event: ProgressEvent) => void;
  /** Optional override for the WebSocket factory (for testing). */
  webSocketFactory?: (url: string) => WebSocket;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Pull image references from a ComfyUI history entry's `outputs` map.
 * Pure — testable in isolation.
 */
export const extractImagesFromHistory = (
  entry: { outputs?: Record<string, unknown> }
): OutputImageRef[] => {
  const images: OutputImageRef[] = [];
  const outputs = entry.outputs || {};
  Object.values(outputs).forEach((output) => {
    if (!output || typeof output !== 'object') return;
    const outputImages = (output as { images?: unknown }).images;
    if (!Array.isArray(outputImages)) return;
    outputImages.forEach((image) => {
      if (!image || typeof image !== 'object') return;
      const record = image as Record<string, unknown>;
      if (!record.filename) return;
      images.push({
        filename: String(record.filename),
        subfolder: String(record.subfolder || ''),
        type: String(record.type || 'output'),
      });
    });
  });
  return images;
};

// ---------------------------------------------------------------------------
// PromptWatcher — the seam
// ---------------------------------------------------------------------------

interface PromptWatcher {
  watch(promptId: string): Promise<OutputImageRef[]>;
  close(): void;
}

class WebSocketWatcher implements PromptWatcher {
  private socket: WebSocket;
  private messagePromptId: string | null = null;
  private resolveWatch: ((refs: OutputImageRef[]) => void) | null = null;
  private rejectWatch: ((err: Error) => void) | null = null;

  private readonly onProgress: (event: ProgressEvent) => void;
  constructor(
    wsUrl: string,
    onProgress: (event: ProgressEvent) => void,
    webSocketFactory?: (url: string) => WebSocket
  ) {
    this.onProgress = onProgress;
    this.socket = webSocketFactory
      ? webSocketFactory(wsUrl)
      : new WebSocket(wsUrl);
    this.attachHandlers();
  }

  watch(promptId: string): Promise<OutputImageRef[]> {
    this.messagePromptId = promptId;
    return new Promise<OutputImageRef[]>((resolve, reject) => {
      this.resolveWatch = resolve;
      this.rejectWatch = reject;
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }

  private attachHandlers() {
    this.socket.onmessage = (event) => {
      if (event.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => this.onProgress({ kind: 'preview', base64: reader.result as string });
        reader.readAsDataURL(event.data);
        return;
      }
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }

      const messagePromptId = data?.data?.prompt_id || data?.prompt_id;
      if (messagePromptId && this.messagePromptId && messagePromptId !== this.messagePromptId) {
        return; // not our prompt
      }

      switch (data.type) {
        case 'execution_start':
          this.onProgress({ kind: 'started' });
          break;
        case 'execution_cached':
          this.onProgress({ kind: 'cached' });
          break;
        case 'executing':
          if (data.data?.node) {
            this.onProgress({ kind: 'executing', currentNode: data.data.node });
          } else if (messagePromptId && messagePromptId === this.messagePromptId) {
            this.onProgress({ kind: 'finished-node' });
          }
          break;
        case 'progress': {
          const value = Number(data.data?.value ?? 0);
          const max = Number(data.data?.max ?? 0);
          const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
          this.onProgress({ kind: 'progress', percentage });
          break;
        }
        case 'executed': {
          const images = data.data?.output?.images;
          if (Array.isArray(images) && images.length > 0) {
            const refs: OutputImageRef[] = images.map((img: any) => ({
              filename: String(img.filename || ''),
              subfolder: String(img.subfolder || ''),
              type: String(img.type || 'output'),
            }));
            this.onProgress({ kind: 'output', images: refs });
            this.resolveWatch?.(refs);
          } else {
            this.onProgress({ kind: 'completed' });
            this.resolveWatch?.([]);
          }
          break;
        }
        default:
          break;
      }
    };
    this.socket.onerror = () => {
      this.rejectWatch?.(new Error('WebSocket 连接中断'));
    };
  }
}

class PollingWatcher implements PromptWatcher {
  private static readonly TIMEOUT_MS = 2 * 60 * 1000;
  private static readonly INTERVAL_MS = 1200;

  private readonly client: ComfyUIClient;
  private readonly promptId: string;
  private readonly prefixMode: 'api' | 'oss';
  private readonly onProgress: (event: ProgressEvent) => void;
  constructor(
    client: ComfyUIClient,
    promptId: string,
    prefixMode: 'api' | 'oss',
    onProgress: (event: ProgressEvent) => void
  ) {
    this.client = client;
    this.promptId = promptId;
    this.prefixMode = prefixMode;
    this.onProgress = onProgress;
  }

  close(): void {
    // PollingWatcher 无需主动 close（无 socket），但需实现 PromptWatcher 接口。
  }

  async watch(): Promise<OutputImageRef[]> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < PollingWatcher.TIMEOUT_MS) {
      try {
        const historyEntry = await this.client.getHistoryDetail(this.promptId, this.prefixMode);
        const images = extractImagesFromHistory(historyEntry);
        if (images.length > 0) {
          this.onProgress({ kind: 'output', images });
          return images;
        }
      } catch {
        // transient network error — keep polling
      }
      const elapsed = Date.now() - startedAt;
      const percentage = Math.min(95, Math.round((elapsed / PollingWatcher.TIMEOUT_MS) * 100));
      this.onProgress({ kind: 'progress', percentage });
      await new Promise((resolve) => setTimeout(resolve, PollingWatcher.INTERVAL_MS));
    }
    throw new Error('轮询生成结果超时');
  }
}

// ---------------------------------------------------------------------------
// Output image fetching
// ---------------------------------------------------------------------------

export async function fetchOutputImages(
  refs: OutputImageRef[],
  options: { baseUrl: string; prefixMode: 'api' | 'oss'; fetcher: Fetcher }
): Promise<FetchedOutputImage[]> {
  const prefix = options.prefixMode === 'api' ? '/api' : '';
  return Promise.all(refs.map(async (ref) => {
    const url = `${options.baseUrl}${prefix}/view?filename=${encodeURIComponent(ref.filename)}&type=${encodeURIComponent(ref.type)}&subfolder=${encodeURIComponent(ref.subfolder || '')}`;
    const response = await options.fetcher(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return { ref, blob, previewUrl: URL.createObjectURL(blob) };
  }));
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export async function submitPrompt(
  options: { baseUrl: string; prefixMode: 'api' | 'oss'; clientId: string; prompt: Record<string, unknown>; extraData: Record<string, unknown>; fetcher: Fetcher }
): Promise<string> {
  const prefix = options.prefixMode === 'api' ? '/api' : '';
  const response = await options.fetcher(`${options.baseUrl}${prefix}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: options.prompt,
      client_id: options.clientId,
      extra_data: options.extraData,
    }),
  });
  const responseData = await response.json();
  if (!response.ok) {
    throw new Error(responseData?.error?.message || `HTTP ${response.status}`);
  }
  if (!responseData.prompt_id) {
    throw new Error('No prompt_id returned from server');
  }
  return responseData.prompt_id as string;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const WS_CONNECT_TIMEOUT_MS = 5000;

async function tryOpenWatcher(
  options: RunGenerationOptions
): Promise<PromptWatcher | null> {
  const prefix = options.prefixMode === 'api' ? '/api' : '';
  const wsUrl = `${options.baseUrl.replace(/^http/i, 'ws')}${prefix}/ws?clientId=${options.clientId}`;

  const factory = options.webSocketFactory ?? ((url: string) => new WebSocket(url));
  const socket = factory(wsUrl);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), WS_CONNECT_TIMEOUT_MS);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket 连接失败')); };
    });
    return new WebSocketWatcher(wsUrl, options.onProgress, options.webSocketFactory);
  } catch {
    try { socket.close(); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Run a compiled prompt to completion and return the output image blobs.
 *
 * The orchestrator:
 *   1. Tries to open a WebSocket connection (5s timeout)
 *   2. Submits the prompt via HTTP
 *   3. Watches for completion using the chosen adapter
 *   4. Fetches the output image blobs
 *
 * Progress is reported via the `onProgress` callback. The caller is responsible
 * for translating events into UI state.
 */
export async function runGeneration(options: RunGenerationOptions): Promise<FetchedOutputImage[]> {
  // 1. Open watcher (WS or polling fallback)
  const wsWatcher = await tryOpenWatcher(options);
  const useWebSocket = wsWatcher !== null;

  // 2. Submit prompt
  const promptId = await submitPrompt({
    baseUrl: options.baseUrl,
    prefixMode: options.prefixMode,
    clientId: options.clientId,
    prompt: options.prompt,
    extraData: options.extraData,
    fetcher: options.fetcher,
  });

  // 3. Watch for completion
  let refs: OutputImageRef[];
  try {
    if (useWebSocket && wsWatcher) {
      refs = await wsWatcher.watch(promptId);
    } else {
      const client = new ComfyUIClient({ baseUrl: options.baseUrl });
      const poller = new PollingWatcher(client, promptId, options.prefixMode, options.onProgress);
      refs = await poller.watch();
    }
  } finally {
    wsWatcher?.close();
  }

  // 4. Fetch output image blobs
  return fetchOutputImages(refs, {
    baseUrl: options.baseUrl,
    prefixMode: options.prefixMode,
    fetcher: options.fetcher,
  });
}
