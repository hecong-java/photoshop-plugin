// Cluster Task Manager — owns the lifecycle of tasks submitted to the
// LemonGrid cluster backend. Extracted from Draw.tsx to separate pure
// parameter-shaping logic from I/O orchestration.
//
// Two adapters sit behind the ClusterTaskWatcher seam:
//   - WebSocketWatcher: real-time progress via Bridge + WebSocket
//   - PollingWatcher:    polls /api/v1/tasks/{id} for status updates
// Both are real: WS is the primary path, polling is the fallback when the
// WS connection drops (per the existing auto-fallback behavior).
//
// Pure functions live at the top; orchestration lives in ClusterTaskManager.
// The manager takes a `TaskStoreAdapter` so it can update task state without
// importing the Zustand store directly — keeping it testable.

import type {
  LemonGridTemplateDetail,
  LemonGridClient,
  LemonGridTaskStatus,
  TemplateType,
} from './lemongrid';
import { isImageParam } from './lemongrid';

// ---------------------------------------------------------------------------
// Pure helpers — testable in isolation
// ---------------------------------------------------------------------------

export type SeedMode = 'fixed' | 'increment' | 'decrement' | 'randomize';

/**
 * Compute the seed-value updates implied by a set of seed modes.
 * Pure: takes (currentParams, modes) → updates.
 */
export function applySeedModes(
  currentParams: Record<string, unknown>,
  seedModes: Record<string, SeedMode>
): Record<string, number> {
  const updates: Record<string, number> = {};
  for (const [fieldName, mode] of Object.entries(seedModes)) {
    const currentValue = currentParams[fieldName];
    if (typeof currentValue !== 'number') continue;
    switch (mode) {
      case 'fixed':
        // No update needed; current value stays.
        break;
      case 'increment':
        updates[fieldName] = currentValue + 1;
        break;
      case 'decrement':
        updates[fieldName] = currentValue - 1;
        break;
      case 'randomize':
        updates[fieldName] = Math.floor(Math.random() * 1000000000000000);
        break;
    }
  }
  return updates;
}

/**
 * Decide whether a value is a single LemonGrid asset ID (e.g. "abc-123-uuid")
 * vs. an array of asset IDs. Asset IDs always contain a '-' character.
 */
export function looksLikeAssetId(value: unknown): boolean {
  return typeof value === 'string' && value.includes('-') && value.length > 0;
}

/**
 * Build the API submission payload from a template's param_schema and the
 * current UI param values. Handles three cases:
 *   1. Image fields: include only if user uploaded a LemonGrid asset ID
 *   2. Hidden fields: always skipped (backend uses workflow defaults)
 *   3. Single asset ID arrays: unwrap to a string (backend rejects arrays)
 */
export function buildSnapshotParams(
  template: LemonGridTemplateDetail,
  uiParams: Record<string, unknown>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of template.param_schema) {
    if (field.hidden) continue;

    const key = `${field.node_id}.${field.name}`;
    const value = uiParams[key];

    if (field.type === 'image' || isImageParam(field)) {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (looksLikeAssetId(first)) {
          // Unwrap single-element arrays to a string; backend rejects arrays.
          snapshot[key] = value.length === 1 ? first : value;
        }
        // else: no real upload yet, skip — backend uses workflow default
      }
      continue;
    }

    snapshot[key] = value;
  }
  return snapshot;
}

/**
 * Map a LemonGrid task status to a terminal-state flag.
 */
export function isTerminalStatus(
  status: LemonGridTaskStatus['status']
): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * Choose polling interval based on task status.
 * 1s while running, 2s while pending/queued/syncing.
 */
export function pollIntervalFor(status: LemonGridTaskStatus['status']): number {
  return status === 'RUNNING' ? 1000 : 2000;
}

// ---------------------------------------------------------------------------
// Store adapter — abstracts the Zustand store so the manager is testable
// ---------------------------------------------------------------------------

export interface TaskStateUpdate {
  status?: LemonGridTaskStatus['status'];
  progress?: number;
  progressDetail?: string | null;
  queuePosition?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  outputAssetIds?: string[];
  completedAt?: number | null;
  durationSeconds?: number | null;
}

export interface TaskStoreAdapter {
  updateTask(taskId: string, update: TaskStateUpdate): void;
  removeTask(taskId: string): void;
  addOutputImage(image: { url: string; blob: Blob | null; filename: string; assetId: string }): void;
}

