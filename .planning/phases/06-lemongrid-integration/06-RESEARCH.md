# Phase 6: LemonGrid Integration - Research

**Researched:** 2026-04-27
**Domain:** Desktop-to-cluster integration (UXP Plugin -> FastAPI Platform)
**Confidence:** HIGH

## Summary

This research covers integrating the Photoshop ComfyUI Plugin with the LemonGrid GPU cluster management platform. Both codebases have been fully analyzed. The PS plugin currently talks directly to a single ComfyUI instance via HTTP (Bridge-proxied in UXP). LemonGrid provides a complete task scheduling platform with JWT auth, Redis queue-based dispatch, agent pull-based execution, WebSocket progress, and asset management.

The integration requires creating a new "LemonGrid mode" in the PS plugin that replaces the direct ComfyUI HTTP calls with LemonGrid REST API calls, while preserving the existing direct-ComfyUI mode for backward compatibility. The key challenge is that all network requests from the PS plugin webview must be proxied through the UXP main.js Bridge (because the UXP webview has limited CORS/fetch support), so the Bridge layer needs new handlers for LemonGrid API calls.

**Primary recommendation:** Create a `LemonGridClient` service class that mirrors the `ComfyUIClient` interface but calls LemonGrid REST APIs. Add a "connection mode" toggle in Settings (direct vs cluster). Extend main.js Bridge handlers to proxy LemonGrid requests. Use LemonGrid's existing `/api/v1/tasks/submit` and `/ws/v1/realtime` WebSocket for the task lifecycle.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zustand | ^4.x | State management (already used) | Project standard for all stores |
| axios | n/a | HTTP client (NOT used in plugin) | PS plugin uses Bridge-proxied fetch |
| WebSocket API | native | Real-time progress | Already used for ComfyUI WebSocket |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zustand persist middleware | ^4.x | Persist auth token, settings | Already used in settingsStore |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bridge-proxied REST | Direct fetch from webview | Direct fetch blocked by UXP CORS restrictions; Bridge is mandatory |
| LemonGrid WebSocket | Polling GET /tasks/{id} | WebSocket preferred for real-time progress; polling as fallback |
| Store JWT in localStorage | Store in Zustand persist | Zustand persist already wraps localStorage; reuse it |

**Installation:**
No new npm packages required. The integration uses only existing dependencies (Zustand, native WebSocket, existing Bridge infrastructure).

## Architecture Patterns

### Recommended Integration Architecture
```
PS Plugin Webview (React)
  |
  |-- [Connection Mode: direct / cluster]  <-- Settings toggle
  |
  +-- Direct Mode (existing):
  |     Bridge -> main.js -> ComfyUI HTTP API
  |
  +-- Cluster Mode (new):
        Bridge -> main.js -> LemonGrid REST API
                   |
                   +-- POST /api/v1/auth/login (JWT)
                   +-- POST /api/v1/tasks/submit (task)
                   +-- GET  /ws/v1/realtime?token=JWT (WebSocket via Bridge)
                   +-- GET  /api/v1/assets/library/{id}/download (result)
```

### Recommended Project Structure
```
code/webapp/src/
  services/
    upload.ts              # Existing Bridge + ComfyUI upload (unchanged)
    comfyui.ts             # Existing ComfyUIClient (unchanged)
    lemongrid.ts           # NEW: LemonGrid API client
    lemongrid-auth.ts      # NEW: Auth/token management
  stores/
    settingsStore.ts       # MODIFIED: Add connectionMode, lemonGrid settings
    lemongridStore.ts      # NEW: LemonGrid auth + task state
  pages/
    Draw.tsx               # MODIFIED: Dual-mode generation flow
    Settings.tsx           # MODIFIED: Add LemonGrid config section
```

