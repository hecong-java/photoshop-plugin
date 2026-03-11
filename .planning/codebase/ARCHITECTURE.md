# Architecture

**Analysis Date:** 2026-03-11

## Pattern Overview

**Overall:** Hybrid Plugin Architecture with Bridge Communication Pattern

**Key Characteristics:**
- React SPA (webapp) embedded in Photoshop UXP WebView
- Bridge-based IPC between WebView UI and Photoshop native code
- Zustand for state management with localStorage persistence
- ComfyUI REST API integration with automatic endpoint probing

## Layers

**WebView UI Layer:**
- Purpose: User interface rendered in Photoshop's embedded WebView
- Location: `code/webapp/src/`
- Contains: React components, pages, hooks, services, stores
- Depends on: Bridge services, ComfyUI API
- Used by: End users via Photoshop plugin panel

**Bridge Layer (UXP main.js):**
- Purpose: Native Photoshop operations and network proxy
- Location: `PS-plugin/ningleai/main.js`
- Contains: Action handlers, Photoshop DOM manipulation, file system operations
- Depends on: Photoshop UXP APIs (core, action, app, storage, shell)
- Used by: WebView UI via postMessage bridge

**ComfyUI Integration Layer:**
- Purpose: Communication with ComfyUI server for AI image generation
- Location: `code/webapp/src/services/comfyui.ts`
- Contains: API client, endpoint probing, workflow management
- Depends on: Fetch API or Bridge proxy (in UXP environment)
- Used by: WebView UI components and stores

## Data Flow

**Image Generation Flow:**

1. User selects workflow and inputs in Draw page
2. Image uploaded to ComfyUI (via Bridge if in UXP environment)
3. WebSocket connection receives progress updates
4. Generated images displayed and can be imported to Photoshop
5. Bridge imports image as new layer (pixel or smart object)

**State Management Flow:**

1. Zustand stores manage application state
2. Settings persisted to localStorage via zustand/middleware
3. Stores expose actions that services consume
4. Components subscribe to store slices via selectors

**Bridge Communication Flow:**

1. WebView sends `{uuid, action, payload}` via postMessage
2. main.js handler processes action with Photoshop/UXP APIs
3. Response sent back as `{uuid, state, data}` or `{uuid, state, msg, code}`
4. Pending promise resolved/rejected in WebView

## Key Abstractions

**ComfyUIClient:**
- Purpose: Encapsulates all ComfyUI server communication
- Examples: `code/webapp/src/services/comfyui.ts`
- Pattern: Class-based client with configurable fetcher (native or bridge-proxied)
- Capabilities: Endpoint probing, workflow listing, history, image viewing

**Bridge Transport:**
- Purpose: Abstract UXP-native operations from WebView code
- Examples: `code/webapp/src/services/upload.ts`, `PS-plugin/ningleai/main.js`
- Pattern: Request/response with UUID correlation, timeout handling
- Actions: `ps.exportActiveLayerPng`, `ps.importBase64AsLayer`, `comfyui.fetch`, `fs.saveDownload`

**Zustand Stores:**
- Purpose: Centralized state management with persistence
- Examples: `code/webapp/src/stores/settingsStore.ts`, `code/webapp/src/stores/historyStore.ts`
- Pattern: Create function with state and actions, optional persist middleware
- Stores: `settingsStore` (user preferences, ComfyUI connection), `historyStore` (generation history), `comfyui` store (workflow state)

## Entry Points

**Webapp Entry:**
- Location: `code/webapp/src/main.tsx`
- Triggers: Vite dev server or built static files
- Responsibilities: React root creation, mounts App component

**Plugin Entry:**
- Location: `PS-plugin/ningleai/index.html`
- Triggers: Photoshop loads plugin panel
- Responsibilities: Creates WebView, loads main.js bridge, sets up message listener

**App Router:**
- Location: `code/webapp/src/App.tsx`
- Triggers: Application mount
- Responsibilities: Route definitions, navigation, page layout

## Error Handling

**Strategy:** Layered error handling with typed errors

**Patterns:**
- `ComfyUIError` type with classified error types (cors, timeout, network, http, invalid_url)
- Bridge errors return `{code, message}` objects
- Stores convert errors to display-friendly messages
- UI shows error states with user guidance (e.g., CORS configuration help)

## Cross-Cutting Concerns

**Logging:** Console-based with `[Bridge]`, `[ComfyUI]`, `[Upload]` prefixes

**Validation:**
- Input validation in services (file types, sizes)
- Payload validation in bridge handlers
- URL normalization for ComfyUI endpoints

**Authentication:** None - relies on network-level access to ComfyUI server

**CORS Handling:**
- Browser environment: Requires ComfyUI CORS headers
- UXP environment: Bridge proxy bypasses CORS restrictions
- Automatic fallback to bridge when CORS errors detected

---

*Architecture analysis: 2026-03-11*