// ---------------------------------------------------------------------------
// ClusterTaskWatcher — the seam (WS + polling adapters)
// ---------------------------------------------------------------------------

export type ClusterProgressEvent =
  | { kind: 'status-changed'; status: LemonGridTaskStatus['status']; queuePosition: number | null }
  | { kind: 'progress'; progress: number; detail: string | null }
  | { kind: 'completed'; outputAssetIds: string[] }
  | { kind: 'failed'; errorCode: string; errorMessage: string };

export interface ClusterTaskWatcher {
  watch(taskId: string): Promise<ClusterProgressEvent>;
  close(): void;
}

export interface PollingWatcherDeps {
  client: LemonGridClient;
  ensureValidToken: () => Promise<string>;
  onProgress?: (event: ClusterProgressEvent) => void;
  intervalMs?: { running: number; pending: number };
  timeoutMs?: number;
}

export class PollingClusterWatcher implements ClusterTaskWatcher {
  private stopped = false;
  private static readonly DEFAULT_RUNNING_INTERVAL = 1000;
  private static readonly DEFAULT_PENDING_INTERVAL = 2000;
  private static readonly DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

  private readonly deps: PollingWatcherDeps;
  constructor(deps: PollingWatcherDeps) {
    this.deps = deps;
  }

  watch(taskId: string): Promise<ClusterProgressEvent> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const runningInterval = this.deps.intervalMs?.running ?? PollingClusterWatcher.DEFAULT_RUNNING_INTERVAL;
      const pendingInterval = this.deps.intervalMs?.pending ?? PollingClusterWatcher.DEFAULT_PENDING_INTERVAL;
      const timeoutMs = this.deps.timeoutMs ?? PollingClusterWatcher.DEFAULT_TIMEOUT_MS;

      const poll = async () => {
        if (this.stopped) return;
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error('轮询任务状态超时'));
          return;
        }
        try {
          await this.deps.ensureValidToken();
          const status = await this.deps.client.getTaskStatus(taskId);
          const event = this.toEvent(status);
          this.deps.onProgress?.(event);
          if (isTerminalStatus(status.status)) {
            resolve(event);
            return;
          }
          const interval = pollIntervalFor(status.status) ?? (status.status === 'RUNNING' ? runningInterval : pendingInterval);
          setTimeout(poll, interval);
        } catch (error) {
          // Transient error — keep polling. Auth errors are handled by ensureValidToken.
          setTimeout(poll, 2000);
        }
      };
      poll();
    });
  }

  close() {
    this.stopped = true;
  }

  private toEvent(status: LemonGridTaskStatus): ClusterProgressEvent {
    if (status.status === 'COMPLETED') {
      return { kind: 'completed', outputAssetIds: status.output_file_ids || [] };
    }
    if (status.status === 'FAILED') {
      return {
        kind: 'failed',
        errorCode: status.error_code || 'UNKNOWN',
        errorMessage: status.error_message || '任务失败',
      };
    }
    if (status.status === 'CANCELLED') {
      return { kind: 'failed', errorCode: 'CANCELLED', errorMessage: '任务已取消' };
    }
    return {
      kind: 'status-changed',
      status: status.status,
      queuePosition: status.queue_position,
    };
  }
}

// ---------------------------------------------------------------------------
// WebSocketClusterWatcher — uses Bridge for WS lifecycle
// ---------------------------------------------------------------------------

export interface WebSocketClusterWatcherDeps {
  /** Send a Bridge message to open a WebSocket connection. */
  openConnection: (taskId: string) => Promise<{ connectionId: string }>;
  /** Send a Bridge message to close a WebSocket connection. */
  closeConnection: (connectionId: string) => Promise<void>;
  /** Listen for messages from the Bridge; returns an unsubscribe function. */
  onMessage: (handler: (message: ClusterWsMessage) => void) => () => void;
  /** Listen for WS close events. */
  onClose: (handler: (taskId: string) => void) => () => void;
  onProgress?: (event: ClusterProgressEvent) => void;
  /** Fallback watcher used when WS connection fails. */
  fallback: ClusterTaskWatcher;
}

export interface ClusterWsMessage {
  taskId: string;
  data: {
    type: 'task_started' | 'task_progress' | 'task_completed' | 'task_failed' | string;
    progress?: number;
    detail?: string;
    duration_seconds?: number;
    error_code?: string;
    error_message?: string;
  };
}