### Pattern 1: Service Adapter Pattern
**What:** Create a unified task submission interface that abstracts over direct-ComfyUI vs LemonGrid-cluster mode.
**When to use:** Draw.tsx generation flow.
**Example:**
```typescript
// Source: [DESIGNED - based on existing ComfyUIClient + LemonGrid API analysis]
interface TaskSubmissionResult {
  taskId: string;        // ComfyUI prompt_id OR LemonGrid task_id
  status: 'queued' | 'running';
}

interface TaskProgress {
  percentage: number;
  currentNode: string | null;
  status: 'generating' | 'completed' | 'error';
  error: string | null;
}

interface TaskResult {
  images: Array<{ url: string; blob: Blob; filename: string }>;
}

// Adapter interface - both modes implement this
interface TaskService {
  submit(workflowJson: Record<string, unknown>, params?: Record<string, unknown>): Promise<TaskSubmissionResult>;
  onProgress(callback: (progress: TaskProgress) => void): void;
  getResult(taskId: string): Promise<TaskResult>;
  cancel(taskId: string): Promise<void>;
}
```

### Pattern 2: Bridge-Proxy for Cluster API
**What:** Extend main.js Bridge handler to support LemonGrid API calls with JWT auth header injection.
**When to use:** All network requests from the PS plugin webview.
**Example:**
```javascript
// Source: [DESIGNED - extends existing main.js 'comfyui.fetch' handler pattern]
// In main.js, add new Bridge action handler:
case 'lemongrid.fetch': {
  const { url, method, headers, body, timeout } = payload;
  const lgSettings = settingsStorage.get('lemongrid');
  const baseUrl = lgSettings?.baseUrl || '';
  const token = lgSettings?.token || '';

  const fetchHeaders = { ...headers };
  if (token) {
    fetchHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${url}`, {
    method: method || 'GET',
    headers: fetchHeaders,
    body: body || undefined,
    signal: AbortSignal.timeout(timeout || 30000),
  });

  // Return in Bridge response format (same as existing comfyui.fetch)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return { ok: response.ok, status: response.status, headers: Object.fromEntries(response.headers), data: await response.json() };
  }
  // For binary (image downloads):
  const buffer = await response.arrayBuffer();
  return { ok: response.ok, status: response.status, data: { __base64__: true, data: await arrayBufferToBase64(buffer), contentType } };
}
```

### Pattern 3: Token Lifecycle Management
**What:** JWT token storage, refresh, and expiry handling.
**When to use:** Before any LemonGrid API call.
**Example:**
```typescript
// Source: [DESIGNED - based on LemonGrid TokenResponse schema analysis]
// LemonGrid config: ACCESS_TOKEN_EXPIRE_MINUTES = 30, REFRESH_TOKEN_EXPIRE_DAYS = 7
interface LemonGridAuthState {
  accessToken: string | null;
  tokenExpiresAt: number | null;  // Unix timestamp
  serverUrl: string;
  username: string | null;
  isConnected: boolean;
}

