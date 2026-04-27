# Phase 6: LemonGrid Integration - Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 8 (4 new, 4 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `code/webapp/src/services/lemongrid.ts` (NEW) | service | request-response | `code/webapp/src/services/comfyui.ts` | exact |
| `code/webapp/src/services/lemongrid-auth.ts` (NEW) | service | request-response | `code/webapp/src/services/upload.ts` | role-match |
| `code/webapp/src/stores/lemongridStore.ts` (NEW) | store | CRUD | `code/webapp/src/stores/settingsStore.ts` | exact |
| `code/webapp/src/stores/settingsStore.ts` (MOD) | store | CRUD | (self -- extend existing) | self |
| `code/webapp/src/pages/Draw.tsx` (MOD) | component | request-response + event-driven | (self -- extend existing) | self |
| `code/webapp/src/pages/Settings.tsx` (MOD) | component | request-response | (self -- extend existing) | self |
| `PS-plugin/ningleai/main.js` (MOD) | controller | request-response + streaming | (self -- extend existing) | self |
| `code/webapp/src/stores/presetStore.ts` (MOD) | store | CRUD | (self -- extend existing) | self |

## Pattern Assignments

### `code/webapp/src/services/lemongrid.ts` (NEW -- service, request-response)

**Analog:** `code/webapp/src/services/comfyui.ts`

**Imports pattern** (lines 1-2):
```typescript
import { isUXPWebView, bridgeFetch, hasBridgeTransport } from './upload';
```

**Class constructor pattern** (lines 307-334):
```typescript
export class ComfyUIClient {
  private baseUrl: string;
  private fetcher: Fetcher;
  private timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    fetcher?: Fetcher;
    timeoutMs?: number;
  }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);

    if (options.fetcher) {
      this.fetcher = options.fetcher;
    } else if (isUXPWebView()) {
      console.log('[ComfyUI] Using Bridge proxy for network requests');
      this.fetcher = (url, init) => bridgeFetch(url.toString(), init, this.timeoutMs);
    } else {
      this.fetcher = fetch.bind(window);
    }

    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }
```

**Key pattern to replicate:** `LemonGridClient` mirrors this constructor but injects JWT `Authorization` header into every request. Instead of `comfyui.fetch` Bridge action, it uses a new `lemongrid.fetch` Bridge action. The client wraps each API call in `bridgeFetch` (or native fetch in browser mode).

**JSON fetch helper pattern** (lines 696-705):
```typescript
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
```

**Key API methods to implement (modeled after ComfyUIClient methods):**
- `login(username, password)` -> POST `/api/v1/auth/login`
- `getProfile()` -> GET `/api/v1/auth/me` (modeled after `getHistory` line 393)
- `submitTask(params)` -> POST `/api/v1/tasks/submit` (modeled after prompt POST in Draw.tsx lines 2911-2919)
- `getTaskStatus(taskId)` -> GET `/api/v1/tasks/{taskId}` (modeled after `getHistoryDetail` line 400)
- `cancelTask(taskId)` -> DELETE `/api/v1/tasks/{taskId}` (modeled after `getQueue` but with DELETE method)
- `listTemplates()` -> GET `/api/v1/templates` (modeled after `listWorkflows` line 364)
- `getTemplateDetail(templateId)` -> GET `/api/v1/templates/{id}` (modeled after `readWorkflow` line 385)
- `uploadAsset(file)` -> POST `/api/v1/assets/library/upload` (modeled after upload pattern)
- `downloadAsset(assetId)` -> GET `/api/v1/assets/library/{id}/download` (modeled after binary response in main.js lines 842-855)

---

### `code/webapp/src/services/lemongrid-auth.ts` (NEW -- service, request-response)

**Analog:** `code/webapp/src/services/upload.ts` (bridgeFetch pattern)

**Core pattern -- bridgeFetch with auth headers** (lines 133-163):
```typescript
export async function bridgeFetch(
  url: string,
  options: RequestInit = {},
  timeout: number = 30000,
  bridgeOptions?: { retryOnAbort?: boolean }
): Promise<Response> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {};

  if (options.headers) {
    const headersObj = options.headers as Record<string, string>;
    for (const [key, value] of Object.entries(headersObj)) {
      headers[key] = value;
    }
  }

  const result = await sendBridgeMessage('comfyui.fetch', {
    url,
    method,
    headers,
    body: options.body as string | undefined,
    timeout,
    retryOnAbort: bridgeOptions?.retryOnAbort ?? true
  }) as {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: unknown;
  };
```