export class WebSocketClusterWatcher implements ClusterTaskWatcher {
  private connectionId: string | null = null;
  private resolveWatch: ((event: ClusterProgressEvent) => void) | null = null;
  private rejectWatch: ((error: Error) => void) | null = null;
  private unsubscribers: Array<() => void> = [];
  private fallbackActive = false;
  private activeFallback: ClusterTaskWatcher | null = null;

  private readonly deps: WebSocketClusterWatcherDeps;
  constructor(deps: WebSocketClusterWatcherDeps) {
    this.deps = deps;
  }

  watch(taskId: string): Promise<ClusterProgressEvent> {
    return new Promise<ClusterProgressEvent>((resolve, reject) => {
      this.resolveWatch = resolve;
      this.rejectWatch = reject;

      this.setupMessageHandlers(taskId);
      this.setupCloseHandler(taskId);

      this.deps.openConnection(taskId)
        .then(({ connectionId }) => {
          this.connectionId = connectionId;
        })
        .catch((err) => {
          // WS failed → fall back to polling
          console.warn('[ClusterTaskManager] WS setup failed, falling back to polling:', err);
          this.activateFallback(taskId);
        });
    });
  }

  close() {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    if (this.connectionId) {
      this.deps.closeConnection(this.connectionId).catch(() => {});
      this.connectionId = null;
    }
    if (this.activeFallback) {
      this.activeFallback.close();
    }
  }

  private setupMessageHandlers(taskId: string) {
    const unsub = this.deps.onMessage((msg) => {
      if (msg.taskId !== taskId) return;
      const { type, progress, detail, error_code, error_message } = msg.data;
      switch (type) {
        case 'task_started':
          this.deps.onProgress?.({ kind: 'status-changed', status: 'RUNNING', queuePosition: null });
          break;
        case 'task_progress':
          this.deps.onProgress?.({
            kind: 'progress',
            progress: progress || 0,
            detail: detail || null,
          });
          break;
        case 'task_completed': {
          const event: ClusterProgressEvent = {
            kind: 'completed',
            outputAssetIds: [], // WS message doesn't include them; will be fetched via status API
          };
          this.deps.onProgress?.(event);
          this.resolveWatch?.(event);
          break;
        }
        case 'task_failed': {
          const event: ClusterProgressEvent = {
            kind: 'failed',
            errorCode: error_code || 'UNKNOWN',
            errorMessage: error_message || '任务失败',
          };
          this.deps.onProgress?.(event);
          this.resolveWatch?.(event);
          break;
        }
      }
    });
    this.unsubscribers.push(unsub);
  }

  private setupCloseHandler(taskId: string) {
    const unsub = this.deps.onClose((closedTaskId) => {
      if (closedTaskId !== taskId) return;
      if (this.fallbackActive) return; // already polling
      this.activateFallback(taskId);
    });
    this.unsubscribers.push(unsub);
  }

  private activateFallback(taskId: string) {
    this.fallbackActive = true;
    this.activeFallback = this.deps.fallback;
    this.activeFallback.watch(taskId)
      .then((event) => this.resolveWatch?.(event))
      .catch((err) => this.rejectWatch?.(err));
  }
}

// ---------------------------------------------------------------------------
// ClusterTaskManager — orchestrator
// ---------------------------------------------------------------------------

export interface ClusterTaskManagerDeps {
  client: LemonGridClient;
  store: TaskStoreAdapter;
  ensureValidToken: () => Promise<string>;
  webSocketDeps?: WebSocketClusterWatcherDeps;
}

export interface SubmitOptions {
  template: LemonGridTemplateDetail;
  uiParams: Record<string, unknown>;
  seedModes?: Record<string, SeedMode>;
}

export class ClusterTaskManager {
  private activeWatchers: Map<string, ClusterTaskWatcher> = new Map();

  private readonly deps: ClusterTaskManagerDeps;
  constructor(deps: ClusterTaskManagerDeps) {
    this.deps = deps;
  }

  /**
   * Submit a new task and start watching it.
   * Returns the task ID.
   */
  async submit(options: SubmitOptions): Promise<string> {
    const { template, uiParams, seedModes } = options;

    // Apply seed modes (pure computation)
    const effectiveParams = { ...uiParams };
    if (seedModes) {
      const seedUpdates = applySeedModes(effectiveParams, seedModes);
      Object.assign(effectiveParams, seedUpdates);
    }

    const snapshotParams = buildSnapshotParams(template, effectiveParams);
    const taskType: TemplateType = template.template_type || 'COMFYUI';

    const result = await this.deps.client.submitTask(
      template.id,
      snapshotParams,
      template.version,
      taskType
    );

    this.deps.store.updateTask(result.id, {
      status: result.status as LemonGridTaskStatus['status'],
    });

    this.startWatching(result.id);
    return result.id;
  }