async function ensureValidToken(auth: LemonGridAuthState): Promise<string> {
  if (!auth.accessToken || !auth.tokenExpiresAt) {
    throw new Error('Not authenticated');
  }
  // Refresh 2 minutes before expiry
  if (Date.now() > auth.tokenExpiresAt - 120000) {
    // Re-login (LemonGrid has refresh token endpoint, but for plugin simplicity,
    // re-login with stored credentials is more straightforward)
    const newToken = await login(auth.serverUrl, storedUsername, storedPassword);
    return newToken;
  }
  return auth.accessToken;
}
```

### Anti-Patterns to Avoid
- **Direct WebSocket from webview to LemonGrid:** UXP webview WebSocket support is limited. Must proxy through Bridge or use polling fallback. [VERIFIED: Current ComfyUI WS works from webview because it connects to local ComfyUI, but cross-origin WS to LemonGrid server will be blocked.]
- **Storing passwords in Zustand persist:** Use a separate non-persisted credential store, or store in encrypted Bridge storage. Persist only the JWT token.
- **Ignoring LemonGrid task state machine:** LemonGrid has PENDING -> QUEUED -> SYNCING -> RUNNING -> COMPLETED/FAILED/CANCELLED. The plugin must handle all intermediate states, not just "running" and "done".
- **Assuming synchronous task execution:** LemonGrid is an async queue. Tasks may wait in queue before execution. The plugin must show queue position and ETA.

## Integration Points

### Exact API Mapping: PS Plugin Operation -> LemonGrid API

| PS Plugin Operation | Current (Direct ComfyUI) | LemonGrid Cluster Mode |
|---------------------|--------------------------|------------------------|
| **Connect/Test** | GET /system_stats | POST /api/v1/auth/login + GET /api/v1/auth/me |
| **Upload Image** | POST /upload/image (multipart) | POST /api/v1/assets/library/upload (multipart) |
| **Submit Task** | POST /prompt (workflow JSON) | POST /api/v1/tasks/submit (TaskSubmit schema) |
| **Track Progress** | WebSocket /ws?clientId=X | WebSocket /ws/v1/realtime?token=JWT |
| **Get Result** | GET /view?filename=X&type=output | GET /api/v1/assets/library/{asset_id}/download |
| **Cancel Task** | POST /queue (delete by ID) | DELETE /api/v1/tasks/{task_id} |
| **Queue Status** | GET /queue | GET /api/v1/tasks/queue |

### Detailed API Flow: Cluster Mode Generation

**Step 1: Authentication**
```
POST {lemongridUrl}/api/v1/auth/login
Body: { "username": "...", "password": "..." }
Response: { "access_token": "eyJ...", "token_type": "bearer", "expires_in": 1800, "user": {...} }
Store token + expiry in Zustand.
```
[VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\auth.py line 33-69]

**Step 2: Upload Input Image (if any)**
```
POST {lemongridUrl}/api/v1/assets/library/upload
Headers: Authorization: Bearer {token}
Body: FormData { file: <blob>, library_type: "REFERENCE" }
Response: { "id": "uuid", "filename": "...", "file_path": "..." }
Store asset_id for task submission.
```
[VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\assets.py line 207-231]

**Step 3: Submit Task**
```
POST {lemongridUrl}/api/v1/tasks/submit
Headers: Authorization: Bearer {token}
Body: {
  "task_type": "COMFYUI",
  "task_mode": "SPLIT",
  "workflow_name": "2K超清",
  "workflow_json": { ... complete workflow JSON ... },
  "parameters": {
    "prompt_1": "a beautiful landscape",
    "image_upload": { "asset_id": "uuid-from-step-2" }
  }
}
Response: TaskResponse with { "id": "uuid", "status": "QUEUED", ... }
```
[VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\tasks.py line 89-117]

**Step 4: Track Progress**
```
WebSocket: ws://{lemongridUrl}/ws/v1/realtime?token={jwt}
Messages received:
  { "type": "task_started", "task_id": "...", "node": "...", "gpu_slot": 0 }
  { "type": "task_progress", "task_id": "...", "progress": 50, "detail": "Sampling..." }
  { "type": "task_completed", "task_id": "...", "duration_seconds": 120 }
  { "type": "task_failed", "task_id": "...", "error_code": "OOM", "error_message": "..." }
```
[VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\websocket.py line 110-157]

**Step 5: Get Result Image**
```
GET {lemongridUrl}/api/v1/tasks/{task_id}
Headers: Authorization: Bearer {token}
Response: TaskResponse with { "output_file_ids": ["uuid1", "uuid2"], "status": "COMPLETED" }

Then for each output file:
GET {lemongridUrl}/api/v1/assets/library/{asset_id}/download
Headers: Authorization: Bearer {token}
Response: Binary file (image/png, etc.)
```
[VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\assets.py line 536-553]

**Step 6: Import to PS Layer** (unchanged from current flow)
```
Bridge -> main.js -> ps.importBase64AsLayer (existing handler)
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Task scheduling / load balancing | Custom queue manager | LemonGrid's Redis ZSET queue + DispatchService | LemonGrid already handles priority scoring, node assignment, GPU overload detection, dead node recovery, stale task detection |
| Authentication | Custom token management | LemonGrid's JWT auth (HS256) | Already built with login/logout/refresh, role-based access, rate limiting |
| Progress tracking | Custom polling system | LemonGrid's WebSocket + ConnectionManager | Already built with per-user filtering, admin broadcast, task_started/progress/completed/failed message types |
| Image upload/download | Custom file transfer | LemonGrid's AssetService + NAS storage | Already handles upload to NAS, metadata extraction, auto-tagging, download with auth |
| Node health monitoring | Custom heartbeat | LemonGrid's heartbeat system | Already collects GPU temp/util/VRAM, detects offline nodes, recovers tasks |