**Key difference for lemongrid-auth:** The new service calls `sendBridgeMessage('lemongrid.fetch', ...)` instead of `'comfyui.fetch'`. The Bridge handler `lemongrid.fetch` in main.js will automatically inject the JWT `Authorization` header from stored settings, so the webview-side code does not need to pass the token in headers explicitly.

**Binary response handling pattern** (lines 180-206):
```typescript
arrayBuffer: async () => {
  if (isBridgeBinaryPayload(result.data)) {
    const base64 = result.data.data;
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  // ...
},
blob: async () => {
  if (isBridgeBinaryPayload(result.data)) {
    const base64 = result.data.data;
    const contentType = result.data.contentType || 'application/octet-stream';
    // ... same conversion
    return new Blob([bytes], { type: contentType });
  }
  // ...
},
```

**Key functions to implement in lemongrid-auth.ts:**
- `lemongridFetch(url, options, timeout)` -- wraps `sendBridgeMessage('lemongrid.fetch', ...)` with same response-shaping as `bridgeFetch`
- `ensureValidToken()` -- checks token expiry from lemongridStore, calls refresh/re-login if needed
- `loginToLemonGrid(serverUrl, username, password)` -- calls `lemongridFetch` to POST `/api/v1/auth/login`
- `refreshToken()` -- calls `lemongridFetch` to POST `/api/v1/auth/refresh`

---

### `code/webapp/src/stores/lemongridStore.ts` (NEW -- store, CRUD)

**Analog:** `code/webapp/src/stores/settingsStore.ts`

**Zustand persist pattern** (lines 52-93):
```typescript
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      autoSave: true,
      comfyUI: DEFAULT_COMFYUI_SETTINGS,
      dashScope: DEFAULT_DASHSCOPE_SETTINGS,
      setTheme: (theme) => set({ theme }),
      setAutoSave: (enabled) => set({ autoSave: enabled }),
      setComfyUIBaseUrl: (baseUrl) =>
        set((state) => ({
          comfyUI: { ...state.comfyUI, baseUrl, isConnected: false, capabilities: null },
        })),
      setComfyUIConnected: (connected, prefixMode, capabilities) =>
        set((state) => ({
          comfyUI: {
            ...state.comfyUI,
            isConnected: connected,
            lastChecked: new Date().toISOString(),
            prefixMode: prefixMode ?? state.comfyUI.prefixMode,
            capabilities: capabilities ?? state.comfyUI.capabilities,
          },
        })),
    }),
    {
      name: 'Ningleai-settings',
      partialize: (state) => ({
        theme: state.theme,
        autoSave: state.autoSave,
        comfyUI: state.comfyUI,
        dashScope: state.dashScope,
      }),
    }
  )
);
```

**Key pattern to replicate for lemongridStore:**
- Same `create<State>()(persist(...))` structure
- Persist name: `'Ningleai-lemongrid'`
- State fields: `serverUrl`, `accessToken`, `refreshToken`, `tokenExpiresAt`, `username`, `userRole`, `isConnected`, `encryptedPassword`, `rememberMe`, `tasks` (Map of task_id -> task state), `clusterOutputImages`
- Actions: `setAuth(tokens)`, `clearAuth()`, `setConnected(bool)`, `updateTask(taskId, state)`, `removeTask(taskId)`, `setEncryptedPassword(pwd)`, `clearEncryptedPassword()`
- `partialize` should persist: `serverUrl`, `accessToken`, `refreshToken`, `tokenExpiresAt`, `username`, `userRole`, `encryptedPassword`, `rememberMe` -- NOT tasks (transient)

**Also reference `workflowCacheStore.ts`** for its `partialize` + `migrate` pattern (lines 94-108):
```typescript
{
  name: 'Ningleai-workflow-cache',
  version: 1,
  migrate: (persisted: any, version: number) => {
    if (version === 0) {
      return { caches: {} };
    }
    return persisted;
  },
  partialize: (state) => ({
    caches: state.caches,
  }),
}
```

---

### `code/webapp/src/stores/settingsStore.ts` (MOD -- store, CRUD)

**Self-extension.** Add `connectionMode` field.

**Current state interface** (lines 24-37):
```typescript
interface SettingsState {
  theme: 'light' | 'dark';
  autoSave: boolean;
  psImportMode: PSImportMode;
  comfyUI: ComfyUISettings;
  dashScope: DashScopeSettings;
  // ADD: connectionMode: 'direct' | 'cluster'
  setTheme: (theme: 'light' | 'dark') => void;
  // ADD: setConnectionMode: (mode: 'direct' | 'cluster') => void
  // ...
}
```

