# Architecture

**Analysis Date:** 2026-03-17

## Pattern Overview

**Overall:** Hybrid Plugin-WebApp Architecture with Bridge Communication

The system consists of a Photoshop UXP Plugin that embeds a remote React web application via webview. The plugin provides a JavaScript bridge (main.js) that exposes Photoshop APIs and network proxy capabilities to the webapp. This allows the webapp to interact with Photoshop documents while running in a sandboxed webview environment.

**Key Characteristics:**
- **UXP Plugin Layer**: Native Photoshop extension using UXP (Unified Extensibility Platform) with webview-based UI
- **Bridge Communication**: PostMessage-based RPC between plugin and webapp for PS operations and network proxy
- **State Management**: Zustand stores with localStorage persistence for client-side state
- **ComfyUI Integration**: REST API client for AI image generation workflows

## Layers

### Plugin Layer (UXP)
- Purpose: Photoshop integration, file system access, network proxy
- Location: `PS-plugin/ningleai/main.js`
- Contains: UXP bridge handlers, Photoshop DOM operations, ComfyUI network proxy
- Depends on: Photoshop UXP APIs (photoshop module, uxp.storage, uxp.shell)
- Used by: WebApp via postMessage bridge

### WebApp Layer (React SPA)
- Purpose: User interface, workflow management, ComfyUI interaction
- Location: `code/webapp/src/`
- Contains: React components, Zustand stores, service modules
- Depends on: Plugin bridge (when in UXP), ComfyUI REST API
- Used by: Embedded in Photoshop plugin webview

### ComfyUI Layer (External)
- Purpose: AI image generation backend
- Location: External server (configurable URL)
- Contains: Workflow execution, image processing, model management
- Depends on: None (external service)
- Used by: WebApp via REST/WebSocket

### Workflow Assets
- Purpose: Predefined AI generation workflows
- Location: `code/workflows/`
- Contains: JSON workflow definitions organized by category
- Depends on: ComfyUI node types
- Used by: WebApp (loaded via ComfyUI API)

## Data Flow

### Image Generation Flow

1. User selects workflow in Draw page
2. WebApp loads workflow JSON from ComfyUI
3. User configures workflow inputs (text, images, parameters)
4. User clicks "Generate" button
5. WebApp exports current PS layer/selection via Bridge
6. Bridge handler exports image as base64 PNG
7. WebApp uploads image to ComfyUI via Bridge proxy
8. WebApp sends prompt request to ComfyUI via Bridge proxy
9. WebSocket monitors generation progress
10. On completion, WebApp fetches output images
11. User imports result back to PS via Bridge
12. Bridge handler creates new layer with generated image

### Bridge Communication Flow

```
WebApp (iframe)                Plugin (main.js)
     |                              |
     | postMessage({uuid,action})   |
     |----------------------------->|
     |                              | Execute handler
     |                              | Access PS APIs
     |                              | Network requests
     | postMessage({uuid,response}) |
     |<-----------------------------|
     |                              |
```

**State Management:**
- Zustand stores with localStorage persistence
- Separate stores for: settings, config, history, workflow cache, ComfyUI state
- React hooks for bridge communication (usePSBridge)

## Key Abstractions

### ComfyUIClient
- Purpose: REST API client for ComfyUI server communication
- Examples: `code/webapp/src/services/comfyui.ts`
- Pattern: Class-based client with endpoint probing, automatic CORS/Bridge fallback

```typescript
// Client auto-detects Bridge transport in UXP environment
const client = new ComfyUIClient({ baseUrl: 'http://192.168.0.50:8188' });
await client.probeEndpoints(); // Discovers API prefix mode
await client.listWorkflows();  // Lists ps-workflows directory
await client.getHistory();     // Fetches generation history
```

### Bridge Message Protocol
- Purpose: RPC-style communication between webapp and plugin
- Examples: `code/webapp/src/services/upload.ts`, `PS-plugin/ningleai/main.js`
- Pattern: Request-response with UUID correlation

```typescript
// Request format (webapp -> plugin)
{ uuid: string, action: string, payload?: unknown }

// Response format (plugin -> webapp)
{ uuid: string, state: 'fulfilled' | 'rejected', data?: unknown, msg?: string, code?: string }
```

### Workflow Input System
- Purpose: Dynamic form generation from ComfyUI workflow JSON
- Examples: `code/webapp/src/pages/Draw.tsx`
- Pattern: Workflow nodes are parsed, filtered, and rendered as form inputs

```typescript
// Workflow input types
interface WorkflowInput {
  name: string;
  type: 'text' | 'number' | 'image' | 'select' | 'boolean';
  label: string;
  classType?: string;
  nodeId?: string;
  default?: string | number | boolean;
  options?: string[];
}
```

### Zustand Store Pattern
- Purpose: Centralized state with persistence
- Examples: `code/webapp/src/stores/*.ts`
- Pattern: Create store with persist middleware, partial state serialization

```typescript
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // State and actions
    }),
    { name: 'Ningleai-settings', partialize: (state) => ({ ... }) }
  )
);
```

## Entry Points

### Plugin Entry
- Location: `PS-plugin/ningleai/index.html`
- Triggers: Photoshop loads plugin panel
- Responsibilities: Load webview, include main.js bridge script

### WebApp Entry
- Location: `code/webapp/src/main.tsx`
- Triggers: Browser/webview loads compiled React app
- Responsibilities: Mount React root, render App with router

### App Router
- Location: `code/webapp/src/App.tsx`
- Triggers: URL navigation
- Responsibilities: Route to Draw/History/Settings pages

## Error Handling

**Strategy:** Typed error objects with bridge propagation

**Patterns:**
- ComfyUI errors typed as `ComfyUIError` with type discrimination (`cors`, `timeout`, `network`, `http`, `invalid_url`)
- Bridge errors propagated with `{ code, message }` structure
- React component error states with user-friendly messages
- CORS guidance automatically appended to error messages

```typescript
// Error type discrimination
export type ComfyUIErrorType = 'cors' | 'timeout' | 'network' | 'invalid_url' | 'http' | 'unknown';

export interface ComfyUIError {
  type: ComfyUIErrorType;
  message: string;
  status?: number;
  endpoint?: string;
}
```

## Cross-Cutting Concerns

**Logging:** Console logging with prefixes (`[Bridge]`, `[Config]`, `[ComfyUI]`) for traceability

**Validation:**
- Config validation with `validateConfig()` sanitizes plugin config
- Workflow input validation in Draw page
- File type/size validation for uploads

**Authentication:** None (ComfyUI assumed to be on trusted network)

**CORS Handling:**
- In browser: Requires ComfyUI to enable CORS headers
- In UXP: Bridge proxy bypasses CORS by making requests from plugin context

**Caching:**
- Workflow input values cached per-workflow in localStorage
- Image data cached with 500KB limit per image
- LRU eviction for cached workflows (max 20)

---

*Architecture analysis: 2026-03-17*