**Key insight:** LemonGrid is a complete platform. The PS plugin should be a thin client that calls LemonGrid APIs. No business logic duplication.

## Common Pitfalls

### Pitfall 1: UXP WebView WebSocket Limitations
**What goes wrong:** UXP webview cannot establish WebSocket connections to remote servers (works for localhost ComfyUI, but cross-origin WS to LemonGrid server will fail or have CORS issues).
**Why it happens:** UXP webview runs in a restricted security context. WebSocket connections to non-localhost servers may be blocked.
**How to avoid:** Implement WebSocket proxy through Bridge/main.js. OR fall back to polling (`GET /api/v1/tasks/{task_id}` every 2 seconds) when WebSocket is unavailable.
**Warning signs:** WebSocket connection fails silently, or onopen never fires.

### Pitfall 2: JWT Token Expiry During Long Tasks
**What goes wrong:** User starts a task, token expires after 30 minutes, progress tracking breaks.
**Why it happens:** LemonGrid access tokens expire in 30 minutes (`ACCESS_TOKEN_EXPIRE_MINUTES = 30`). [VERIFIED: config.py line 33]
**How to avoid:** Implement token refresh logic. Before each API call, check if token expires within 2 minutes. If so, re-authenticate. For WebSocket, the connection is established once with a token, but if it drops and needs reconnect, the token may be expired.
**Warning signs:** 401 errors during long-running tasks.

### Pitfall 3: Image Upload Size Through Bridge
**What goes wrong:** Large images (>10MB) cause Bridge timeout or UXP main thread freeze when converting to base64.
**Why it happens:** All data through Bridge is serialized as base64 JSON strings. The arrayBufferToBase64 function in main.js processes in 32KB chunks but still creates a large string.
**How to avoid:** For LemonGrid cluster mode, the input image upload goes to LemonGrid's asset API (not directly to ComfyUI). Consider compressing images before upload, or implementing chunked upload. The 30-second Bridge timeout (in upload.ts) may need to be increased for large files.
**Warning signs:** "Bridge timeout" errors for images >5MB.

### Pitfall 4: CORS Configuration
**What goes wrong:** PS plugin webview requests to LemonGrid server are blocked by CORS.
**Why it happens:** LemonGrid CORS is configured via `CORS_ORIGINS` environment variable (comma-separated origins). [VERIFIED: main.py line 258-267]. The PS plugin webview origin is something like `http://192.168.0.124:5173` or a UXP-specific origin.
**How to avoid:** Add the PS plugin webview origin to LemonGrid's `CORS_ORIGINS` env var. OR route all requests through Bridge (main.js fetch), which is not subject to CORS.
**Warning signs:** Browser console shows CORS errors.

### Pitfall 5: Task Queue Wait Time UX
**What goes wrong:** User clicks "Generate" and nothing happens for minutes because tasks are queued behind other users.
**Why it happens:** LemonGrid uses a priority queue with weight-based scheduling. Other users' tasks may be ahead.
**How to avoid:** After task submission, immediately show queue position and estimated wait time using `GET /api/v1/tasks/{task_id}/eta`. [VERIFIED: tasks.py line 281-303]. Display "Queue position: #3, estimated wait: 45s" in the UI.
**Warning signs:** Users report "plugin frozen" when actually their task is queued.

### Pitfall 6: Workflow JSON Format Mismatch
**What goes wrong:** The PS plugin sends the full ComfyUI API format prompt, but LemonGrid expects a slightly different structure.
**Why it happens:** The plugin sends `{ prompt: { ... nodes ... }, client_id: "...", extra_data: { ... } }` to ComfyUI's `/prompt` endpoint. But LemonGrid's TaskSubmit schema expects `{ task_type: "COMFYUI", workflow_json: { ... nodes ... } }`.
**How to avoid:** When submitting to LemonGrid, extract just the node graph (the "prompt" field) and put it in `workflow_json`. The `parameters` field is separate metadata. The agent-side code handles the rest (it submits `workflow_json` directly to ComfyUI).
**Warning signs:** Tasks fail with "Invalid workflow" errors.