**Extension pattern:**
- Add `connectionMode: 'direct' | 'cluster'` to state interface, default `'direct'`
- Add `setConnectionMode` action
- Add `connectionMode` to `partialize` for persistence
- No structural changes -- just new field + setter

---

### `code/webapp/src/pages/Draw.tsx` (MOD -- component, request-response + event-driven)

**Self-extension.** Branch `handleGenerate` on `connectionMode`.

**Current handleGenerate flow** (lines 2619-2952):
1. Guard: check `comfyUISettings.isConnected` (line 2623)
2. Create WebSocket to ComfyUI (lines 2650-2677)
3. Read workflow from ComfyUI (line 2679)
4. Compile prompt with input values (lines 2774-2777)
5. POST to `/prompt` (lines 2911-2919)
6. Track via WebSocket or polling (lines 2792-2901, 2488-2532)
7. Download output images (lines 2866-2877)
8. Import to PS layer (lines 2426-2454)

**Branching pattern at `handleGenerate`:**
After the guard at line 2623, read `connectionMode` from settingsStore:
```typescript
const connectionMode = useSettingsStore.getState().connectionMode;
if (connectionMode === 'cluster') {
  // Cluster Mode: submit via LemonGridClient
  // No WebSocket setup needed (polling-based)
  // No workflow read from ComfyUI (use local workflow data)
  // Submit template_id + params to LemonGrid
  // Poll task status
  // Download results from LemonGrid asset API
} else {
  // Direct Mode: existing flow (unchanged)
}
```

**Polling pattern to replicate** (lines 2488-2532):
```typescript
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
      // ... check completion, extract images
    } catch (error) {
      console.warn('[Draw] polling failed:', error);
    }
    setProgress((prev) => ({ ...prev, percentage, currentNode: '...' }));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('polling timeout');
};
```

**PS layer import (reused unchanged)** (lines 2603-2617):
```typescript
const syncGeneratedImageToPs = async (blob: Blob, comfyFilename: string) => {
  if (!isUXPWebView()) return;
  const base64Data = await fileToBase64(file);
  await importBase64ToPsLayer({
    base64Data,
    mode: psImportMode,
    workflowName: selectedWorkflow?.name || 'comfyui-output',
    layerName: normalizedName,
    mimeType: 'image/png'
  });
};
```

---

### `code/webapp/src/pages/Settings.tsx` (MOD -- component, request-response)

**Self-extension.** Add mode toggle radio buttons and LemonGrid settings section.

**Current page layout** (lines 96-243):
```typescript
<div className="settings-page">
  <h1 className="settings-title">...</h1>
  <div className="settings-grid">
    {/* ComfyUI Connection Column */}
    <div className="settings-card comfy-connection">
      <div className="card-header">
        <h2>ComfyUI 连接</h2>
        <span className={`connection-status ${connectionStatus.class}`}>
          {connectionStatus.text}
        </span>
      </div>
      <div className="connection-form">
        {/* URL input + test button */}
      </div>
    </div>
    {/* DashScope Config Column */}
    {/* Capabilities Matrix Column */}
  </div>
</div>
```

**Extension pattern:**
- Add mode toggle section at top of settings-grid (radio buttons for Direct/Cluster)
- Conditionally show/hide ComfyUI section vs LemonGrid section based on `connectionMode`
- LemonGrid section mirrors ComfyUI card structure: card-header with status badge, connection-form with URL input + login button + logout button

**Connection status pattern** (lines 21-25):
```typescript
const getConnectionStatus = () => {
  if (isProbing) return { text: '...', class: 'connecting' };
  if (!comfyUI.isConnected) return { text: '...', class: 'disconnected' };
  return { text: '...', class: 'connected' };
};
```

---

### `PS-plugin/ningleai/main.js` (MOD -- controller, request-response + streaming)

**Self-extension.** Add 3 new Bridge handlers to `handlers` object.

