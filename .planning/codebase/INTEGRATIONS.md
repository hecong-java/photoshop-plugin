# External Integrations

**Analysis Date:** 2026-03-17

## APIs & External Services

**ComfyUI:**
- Purpose: AI image generation backend
- Protocol: HTTP REST + WebSocket
- SDK/Client: Custom `ComfyUIClient` class in `code/webapp/src/services/comfyui.ts`
- Auth: None (assumes local/trusted network)
- Endpoints used:
  - `/object_info` or `/api/object_info` - Node type information
  - `/prompt` or `/api/prompt` - Queue prompts for execution
  - `/history` or `/api/history` - Execution history
  - `/upload/image` or `/api/upload/image` - Image upload
  - `/view` - Retrieve generated images
  - `/ws` or `/api/ws` - WebSocket for real-time updates
  - `/userdata` - Workflow file management (list/read from `ps-workflows/` directory)
  - `/system_stats` - Version information
  - `/api/experiment/models` - Custom model catalog

**Remote Webapp Server:**
- URL: `http://123.207.74.28:8080`
- Purpose: Hosts the React webapp loaded in Photoshop plugin webview
- Configured in: `PS-plugin/ningleai/index.html` and `PS-plugin/ningleai/main.js`

## Data Storage

**Databases:**
- None (client-side only)

**File Storage:**
- UXP Plugin Local Storage - Downloaded images saved via `localFileSystem.getDataFolder()`
  - Location: `downloads/` subfolder in plugin data directory
  - Access via: `fs.saveDownload`, `fs.listDownloads`, `fs.deleteDownload` bridge handlers

**Caching:**
- Browser localStorage via Zustand persist middleware
  - `Ningleai-settings` key - User preferences
  - `workflow-cache` key - Cached workflow JSON data
  - History cached locally in `historyStore`

## Authentication & Identity

**Auth Provider:**
- None (Custom/No auth)
- Implementation: ComfyUI connection uses simple HTTP with no authentication
- User-configurable base URL in Settings page

## Monitoring & Observability

**Error Tracking:**
- Console logging only (`console.log`, `console.error`)
- Structured error types in ComfyUI client (`ComfyUIError` with type classification)

**Logs:**
- Browser console
- Bridge message logging with `[Bridge]` prefix in `PS-plugin/ningleai/main.js`
- ComfyUI client logging with `[ComfyUI]` prefix

## CI/CD & Deployment

**Hosting:**
- Remote server: `http://123.207.74.28:8080` (webapp hosting)
- Local development: Vite dev server on `http://localhost:5173`

**CI Pipeline:**
- None detected

**Deployment:**
- Manual ZIP packaging (`PS-plugin-*.zip` files in root)
- Plugin distributed as folder (`PS-plugin/ningleai/`)

## Environment Configuration

**Required env vars:**
- None detected (no `.env` files)

**Runtime Configuration:**
- ComfyUI base URL: User-configured in Settings, persisted to localStorage
- Default ComfyUI URL: `http://192.168.0.50:8188` (in `code/webapp/src/stores/settingsStore.ts`)

**Plugin Configuration:**
- `PS-plugin/ningleai/node-config.json` - Node display configuration for UI
- Loaded via `fs.readPluginConfig` bridge handler

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## UXP Bridge Communication

**Architecture:**
- WebView-to-Plugin messaging via `window.postMessage` and `uxpHost.postMessage`
- Request/response pattern with UUID correlation
- 30-second timeout per request

**Bridge Actions (handled in `PS-plugin/ningleai/main.js`):**

| Action | Purpose |
|--------|---------|
| `settings.get` / `settings.set` | Plugin-level settings |
| `fs.saveDownload` | Save binary data to downloads folder |
| `fs.listDownloads` | List downloaded files |
| `fs.deleteDownload` | Delete a downloaded file |
| `fs.readPluginConfig` | Read `node-config.json` from plugin folder |
| `fs.openDirectory` | Open downloads folder in system file manager |
| `ps.importImageAsLayer` | Import image file as Photoshop layer |
| `ps.importBase64AsLayer` | Import base64 image as Photoshop layer |
| `ps.exportActiveLayerPng` | Export active layer as PNG (base64) |
| `ps.exportSelectionPng` | Export selection as PNG (base64) |
| `comfyui.fetch` | Proxy HTTP requests through plugin (CORS workaround) |
| `comfyui.uploadImage` | Upload image to ComfyUI via plugin |

**Security:**
- Origin whitelist in `PS-plugin/ningleai/main.js`: `['http://123.207.74.28:8080']`
- All bridge messages validated for UUID and action

---

*Integration audit: 2026-03-17*