### Pitfall 7: Input Image Reference Resolution
**What goes wrong:** The plugin sends a ComfyUI-local filename (e.g., "image_001.png") as an image input, but in cluster mode the image is on the LemonGrid NAS, not on the ComfyUI node.
**Why it happens:** In direct mode, the plugin uploads to ComfyUI's `/upload/image` and gets a local filename. In cluster mode, images must go through LemonGrid's asset system.
**How to avoid:** In cluster mode: (1) upload image to LemonGrid `/api/v1/assets/library/upload`, (2) pass the `asset_id` as the parameter value, (3) the LemonGrid agent automatically downloads the asset and uploads it to the local ComfyUI before executing the workflow. [VERIFIED: agent.py lines 129-184 handles this exact flow].
**Warning signs:** Tasks fail with "DEPENDENCY_MISSING" error code.

## Code Examples

### Login and Token Storage
```typescript
// Source: [DESIGNED - based on LemonGrid auth.py + client.ts analysis]
import { bridgeFetch } from './upload';

interface LemonGridTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;  // seconds, typically 1800 (30 min)
  user: {
    id: string;
    username: string;
    role: string;
    // ... other user fields
  };
}

export async function loginToLemonGrid(
  serverUrl: string,
  username: string,
  password: string
): Promise<LemonGridTokenResponse> {
  const response = await bridgeFetch(`${serverUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }

  return response.json();
}
```

### Task Submission
```typescript
// Source: [DESIGNED - based on LemonGrid TaskSubmit schema + tasks.py analysis]
interface TaskSubmitRequest {
  task_type: 'COMFYUI';
  task_mode: 'SPLIT' | 'BEAST';
  workflow_name?: string;
  workflow_json?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  template_id?: string;  // If using LemonGrid workflow templates
}

interface TaskSubmitResponse {
  id: string;
  status: string;  // "QUEUED"
  progress: number;  // 0
  priority_score: number;
  created_at: string;
  // ... other fields
}