**Handler dispatch pattern** (lines 602, 1117-1167):
```javascript
const handlers = {
  'settings.get': async (payload) => { /* ... */ },
  'comfyui.fetch': async (payload) => { /* ... */ },
  'comfyui.uploadImage': async (payload) => { /* ... */ },
  // ADD: 'lemongrid.fetch', 'lemongrid.websocket', 'lemongrid.uploadAsset'
};

const processBridgeMessage = async (rawMessage, channel, source) => {
  const { uuid, action: actionName, payload } = rawMessage;
  const handler = handlers[actionName];
  const responseData = await handler(payload || {});
  replyTarget.postMessage({ uuid, state: 'fulfilled', data: responseData });
};
```

**comfyui.fetch handler pattern** (lines 791-875) -- template for `lemongrid.fetch`:
```javascript
'comfyui.fetch': async (payload) => {
  const { url, method = 'GET', headers = {}, body, timeout = 30000, retryOnAbort = true } = payload;

  if (!url || typeof url !== 'string') {
    throw new Error('comfyui.fetch: missing or invalid "url" parameter');
  }

  try {
    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
    };

    if (body && method !== 'GET') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const performFetchWithTimeout = async (requestTimeout) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);
      try {
        return await fetch(url, { ...fetchOptions, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // ... retry logic, response handling (JSON, binary base64, text)

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data: responseData
    };
  } catch (error) {
    throw { code: 'FETCH_ERROR', message: error.message, url };
  }
},
```

**Key difference for `lemongrid.fetch`:** Before calling `fetch()`, inject JWT Authorization header from `settingsStorage.get('lemongrid')`:
```javascript
'lemongrid.fetch': async (payload) => {
  const { url, method = 'GET', headers = {}, body, timeout = 30000 } = payload;
  const lgSettings = settingsStorage.get('lemongrid') || {};
  const token = lgSettings.accessToken || '';

  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...headers
    },
  };
  // ... rest follows comfyui.fetch pattern exactly
```

**comfyui.uploadImage handler pattern** (lines 878-946) -- template for `lemongrid.uploadAsset`:
```javascript
'comfyui.uploadImage': async (payload) => {
  const { url, filename, base64Data, mimeType = 'image/png' } = payload;
  // base64 -> Uint8Array conversion
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Build multipart/form-data
  const boundary = '----FormBoundary' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="image"; filename="${filename}"\r\n`);
  parts.push(`Content-Type: ${mimeType}\r\n\r\n`);

  const headerBlob = new Blob([parts.join('')]);
  const footerBlob = new Blob(['\r\n--' + boundary + '--\r\n']);
  const formDataBlob = new Blob([headerBlob, bytes, footerBlob]);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: formDataBlob
  });
  // ... response handling
```

**Key difference for `lemongrid.uploadAsset`:** Inject JWT header, use `name="file"` (LemonGrid's field name) instead of `name="image"`, add `library_type` form field, and the URL includes the LemonGrid base URL prefix.

**`lemongrid.websocket` handler (NEW -- no existing analog in main.js):**
This handler creates a WebSocket in main.js to LemonGrid's `/ws/v1/realtime?token=JWT` and relays messages to the webview via `postMessage`. Pattern:
```javascript
'lemongrid.websocket': async (payload) => {
  const { taskId } = payload;
  const lgSettings = settingsStorage.get('lemongrid') || {};
  const wsUrl = lgSettings.serverUrl.replace(/^http/i, 'ws') + `/ws/v1/realtime?token=${lgSettings.accessToken}`;
  const ws = new WebSocket(wsUrl);
  // Relay messages to webview via webviewEl.postMessage({ type: 'lemongrid.ws.message', taskId, data })
  // Return connection id for cleanup
},
```
This is the only handler with no close existing analog. The planner should reference the Draw.tsx WebSocket pattern (lines 2654-2677 for setup, 2794-2896 for message handling) and the Bridge `processBridgeMessage` reply pattern (line 1140-1145) for the relay mechanism.

---

### `code/webapp/src/stores/presetStore.ts` (MOD -- store, CRUD)

**Self-extension.** Add `template_id` support as an alternative key.

**Current preset loading pattern** (lines 35-43):
```typescript
loadPresets: async (workflowName: string): Promise<void> => {
  set({ isLoading: true, error: null });
  try {
    const presets = await presetService.listPresets(workflowName);
    set({ presets, isLoading: false });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load presets';
    set({ error: errorMessage, isLoading: false });
  }
},
```

**Extension pattern:** In Cluster Mode, call `loadPresets(templateId)` where `templateId` replaces `workflowName` as the key. The preset service and Bridge handlers (`preset.list`, `preset.read`, `preset.save`) already use the filename prefix pattern (`workflowName + '-' + presetName.json`), so passing `templateId` as the `workflowName` parameter works transparently. No structural change to presetStore needed -- the change is at the call site in Draw.tsx (select template_id vs workflow name when loading presets).

---

## Shared Patterns

### Bridge Communication Protocol
**Source:** `code/webapp/src/services/upload.ts` lines 4-116 + `PS-plugin/ningleai/main.js` lines 1117-1167
**Apply to:** All new service files and Bridge handlers

```typescript
// Webview side: send message, await response
const result = await sendBridgeMessage('lemongrid.fetch', {
  url, method, headers, body, timeout
}) as { ok: boolean; status: number; data: unknown };

