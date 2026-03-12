---
phase: quick-3-comfyui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - code/webapp/src/services/comfyui.ts
  - code/webapp/src/stores/comfyui.ts
  - code/webapp/src/pages/Draw.tsx
  - code/webapp/src/pages/Draw.css
autonomous: true
requirements: []
must_haves:
  truths:
    - "User can see current queue status (running and pending jobs)"
    - "Queue display updates automatically during generation"
    - "Queue info is fetched from ComfyUI server"
  artifacts:
    - path: "code/webapp/src/services/comfyui.ts"
      provides: "getQueue method for fetching ComfyUI queue"
      exports: ["getQueue", "ComfyUIQueueItem"]
    - path: "code/webapp/src/stores/comfyui.ts"
      provides: "Queue state management"
      exports: ["queueRunning", "queuePending", "fetchQueue"]
    - path: "code/webapp/src/pages/Draw.tsx"
      provides: "Queue display UI component"
      contains: "QueueStatus"
  key_links:
    - from: "Draw.tsx"
      to: "useComfyUIStore.queueRunning/queuePending"
      via: "Zustand store subscription"
      pattern: "useComfyUIStore.*queue"
    - from: "useComfyUIStore.fetchQueue"
      to: "ComfyUIClient.getQueue"
      via: "API call"
      pattern: "client\\.getQueue"
---

<objective>
Add ComfyUI task queue display to show running and pending jobs in the Draw page.

Purpose: Users need visibility into ComfyUI server queue status to understand wait times and job progress.
Output: Queue status display showing running/pending jobs with auto-refresh during generation.
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md

## Key Interfaces from Codebase

From code/webapp/src/services/comfyui.ts:
```typescript
export class ComfyUIClient {
  private baseUrl: string;
  private fetcher: Fetcher;
  async getHistory(prefixMode?: PrefixMode): Promise<Record<string, ComfyUIHistoryEntry>>;
  private async fetchJson(url: string, startedAt?: number): Promise<unknown>;
  private resolvePrefixMode(prefixMode?: PrefixMode): PrefixMode;
}
const OSS_PATHS = { history: '/history', ... };
const API_PATHS = { history: '/api/history', ... };
```

From code/webapp/src/stores/comfyui.ts:
```typescript
interface ComfyUIStoreState {
  baseUrl: string;
  capabilities: ComfyUICapabilities | null;
  error: ComfyUIError | null;
  // Actions
  probeEndpoints: () => Promise<ComfyUICapabilities>;
  listWorkflows: () => Promise<ComfyUIWorkflowInfo[]>;
}
export const useComfyUIStore = create<ComfyUIStoreState>((set, get) => ({ ... }));
```

From code/webapp/src/pages/Draw.tsx:
```typescript
// Generation progress state already exists
interface GenerationProgress {
  status: 'idle' | 'generating' | 'completed' | 'error';
  percentage: number;
  currentNode: string | null;
  previewImage: string | null;
  error: string | null;
  promptId: string | null;
}
const [progress, setProgress] = useState<GenerationProgress>({ ... });
const [isGenerating, setIsGenerating] = useState(false);
```

## ComfyUI Queue API Reference

Endpoint: `GET /queue`
Response:
```json
{
  "queue_running": [
    [job_number, prompt_id, workflow_json, output_node_ids, metadata]
  ],
  "queue_pending": [
    [job_number, prompt_id, workflow_json, output_node_ids, metadata]
  ]
}
```

Queue item tuple format:
- [0] job_number (integer)
- [1] prompt_id (string) - Job UUID
- [2] workflow_json (object)
- [3] output_node_ids (array)
- [4] metadata (object) with {create_time: timestamp}
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add getQueue method to ComfyUIClient</name>
  <files>code/webapp/src/services/comfyui.ts</files>
  <action>
    Add queue fetching capability to ComfyUIClient:

    1. Add queue types after ComfyUIHistoryEntry interface:
    ```typescript
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
    ```

    2. Add queue path to OSS_PATHS and API_PATHS:
    ```typescript
    const OSS_PATHS = {
      ...
      queue: '/queue',
    } as const;

    const API_PATHS = {
      ...
      queue: '/api/queue',
    } as const;
    ```

    3. Add getQueue method to ComfyUIClient class (after getHistoryDetail method):
    ```typescript
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
    ```

    Do NOT modify existing methods. Follow existing patterns for path resolution and error handling.
  </action>
  <verify>
    <automated>cd D:/projects/photoshop-plugin/code/webapp && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>getQueue method compiles without TypeScript errors and exports ComfyUIQueueItem, ComfyUIQueueStatus types</done>