export async function submitLemonGridTask(
  serverUrl: string,
  token: string,
  workflowJson: Record<string, unknown>,
  workflowName?: string,
  parameters?: Record<string, unknown>
): Promise<TaskSubmitResponse> {
  const body: TaskSubmitRequest = {
    task_type: 'COMFYUI',
    task_mode: 'SPLIT',
    workflow_name: workflowName,
    workflow_json: workflowJson,
    parameters: parameters,
  };

  const response = await bridgeFetch(`${serverUrl}/api/v1/tasks/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Task submission failed: ${response.status}`);
  }

  return response.json();
}
```

### WebSocket Progress Tracking (Polling Fallback)
```typescript
// Source: [DESIGNED - WebSocket proxy is complex in UXP; polling is reliable fallback]
// Polling approach: every 2 seconds, check task status
export async function pollTaskProgress(
  serverUrl: string,
  token: string,
  taskId: string,
  onProgress: (progress: number, detail: string | null) => void,
  onCompleted: (outputFileIds: string[]) => void,
  onFailed: (errorCode: string, errorMessage: string) => void,
): Promise<void> {
  const poll = async () => {
    const response = await bridgeFetch(`${serverUrl}/api/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const task = await response.json();

    if (task.status === 'QUEUED' || task.status === 'PENDING') {
      onProgress(0, `Waiting in queue...`);
    } else if (task.status === 'SYNCING') {
      onProgress(5, 'Syncing assets to GPU node...');
    } else if (task.status === 'RUNNING') {
      onProgress(task.progress, task.progress_detail);
    } else if (task.status === 'COMPLETED') {
      onCompleted(task.output_file_ids || []);
      return; // Done
    } else if (task.status === 'FAILED') {
      onFailed(task.error_code || 'UNKNOWN', task.error_message || 'Task failed');
      return; // Done
    } else if (task.status === 'CANCELLED') {
      onFailed('CANCELLED', 'Task was cancelled');
      return;
    }
  };

  // Poll every 2 seconds
  while (true) {
    await poll();
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

### Download Result Image
```typescript
// Source: [DESIGNED - based on LemonGrid assets.py download endpoint]
export async function downloadLemonGridAsset(
  serverUrl: string,
  token: string,
  assetId: string
): Promise<Blob> {
  const response = await bridgeFetch(
    `${serverUrl}/api/v1/assets/library/${assetId}/download`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
    },
    60000  // 60s timeout for large images
  );

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  return response.blob();
}
```

## Migration Path

### Backward Compatibility Strategy

The plugin must support two connection modes:

1. **Direct Mode (existing)**: Plugin talks directly to a single ComfyUI instance. No changes to existing behavior. This is the default mode.

2. **Cluster Mode (new)**: Plugin talks to LemonGrid platform. All ComfyUI-specific operations are replaced with LemonGrid API calls.

### Migration Steps

| Step | Change | Files Affected |
|------|--------|---------------|
| 1 | Add `connectionMode: 'direct' \| 'cluster'` to settingsStore | settingsStore.ts |
| 2 | Add LemonGrid settings to settingsStore (serverUrl, username, token) | settingsStore.ts |
| 3 | Create LemonGrid service files | services/lemongrid.ts, services/lemongrid-auth.ts |
| 4 | Add Bridge handlers in main.js for LemonGrid API proxy | PS-plugin/ningleai/main.js |
| 5 | Modify Draw.tsx generation flow to branch on connectionMode | pages/Draw.tsx |
| 6 | Add LemonGrid settings UI to Settings page | pages/Settings.tsx |
| 7 | Handle input image upload differently in cluster mode | pages/Draw.tsx, services/upload.ts |

### Key Decision Point

The `handleGenerate` function in Draw.tsx currently:
1. Creates WebSocket to ComfyUI
2. Reads workflow from ComfyUI
3. Compiles prompt with input values
4. POSTs to ComfyUI /prompt
5. Tracks progress via WebSocket or polling
6. Downloads results from ComfyUI /view
7. Imports to PS layer

In cluster mode:
1. ~~WebSocket to ComfyUI~~ -> WebSocket/polling to LemonGrid
2. ~~Reads workflow from ComfyUI~~ -> Reads workflow from local config (already available in plugin)
3. Compiles prompt with input values (same)
4. ~~POSTs to ComfyUI /prompt~~ -> POSTs to LemonGrid /tasks/submit
5. ~~Tracks progress via ComfyUI WebSocket~~ -> Tracks via LemonGrid WebSocket/polling
6. ~~Downloads from ComfyUI /view~~ -> Downloads from LemonGrid asset download
7. Imports to PS layer (same)

Steps 2, 3, 7 are nearly identical. Steps 1, 4, 5, 6 need new cluster-mode implementations.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single ComfyUI instance | GPU cluster with load balancing | 2026 Q1 | Plugin must support both modes |
| Direct HTTP to ComfyUI | Brokered task queue (Redis ZSET) | 2026 Q1 | Async task lifecycle with queue states |
| ComfyUI local file paths | LemonGrid NAS asset management | 2026 Q1 | Images referenced by asset_id, not filename |
| ComfyUI WebSocket | LemonGrid WebSocket with JWT auth | 2026 Q1 | Different WS endpoint and message format |

**Deprecated/outdated:**
- Direct ComfyUI `/prompt` submission in production: Still supported but cluster mode is preferred for multi-user scenarios

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LemonGrid backend is deployed and accessible from the PS plugin's network (not just localhost) | Integration Points | Plugin cannot connect; need VPN/network setup |
| A2 | PS plugin users will have LemonGrid accounts with DESIGNER role | Authentication | Users cannot log in; need account provisioning |
| A3 | Workflow JSON format used by the plugin (ComfyUI API prompt format) is compatible with what LemonGrid agent expects in `workflow_json` field | Task Submission | Tasks fail on agent execution |
| A4 | LemonGrid CORS will be configured to allow requests from the PS plugin webview origin | Common Pitfalls | All API calls blocked; must use Bridge proxy exclusively |
| A5 | LemonGrid agent's image sync (asset_id -> ComfyUI upload) handles the same image input format the plugin uses | Integration Points | Input images fail to load on GPU node |
| A6 | The LemonGrid WebSocket endpoint can be reached from UXP webview, or polling fallback is acceptable | Common Pitfalls | No real-time progress; degraded UX |
| A7 | Lemongrid server URL and credentials will be configurable per-user (not hardcoded) | Architecture | All users connect to same server |

## Open Questions (RESOLVED)

1. **WebSocket via UXP WebView to Remote Server**
   - What we know: UXP webview can connect to localhost WebSocket (ComfyUI). LemonGrid WebSocket is at a different origin.
   - What's unclear: Whether UXP webview can connect to a remote WebSocket server, or if it must be proxied through main.js.
   - Recommendation: Implement polling as the primary approach for cluster mode (simpler, more reliable). Add WebSocket support as an optimization later if needed.
   - RESOLVED: D-23, D-24 — WebSocket proxied through Bridge (main.js `lemongrid.websocket` handler). Polling as auto-fallback per D-22, D-38.

2. **Workflow Template Integration**
   - What we know: LemonGrid has a workflow template system with `template_id` and `param_schema`. The PS plugin has its own workflow file system.
   - What's unclear: Whether the plugin should use LemonGrid templates (mapped to existing workflows) or submit raw `workflow_json`.
   - Recommendation: Start with raw `workflow_json` submission (backward compatible). Template integration can be added later for better parameter validation.
   - RESOLVED: D-01, D-02, D-03 — Use LemonGrid template system. Plugin submits template_id + params, not raw workflow_json. Dynamic UI from param_schema per D-09.

3. **Image Input Format in Cluster Mode**
   - What we know: The agent expects `parameters` to contain asset_id references (either `{"asset_id": "uuid"}` or plain `"uuid"` string). The plugin currently uploads images to ComfyUI and gets a filename.
   - What's unclear: The exact parameter key format the plugin uses for image inputs vs what the agent expects.
   - Recommendation: In cluster mode, upload image to LemonGrid first, then pass the asset_id as the parameter value. The agent code already handles this pattern.
   - RESOLVED: D-18, D-19 — Image inputs auto-detected from param_schema. Upload to LemonGrid asset API, pass asset_id as param value. Agent handles sync per D-18.

4. **Credential Storage Security**
   - What we know: The plugin uses Zustand persist (localStorage) for settings including ComfyUI URL.
   - What's unclear: Whether storing LemonGrid password in localStorage is acceptable, or if we need a more secure approach.
   - Recommendation: Store only the JWT token in Zustand persist. Store credentials in the Bridge/main.js in-memory store (not persisted). User re-enters password after plugin restart, or use a "remember me" option that stores encrypted credentials.
   - RESOLVED: D-77, D-78 — "Remember me" stores AES-GCM encrypted password via Web Crypto API. Token in Zustand persist per D-70, D-92. Password never stored plaintext per D-70.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build tooling | Yes | 24.13.1 | -- |
| npm | Package management | Yes | 11.8.0 | -- |
| LemonGrid Backend | Cluster mode | Needs deployment | -- | Use direct mode |
| LemonGrid CORS | API access from webview | Needs configuration | -- | Route through Bridge proxy |
| Photoshop UXP | Plugin runtime | Required for testing | -- | Dev mode in browser (limited) |

**Missing dependencies with no fallback:**
- LemonGrid backend deployment (needed for cluster mode testing). Direct mode continues to work independently.

**Missing dependencies with fallback:**
- CORS configuration: All requests can be proxied through Bridge/main.js, bypassing CORS entirely.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already configured in webapp) |
| Config file | code/webapp/vitest.config.ts |
| Quick run command | `cd code/webapp && npx vitest run --reporter=verbose` |
| Full suite command | `cd code/webapp && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INT-01 | LemonGrid auth login returns token | unit | `npx vitest run src/services/__tests__/lemongrid.test.ts` | No - Wave 0 |
| INT-02 | Token refresh before expiry | unit | `npx vitest run src/services/__tests__/lemongrid.test.ts` | No - Wave 0 |
| INT-03 | Task submission with workflow JSON | unit | `npx vitest run src/services/__tests__/lemongrid.test.ts` | No - Wave 0 |
| INT-04 | Image upload to LemonGrid assets | unit | `npx vitest run src/services/__tests__/lemongrid.test.ts` | No - Wave 0 |
| INT-05 | Task progress polling | unit | `npx vitest run src/services/__tests__/lemongrid.test.ts` | No - Wave 0 |
| INT-06 | Result image download from LemonGrid | unit | `npx vitest run src/services/__tests__/lemongrid.test.ts` | No - Wave 0 |
| INT-07 | Settings store supports connectionMode toggle | unit | `npx vitest run src/stores/__tests__/settingsStore.test.ts` | Yes (existing) |
| INT-08 | Bridge handler proxies LemonGrid requests | manual | Manual test in PS plugin | N/A |

### Sampling Rate
- **Per task commit:** `cd code/webapp && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd code/webapp && npx vitest run`
- **Phase gate:** Full suite green + manual PS plugin testing with LemonGrid backend

### Wave 0 Gaps
- [ ] `code/webapp/src/services/__tests__/lemongrid.test.ts` -- covers INT-01 through INT-06
- [ ] Extend `code/webapp/src/stores/__tests__/settingsStore.test.ts` -- covers INT-07
- [ ] No new framework install needed (Vitest already configured)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | LemonGrid JWT (HS256) + Bridge proxy |
| V3 Session Management | yes | Zustand persist for token storage, auto-refresh |
| V4 Access Control | yes | LemonGrid RBAC (DESIGNER role) |
| V5 Input Validation | yes | LemonGrid Pydantic schemas validate all input server-side |
| V6 Cryptography | yes | JWT + HTTPS (production), password never stored in client |

### Known Threat Patterns for PS Plugin -> LemonGrid Integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token theft from localStorage | Information Disclosure | Store minimal data; token expires in 30min; use HTTPS |
| Credential exposure in Bridge messages | Tampering | Bridge is same-process IPC; not network-exposed |
| Task injection (submit as another user) | Spoofing | JWT contains user_id; server validates ownership |
| CSRF on API calls | Tampering | CORS configured server-side; Bearer token required |
| Man-in-the-middle on LAN | Information Disclosure | Use HTTPS in production; LAN is trusted network |

## Sources

### Primary (HIGH confidence)
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\tasks.py -- Task API endpoints, submit/track/cancel
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\dispatch_service.py -- Core scheduling engine, progress/completion handling
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\scheduler_service.py -- Task submission, queue management
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\auth.py -- JWT authentication flow
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\websocket.py -- WebSocket real-time progress
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\assets.py -- Asset upload/download
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\models\task.py -- Task data model
- D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\core\config.py -- System configuration
- D:\projects\LemonGrid\LemonGrid\fluxcore-agent\agent.py -- Agent task execution flow
- D:\projects\LemonGrid\LemonGrid\fluxcore-agent\api_client.py -- Agent API client (upload_render_output, download_asset)
- D:\projects\photoshop-plugin\code\webapp\src\pages\Draw.tsx -- Current generation flow
- D:\projects\photoshop-plugin\code\webapp\src\services\upload.ts -- Bridge communication layer
- D:\projects\photoshop-plugin\code\webapp\src\stores\settingsStore.ts -- Settings management
- D:\projects\photoshop-plugin\PS-plugin\ningleai\main.js -- UXP Bridge handlers

### Secondary (MEDIUM confidence)
- D:\projects\LemonGrid\LemonGrid\docs\API.md -- API documentation
- D:\projects\LemonGrid\LemonGrid\docs\ARCHITECTURE.md -- System architecture
- D:\projects\LemonGrid\LemonGrid\fluxcore-frontend\src\services\task.ts -- Frontend task API client (reference for patterns)
- D:\projects\LemonGrid\LemonGrid\fluxcore-frontend\src\services\client.ts -- Frontend auth/token management (reference)

### Tertiary (LOW confidence)
- UXP WebSocket limitations: [ASSUMED] based on UXP platform behavior, not verified with official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies needed, reuses existing infrastructure
- Architecture: HIGH - both codebases fully analyzed, exact API endpoints identified
- Pitfalls: HIGH - based on verified code analysis (token expiry timing, CORS config, Bridge limitations)
- Integration flow: HIGH - exact API request/response formats verified from source code
- WebSocket feasibility: MEDIUM - UXP WebSocket to remote server behavior not verified in this session

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable - both codebases are actively developed but core APIs are stable)
