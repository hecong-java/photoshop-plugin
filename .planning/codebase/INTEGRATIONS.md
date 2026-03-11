# External Integrations

**Analysis Date:** 2026-03-11

## APIs & External Services

**ComfyUI API:**
- ComfyUI Server - AI image generation workflow execution
  - SDK/Client: Custom `ComfyUIClient` class in `src/services/comfyui.ts`
  - Connection: Configurable base URL (default: `http://192.168.0.50:8188`)
  - Endpoints:
    - `/object_info` or `/api/object_info` - Node information
    - `/prompt` or `/api/prompt` - Workflow submission
    - `/history` or `/api/history` - Execution history
    - `/upload/image` or `/api/upload/image` - Image upload
    - `/view` - Image retrieval
    - `/ws` - WebSocket for real-time updates
    - `/userdata` - Workflow file management (ps-workflows directory)
    - `/system_stats` - Server version info
  - Prefix modes: `oss` (direct paths) or `api` (prefixed paths)

**Model Context Protocol (MCP):**
- SSH MCP Server - Remote server command execution via MCP protocol
  - SDK: `@modelcontextprotocol/sdk` 1.27.0
  - Transport: StdioServerTransport
  - Config: `mcp.json` and `ssh-config.json` define server connections
  - Location: `mcp-servers/ssh-mcp-server/`

## Data Storage

**Databases:**
- None - No traditional database

**File Storage:**
- Local filesystem via UXP storage API
  - Downloads folder: Created in UXP data folder
  - Temporary folder: Used for layer exports
  - Entry point: `localFileSystem` from `uxp.storage`

**Caching:**
- Browser localStorage via Zustand persist middleware
  - Settings key: `Ningleai-settings`
  - Stores: theme, autoSave, psImportMode, comfyUI settings

## Authentication & Identity

**Auth Provider:**
- None - No user authentication system
  - ComfyUI connection is network-based (no auth tokens in current implementation)
  - SSH MCP server uses password authentication (stored in `ssh-config.json`)

**Security Note:**
- SSH credentials stored in plaintext in `ssh-config.json`
- ComfyUI URL configured without authentication

## Photoshop UXP Integration

**UXP Host Bridge:**
- Communication: `window.uxpHost.postMessage()` or `window.parent.postMessage()`
- Location: `PS-plugin/ningleai/main.js`
- Manifest: `PS-plugin/ningleai/manifest.json`

**Bridge Actions (main.js handlers):**
- `ps.importImageAsLayer` - Import image file as new layer
- `ps.importBase64AsLayer` - Import base64 data as new layer
- `ps.exportActiveLayerPng` - Export active layer as PNG (base64)
- `ps.exportSelectionPng` - Export selection as PNG (base64)
- `comfyui.fetch` - Proxy network requests through UXP (bypasses WebView CORS)
- `comfyui.uploadImage` - Upload images to ComfyUI via multipart/form-data
- `settings.get/set` - Plugin settings storage
- `fs.saveDownload/listDownloads/deleteDownload/openDirectory` - File system operations

**Photoshop API Usage:**
- `photoshop.core` - Modal execution
- `photoshop.action` - BatchPlay for PS commands
- `photoshop.app` - Document and layer access
- `uxp.storage` - File system operations
- `uxp.shell` - Open external paths

## Monitoring & Observability

**Error Tracking:**
- None - No external error tracking service

**Logs:**
- Console logging with prefixes: `[Bridge]`, `[ComfyUI]`, `[Upload]`, `[Plugin]`
- MCP server uses custom `Logger` utility

## CI/CD & Deployment

**Hosting:**
- Development: Vite dev server (port 5173)
- Production: Static build output (dist folder)
- Plugin: Packaged as `.ccx` file (UXP plugin format)

**CI Pipeline:**
- None detected - No CI configuration files present

**Build Artifacts:**
- `PS-plugin.zip` - Packaged plugin
- `ningleai_PS.ccx` - Compiled UXP plugin
- `dist/` - Vite build output
- `build/` - MCP server TypeScript output

## Environment Configuration

**Required env vars:**
- None - Configuration stored in JSON files and localStorage

**Configuration Files:**
- `mcp.json` - MCP server definitions
- `ssh-config.json` - SSH connection credentials
- Settings persisted to browser localStorage via Zustand

**Secrets location:**
- SSH passwords in `ssh-config.json` (plaintext)
- No secure secrets management

## Webhooks & Callbacks

**Incoming:**
- None - No webhook endpoints

**Outgoing:**
- WebSocket connections to ComfyUI for real-time workflow updates
  - URL: `{baseUrl}/ws?clientId={clientId}`
  - Used for progress tracking and completion notifications

## Cross-Origin Considerations

**CORS Handling:**
- UXP WebView cannot make direct network requests due to security restrictions
- Solution: `comfyui.fetch` bridge action proxies all requests through UXP main thread
- ComfyUI server should enable CORS: `--enable-cors-header "*"`

---

*Integration audit: 2026-03-11*