</task>

<task type="auto">
  <name>Task 2: Add queue state to ComfyUI store</name>
  <files>code/webapp/src/stores/comfyui.ts</files>
  <action>
    Add queue state management to the Zustand store:

    1. Add imports at top:
    ```typescript
    import {
      ComfyUIClient,
      type ComfyUICapabilities,
      type ComfyUIError,
      type ComfyUIWorkflowInfo,
      type ComfyUIQueueStatus,  // Add this
      isComfyUIError,
      normalizeBaseUrl,
    } from '../services/comfyui';
    ```

    2. Extend ComfyUIStoreState interface (add after isLoadingWorkflow):
    ```typescript
    interface ComfyUIStoreState {
      // ... existing fields ...
      queueRunning: ComfyUIQueueStatus['queueRunning'];
      queuePending: ComfyUIQueueStatus['queuePending'];
      isLoadingQueue: boolean;
      // ... existing actions ...
      fetchQueue: () => Promise<ComfyUIQueueStatus>;
    }
    ```

    3. Add initial state in create call (after isLoadingWorkflow: false):
    ```typescript
    queueRunning: [],
    queuePending: [],
    isLoadingQueue: false,
    ```

    4. Add fetchQueue action (after readWorkflow action):
    ```typescript
    fetchQueue: async () => {
      set({ isLoadingQueue: true, error: null });
      try {
        const { baseUrl, capabilities } = get();
        const client = getClient(baseUrl);
        const queue = await client.getQueue(
          capabilities?.prefixMode === 'api' || capabilities?.prefixMode === 'oss'
            ? capabilities.prefixMode
            : undefined
        );
        set({
          queueRunning: queue.queueRunning,
          queuePending: queue.queuePending,
          isLoadingQueue: false,
        });
        return queue;
      } catch (error) {
        const storeError = withCorsGuidance(toStoreError(error));
        set({ isLoadingQueue: false, error: storeError });
        throw storeError;
      }
    },
    ```
  </action>
  <verify>
    <automated>cd D:/projects/photoshop-plugin/code/webapp && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>Store compiles and exports queueRunning, queuePending, isLoadingQueue, fetchQueue</done>
</task>

<task type="auto">
  <name>Task 3: Add queue display UI to Draw page</name>
  <files>code/webapp/src/pages/Draw.tsx, code/webapp/src/pages/Draw.css</files>
  <action>
    Add queue status display component to Draw page:

    1. In Draw.tsx, add to imports from stores:
    ```typescript
    const { queueRunning, queuePending, fetchQueue, isLoadingQueue } = useComfyUIStore();
    ```

    2. Add queue refresh effect (after loadConfig useEffect):
    ```typescript
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
      }, 2000);
      return () => clearInterval(interval);
    }, [isGenerating, fetchQueue]);
    ```

    3. Add queue status display JSX in the preview-header section (after the h2 title, before generating-badge):
    ```tsx
    {/* Queue Status Display */}
    {(queueRunning.length > 0 || queuePending.length > 0) && (
      <div className="queue-status">
        {queueRunning.length > 0 && (
          <span className="queue-badge queue-running">
            <span className="queue-icon">&#9881;</span>
            {queueRunning.length}
          </span>
        )}
        {queuePending.length > 0 && (
          <span className="queue-badge queue-pending">
            <span className="queue-icon">&#8987;</span>
            {queuePending.length}
          </span>
        )}
      </div>
    )}
    ```

    4. In Draw.css, add styles (after .generating-badge styles, around line 50):
    ```css
    /* Queue Status */
    .queue-status {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .queue-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .queue-badge .queue-icon {
      font-size: 11px;
    }

    .queue-running {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }

    .queue-pending {
      background: rgba(148, 163, 184, 0.3);
      color: #cbd5e1;
      border: 1px solid rgba(148, 163, 184, 0.3);
    }
    ```
  </action>
  <verify>
    <automated>cd D:/projects/photoshop-plugin/code/webapp && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>Queue status badges appear in preview header when jobs are running or pending, auto-refreshes every 2 seconds during generation</done>
</task>

</tasks>

<verification>
- TypeScript compilation passes without errors
- Queue badges visible when ComfyUI has jobs in queue
- Queue refreshes automatically during generation
</verification>

<success_criteria>
- User can see number of running jobs (green badge with gear icon)
- User can see number of pending jobs (gray badge with hourglass icon)
- Queue display only shows when there are jobs
- Queue auto-refreshes every 2 seconds during generation
</success_criteria>

<output>
After completion, create `.planning/quick/3-comfyui/3-SUMMARY.md`
</output>