// Main.js side: handlers object dispatch
const handler = handlers[actionName];
const responseData = await handler(payload);
replyTarget.postMessage({ uuid, state: 'fulfilled', data: responseData });
```

### Error Classification
**Source:** `code/webapp/src/services/comfyui.ts` lines 140-166
**Apply to:** `lemongrid.ts` and `lemongrid-auth.ts`

```typescript
const classifyFetchError = (error: unknown, endpoint?: string): ComfyUIError => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return createComfyUIError('timeout', 'Request timed out.', { endpoint });
    }
    if (error instanceof TypeError) {
      return createComfyUIError('cors', 'Request blocked by CORS or network error.', { endpoint });
    }
    return createComfyUIError('network', error.message, { endpoint });
  }
  return createComfyUIError('unknown', 'Unknown error.', { endpoint });
};
```
LemonGrid errors should extend this with LemonGrid-specific codes: 401 (auth expired), 429 (rate limit), task-specific errors (OOM, DEPENDENCY_MISSING).

### Binary Data Handling (base64 through Bridge)
**Source:** `PS-plugin/ningleai/main.js` lines 49-61 + `code/webapp/src/services/upload.ts` lines 34-38, 180-206
**Apply to:** `lemongrid.fetch` handler, `lemongrid.uploadAsset` handler, asset download

```javascript
// Main.js: async chunked base64 conversion
const arrayBufferToBase64 = async (buffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    if (i + chunkSize < bytes.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return btoa(binary);
};

// Response wrapping for binary data:
responseData = {
  __base64__: true,
  data: b64,
  contentType,
  dataUrl: `data:${contentType};base64,${b64}`,
  byteLength: arrayBuffer.byteLength
};
```

### Settings Storage in main.js
**Source:** `PS-plugin/ningleai/main.js` lines 65-73
**Apply to:** `lemongrid.fetch` handler (token injection)

```javascript
const settingsStorage = {
  data: {},
  get(key) { return this.data[key]; },
  set(key, value) { this.data[key] = value; }
};
```
LemonGrid auth tokens stored via `settingsStorage.set('lemongrid', { accessToken, refreshToken, serverUrl, ... })` from the webview-side `settings.set` Bridge call during login.

### Zustand Store with Persist
**Source:** `code/webapp/src/stores/settingsStore.ts` lines 52-93
**Apply to:** `lemongridStore.ts`

Pattern: `create<Interface>()(persist((set, get) => ({...}), { name: '...', partialize: ... }))`

### PS Layer Import (unchanged)
**Source:** `code/webapp/src/services/upload.ts` lines 268-287 + `PS-plugin/ningleai/main.js` lines 576-600
**Apply to:** Both Direct and Cluster mode results

```typescript
// Webview: convert blob to base64, call Bridge
const base64Data = await fileToBase64(file);
await importBase64ToPsLayer({
  base64Data,
  mode: psImportMode,
  workflowName: selectedWorkflow?.name || 'comfyui-output',
  layerName: normalizedName,
  mimeType: 'image/png'
});
```
This pattern is reused unchanged for Cluster Mode -- the only difference is the blob source (LemonGrid asset download vs ComfyUI /view endpoint).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `lemongrid.websocket` Bridge handler | controller | streaming (WebSocket relay) | No existing WebSocket relay handler in main.js -- ComfyUI WebSocket is established directly from webview (localhost only). Planner should combine: (1) main.js fetch handler pattern for error handling, (2) Draw.tsx WebSocket lifecycle (lines 2654-2677) for WS setup/close, (3) `processBridgeMessage` reply pattern for relay |

## Metadata

**Analog search scope:** `code/webapp/src/services/`, `code/webapp/src/stores/`, `code/webapp/src/pages/`, `PS-plugin/ningleai/`
**Files scanned:** 12
**Pattern extraction date:** 2026-04-27