  /**
   * Retry a previously failed task with the same params.
   */
  async retry(task: { id: string; templateId: string; params: Record<string, unknown>; templateType?: TemplateType; templateVersion: number }): Promise<string> {
    const taskType: TemplateType = task.templateType || 'COMFYUI';
    this.deps.store.removeTask(task.id);
    const result = await this.deps.client.submitTask(
      task.templateId,
      task.params,
      task.templateVersion || 1,
      taskType
    );
    this.deps.store.updateTask(result.id, { status: result.status as LemonGridTaskStatus['status'] });
    this.startWatching(result.id);
    return result.id;
  }

  /**
   * Cancel a running task.
   */
  async cancel(taskId: string): Promise<void> {
    const watcher = this.activeWatchers.get(taskId);
    watcher?.close();
    this.activeWatchers.delete(taskId);
    await this.deps.client.cancelTask(taskId);
    this.deps.store.updateTask(taskId, { status: 'CANCELLED' });
  }

  /**
   * Manually trigger completion handling for a task (e.g. when the user clicks
   * "import" on a previously-completed task).
   */
  async completeTask(taskId: string): Promise<Array<{ assetId: string; blob: Blob; filename: string; url: string }>> {
    // Ensure we have output_asset_ids
    let status: LemonGridTaskStatus;
    try {
      status = await this.deps.client.getTaskStatus(taskId);
    } catch (e) {
      throw new Error(`Failed to fetch task status: ${e instanceof Error ? e.message : String(e)}`);
    }

    this.deps.store.updateTask(taskId, {
      outputAssetIds: status.output_file_ids || [],
      completedAt: status.completed_at ? new Date(status.completed_at).getTime() : Date.now(),
      durationSeconds: status.duration_seconds,
    });

    const assetIds = status.output_file_ids || [];
    if (assetIds.length === 0) {
      return [];
    }

    const results: Array<{ assetId: string; blob: Blob; filename: string; url: string }> = [];
    for (const assetId of assetIds) {
      try {
        const blob = await this.deps.client.downloadAsset(assetId);
        const filename = `cluster-${assetId.substring(0, 8)}.png`;
        const url = URL.createObjectURL(blob);
        this.deps.store.addOutputImage({ url, blob, filename, assetId });
        results.push({ assetId, blob, filename, url });
      } catch (e) {
        console.error(`[ClusterTaskManager] Failed to download asset ${assetId}:`, e);
      }
    }
    return results;
  }

  /**
   * Stop all active watchers — used on component unmount.
   */
  closeAll() {
    for (const watcher of this.activeWatchers.values()) {
      watcher.close();
    }
    this.activeWatchers.clear();
  }

  private startWatching(taskId: string) {
    const onProgress = (event: ClusterProgressEvent) => {
      switch (event.kind) {
        case 'status-changed':
          this.deps.store.updateTask(taskId, {
            status: event.status,
            queuePosition: event.queuePosition,
          });
          break;
        case 'progress':
          this.deps.store.updateTask(taskId, {
            status: 'RUNNING',
            progress: event.progress,
            progressDetail: event.detail,
          });
          break;
        case 'failed':
          this.deps.store.updateTask(taskId, {
            status: 'FAILED',
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
          });
          break;
        case 'completed':
          // WS completion doesn't include asset IDs; completeTask() will fetch them
          this.deps.store.updateTask(taskId, { status: 'COMPLETED', progress: 100 });
          break;
      }
    };

    let watcher: ClusterTaskWatcher;
    if (this.deps.webSocketDeps) {
      const pollingDeps: PollingWatcherDeps = {
        client: this.deps.client,
        ensureValidToken: this.deps.ensureValidToken,
        onProgress,
      };
      const pollingWatcher = new PollingClusterWatcher(pollingDeps);
      watcher = new WebSocketClusterWatcher({
        ...this.deps.webSocketDeps,
        onProgress,
        fallback: pollingWatcher,
      });
    } else {
      watcher = new PollingClusterWatcher({
        client: this.deps.client,
        ensureValidToken: this.deps.ensureValidToken,
        onProgress,
      });
    }

    this.activeWatchers.set(taskId, watcher);
    watcher.watch(taskId).catch((err) => {
      console.error(`[ClusterTaskManager] Watcher for ${taskId} failed:`, err);
    });
  }
}
