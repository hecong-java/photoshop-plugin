# Phase 6: LemonGrid Integration - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Add "Cluster Mode" to the Photoshop ComfyUI Plugin that connects to LemonGrid's GPU cluster management platform. The plugin supports two connection modes: Direct Mode (existing, single ComfyUI instance) and Cluster Mode (new, LemonGrid platform with multi-GPU scheduling). In Cluster Mode, the plugin uses LemonGrid's template system for workflow discovery, JWT authentication for access control, and LemonGrid's task API for generation lifecycle. Direct Mode remains unchanged as the default.

</domain>

<decisions>
## Implementation Decisions

### Workflow Source & Template System
- **D-01:** Use LemonGrid's workflow template system (not local files or ComfyUI /userdata) as the workflow source in Cluster Mode
- **D-02:** Full template-driven UI — parameter inputs rendered dynamically from each template's `param_schema` (no dependency on node-config.json in Cluster Mode)
- **D-03:** Task submission sends `template_id` + parameter values only (not full workflow JSON). LemonGrid resolves the workflow server-side
- **D-04:** Direct Mode and Cluster Mode have independent workflow lists — switching modes reloads from the new source
- **D-05:** The two modes are strictly separated — no mixing of ComfyUI workflows and LemonGrid templates
- **D-06:** Cache LemonGrid templates locally via Bridge file API. Manual refresh button to update from server
- **D-07:** Template organization uses metadata from LemonGrid (categories/tags from template schema) — not custom grouping
- **D-08:** Fetch full template detail (including param_schema) on demand when user selects a template, not upfront
- **D-09:** Dynamic UI rendering from param_schema types (text, number, image, select, etc.) — same pattern as Direct Mode's node-config rendering
- **D-10:** Presets work per-template in Cluster Mode, using `template_id` as the key in the same preset store
- **D-11:** Show template thumbnails in the workflow selector (from template metadata)
- **D-12:** Show template help/documentation (description, example outputs, parameter explanations) alongside parameter UI
- **D-13:** Template management is admin-only — plugin users browse and use templates, cannot create/edit them
- **D-14:** Template visibility controlled by LemonGrid server (role-based filtering) — no client-side filtering needed
- **D-15:** Block until connected at startup in Cluster Mode — no template browsing until LemonGrid is reachable
- **D-16:** Allow offline parameter editing — if user had a template selected and connection drops, they can still edit params using cached param_schema
- **D-17:** Auto-detect template version changes on refresh and notify user. Old parameter values that no longer match the updated schema are dropped
- **D-18:** Same image input UI in both modes (drag & drop + paste + file picker) — only the upload target changes (LemonGrid asset API vs ComfyUI /upload/image)
- **D-19:** Auto-detect image inputs from param_schema — no need for node-config.json in Cluster Mode
- **D-20:** Full template list with categories from metadata — no search/filter UI
- **D-21:** Show connection status indicator on Draw page (green/red dot near mode label)

### Progress Tracking & Task Lifecycle
- **D-22:** WebSocket + polling fallback for task progress. Try WebSocket first, auto-fallback to polling on failure
- **D-23:** Proxy WebSocket through Bridge (main.js) — new `lemongrid.websocket` Bridge handler. UXP webview cannot connect cross-origin WS directly
- **D-24:** Per-task WebSocket connection — each concurrent task gets its own WS connection through Bridge
- **D-25:** Show all LemonGrid task states distinctly: PENDING, QUEUED, SYNCING, RUNNING, COMPLETED, FAILED, CANCELLED
- **D-26:** Enhanced cluster progress bar — reuse existing progress bar component but show different state text (queued position, syncing, generating %, completed with duration)
- **D-27:** Show queue position number only (no ETA) during QUEUED state
- **D-28:** Adaptive polling interval: 2 seconds during queued/syncing, 1 second during running
- **D-29:** Show preview images during RUNNING state if available from LemonGrid
- **D-30:** Show generation duration when task completes (from LemonGrid task_completed event)
- **D-31:** No stall detection — keep polling until completion, failure, or user cancel
- **D-32:** No client-side timeout — rely on LemonGrid server's own timeout mechanisms
- **D-33:** Cancel via LemonGrid DELETE /api/v1/tasks/{task_id} — cancel button in task list
- **D-34:** Download all output images from completed tasks (not just first)
- **D-35:** All output images from a task auto-import to PS as separate layers
- **D-36:** Completed Cluster Mode tasks appear in same History panel with a source filter (Direct / Cluster / All)
- **D-37:** Mirror Direct Mode WebSocket pattern on webview side — same connect/onmessage/close flow, just different endpoint and message format
- **D-38:** Auto-fallback to polling when WebSocket drops — no user prompt, seamless degradation
- **D-39:** Support concurrent tasks — user can submit multiple tasks simultaneously
- **D-40:** Mini task list below Generate button — shows all running/completed/failed tasks
- **D-41:** Snapshot parameter values at submit time — subsequent parameter changes don't affect running tasks
- **D-42:** Auto re-authenticate + retry on 401 during task polling (try refresh token, then re-login with stored credentials)
- **D-43:** Retry button on task failure — re-submits same parameters without re-entry
- **D-44:** Same PS layer import flow (Bridge ps.importBase64AsLayer) for Cluster Mode results
- **D-45:** Show LemonGrid error codes + user-friendly suggestions (OOM → "Reduce image size", DEPENDENCY_MISSING → "Re-upload image", etc.)
- **D-46:** Show brief toast notification on mode switch ("Connected to LemonGrid" / "Switched to Direct Mode")
- **D-47:** Auto-display results when task completes — no manual click needed
- **D-48:** Block mode switching while tasks are running
- **D-49:** Auto-detect UXP vs browser environment — direct fetch/WebSocket in browser, Bridge proxy in UXP
- **D-50:** handleGenerate uses same function with connectionMode branch (not separate handleClusterGenerate)
- **D-51:** Cluster Mode uses independent output state (clusterOutputImages) separate from Direct Mode's outputImages
- **D-52:** Poll for task completion using GET /api/v1/tasks/{task_id} as the completion detection mechanism
- **D-53:** Get queue position from task status response (not separate queue API call)
- **D-54:** Hide cluster internals (GPU nodes, utilization) from plugin users

### Queue & Task List UX
- **D-55:** Mini task list appears below Generate button (replacing single progress bar in Cluster Mode)
- **D-56:** Expandable task items — collapsed shows progress bar + state badge, expanded shows details + actions + thumbnail
- **D-57:** Colored state badges: PENDING (gray), QUEUED (yellow), SYNCING (blue), RUNNING (green), COMPLETED (check), FAILED (red), CANCELLED (gray)
- **D-58:** Compact single-row items when collapsed (template name + progress + state badge)
- **D-59:** Newest tasks at top of the list
- **D-60:** Show running count summary when many tasks (e.g., "2 running, 1 completed")
- **D-61:** Click to expand failed task — shows error code + suggestion + retry/dismiss buttons
- **D-62:** Completed tasks stay in mini task list until dismissed or mode switch. Show result thumbnail when expanded
- **D-63:** Re-import result to PS layer from task list (click completed task to import again)
- **D-64:** Retry + dismiss buttons for failed tasks. Dismissed tasks disappear from list
- **D-65:** Cancel button directly in task list item (no need to expand)
- **D-66:** No task ID shown in UI (internal reference only)
- **D-67:** Show result thumbnail in expanded completed task items
- **D-68:** Show template name per task in the list
- **D-69:** Show "per-user concurrent task limit reached" message when LemonGrid returns limit error

### Credential Storage & Authentication
- **D-70:** Store JWT token + username in lemongridStore (Zustand persist). Password never stored in plain text
- **D-71:** Login modal dialog on demand — appears on mode switch (when not authenticated) and on re-auth failure
- **D-72:** Auto re-login using stored username + refresh token when session expires. Only prompt for password if all auto-auth methods fail
- **D-73:** Try silent auto-login first on mode switch (if stored token is valid). Only show login modal if auto-login fails
- **D-74:** Show connection status in Settings page (connected/disconnected, username). Also show status indicator on Draw page
- **D-75:** Auto-open login modal when switching to Cluster Mode if not authenticated
- **D-76:** Add Logout button in Settings — clears token, encrypted password, user info. Cancels running tasks first. Keeps server URL + username for faster re-login
- **D-77:** "Remember me" checkbox on login modal — when checked, stores encrypted password for auto-login across plugin restarts
- **D-78:** AES encryption for stored password via Web Crypto API with device-derived key
- **D-79:** Use LemonGrid refresh tokens (7-day expiry) for seamless session extension before access token (30 min) expires
- **D-80:** Validate stored token on plugin startup — check validity, try refresh, prompt login if both fail
- **D-81:** Settings page shows account info (username) + connection status + Logout button
- **D-82:** Single LemonGrid server profile (URL configured in Settings) — not multiple profiles
- **D-83:** Client-side input validation in login modal (URL format, non-empty fields) before submitting
- **D-84:** Specific error messages in login modal: "Invalid credentials" (401), "Server unreachable" (network), "Invalid URL" (bad format)
- **D-85:** Show loading state (spinner + disabled Login button) during authentication request
- **D-86:** Hide token expiry from user — handle silently via auto re-auth
- **D-87:** Cancel all running Cluster tasks on logout, warn user first
- **D-88:** No "Forgot password?" link — internal tool, users contact admin
- **D-89:** On network loss mid-session: toast "Connection lost" + auto-reconnect attempt + login modal fallback if reconnect fails
- **D-90:** Show auth errors on Draw page (e.g., "Authentication failed — click to re-login")
- **D-91:** Fetch user profile info (role, quota) from /api/v1/auth/me after login for feature gating
- **D-92:** New lemongridStore (Zustand persist) for all LemonGrid state: auth, tokens, user info, tasks, encrypted password

### Settings & Mode Toggle UI
- **D-93:** Mode toggle in Settings page (radio buttons: "Direct (ComfyUI)" / "Cluster (LemonGrid)")
- **D-94:** Show only relevant mode settings — hide ComfyUI section in Cluster Mode, hide LemonGrid section in Direct Mode
- **D-95:** Small mode label on Draw page header (shows "Direct" or "Cluster" indicator)
- **D-96:** LemonGrid Settings section: server URL input, login status, Logout button, account info

### Service & Bridge Architecture
- **D-97:** TaskService interface pattern — shared interface with ComfyUITaskService (existing) and LemonGridTaskService (new) implementations. Draw.tsx selects service by connectionMode
- **D-98:** New Bridge handler: `lemongrid.fetch` — same pattern as `comfyui.fetch` but injects JWT Authorization header from lemongridStore. Handles JSON and binary (base64) responses
- **D-99:** New Bridge handler: `lemongrid.websocket` — creates WebSocket in main.js, relays messages to webview via Bridge postMessage
- **D-100:** New Bridge handler: `lemongrid.uploadAsset` — multipart upload to LemonGrid /api/v1/assets/library/upload with JWT auth
- **D-101:** LemonGridClient mirrors ComfyUIClient interface — independent class, no changes to existing ComfyUIClient
- **D-102:** Task tracking state (running tasks, progress, results) lives in lemongridStore alongside auth state
- **D-103:** Extract shared utilities (base64 conversion, blob handling, progress calculation) into common module for both modes

### Preset Integration
- **D-104:** Same preset store for both modes — `template_id` used as key in Cluster Mode (vs workflow name in Direct Mode)
- **D-105:** Preset import/export works identically in Cluster Mode — exported files include template_id reference

### Claude's Discretion
- Exact param_schema field type mapping to UI components (text→input, number→slider, image→upload, select→dropdown, etc.)
- AES encryption key derivation strategy for "Remember me" feature
- Login modal visual layout and styling
- Mini task list animation and transition details
- Error code → user-friendly message mapping table
- Retry/re-login attempt count and backoff strategy
- Template cache file format and location

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research & Analysis
- `.planning/phases/06-lemongrid-integration/06-RESEARCH.md` — Comprehensive research with exact API endpoints, verified code locations, integration patterns, pitfalls, and code examples. PRIMARY reference for all implementation.

### Core Source Files (Plugin)
- `code/webapp/src/pages/Draw.tsx` — Main generation page: handleGenerate (lines 2619-2952), WebSocket lifecycle, progress tracking, image download, PS import. Branch point for connectionMode.
- `code/webapp/src/services/upload.ts` — bridgeFetch pattern, Bridge communication, image upload flow. Reused for LemonGrid API calls.
- `code/webapp/src/services/comfyui.ts` — ComfyUIClient class. Interface reference for LemonGridClient.
- `code/webapp/src/stores/settingsStore.ts` — Zustand persist pattern, ComfyUI settings structure. Template for connectionMode extension.
- `code/webapp/src/stores/presetStore.ts` — Preset store. Extension point for template_id-based presets in Cluster Mode.
- `PS-plugin/ningleai/main.js` — Bridge handlers: comfyui.fetch (lines 791-875), comfyui.uploadImage (lines 878-950), ps.importBase64AsLayer (lines 576-630). Pattern for new LemonGrid handlers.
- `code/webapp/src/pages/Settings.tsx` — Settings page layout, connection config UI, test connection button. Extension point for mode toggle and LemonGrid settings.

### Core Source Files (LemonGrid — external reference)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\auth.py` — JWT auth endpoints (login, refresh, /auth/me)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\tasks.py` — Task submit, status, cancel, ETA endpoints
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\assets.py` — Asset upload/download endpoints
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\websocket.py` — WebSocket real-time progress messages
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\core\config.py` — Token expiry config (30 min access, 7 day refresh)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-agent\agent.py` — Agent task execution (asset sync → ComfyUI execution flow)

### Architecture Context
- `.planning/codebase/ARCHITECTURE.md` — Bridge communication pattern, UXP webview architecture
- `.planning/phases/05.1-plugin-performance-fix/05.1-CONTEXT.md` — Bridge proxy patterns, base64 async conversion
- `.planning/phases/05-image-prompt-reverse/05-CONTEXT.md` — bridgeFetch usage pattern, Settings page extension

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bridgeFetch` (upload.ts) — UXP/browser adaptive fetch wrapper. LemonGrid API calls reuse this with new Bridge handlers.
- `sendBridgeMessage` (upload.ts) — UUID-based request/response Bridge protocol. New LemonGrid handlers follow same pattern.
- `ComfyUIClient` (comfyui.ts) — API client pattern (connect, readWorkflow, etc.). LemonGridClient mirrors this interface.
- `settingsStore` (settingsStore.ts) — Zustand persist pattern. `connectionMode` toggle added here.
- `presetStore` (presetStore.ts) — Preset save/load/import/export. Extended with `template_id` key support.
- Bridge proxy pattern (main.js `comfyui.fetch`) — New `lemongrid.fetch` handler follows same structure with JWT header injection.
- `pollForHistoryCompletion` (Draw.tsx lines 2488-2536) — Polling pattern adapted for LemonGrid task status polling.
- `fetchOutputImage` (Draw.tsx lines 2401-2414) — Image download pattern adapted for LemonGrid asset download.
- `importBase64ToPsLayer` (upload.ts) — PS layer import reused unchanged for Cluster Mode results.
- `isUXPWebView()` — Environment detection for Bridge vs direct API calls.

### Established Patterns
- Bridge message protocol: UUID-based request/response with timeout
- Binary data: all images encoded as base64 strings in Bridge JSON
- Settings UI: connection config + test button + status indicator
- Progress tracking: WebSocket primary, polling fallback, same progress bar component
- Zustand persist for settings, separate stores for feature state
- Error classification: timeout, network, CORS, HTTP errors mapped to error codes
- Parameter rendering: dynamic from config/schema, input components generated per type

### Integration Points
- Draw.tsx `handleGenerate` — Branch on `connectionMode` for Direct vs Cluster generation flow
- Settings.tsx — Add mode toggle radio + LemonGrid settings section (server URL, login, status)
- settingsStore — Add `connectionMode: 'direct' | 'cluster'` field
- main.js — Add 3 new Bridge handlers: `lemongrid.fetch`, `lemongrid.websocket`, `lemongrid.uploadAsset`
- presetStore — Support `template_id` as preset key alongside workflow name
- History panel — Add source filter (All / Direct / Cluster)

</code_context>

<specifics>
## Specific Ideas

- The RESEARCH.md has exact API request/response formats, verified against LemonGrid source code — planner should reference it for every API call
- LemonGrid task states map to UI states: PENDING/QUEUED → "Queued #N", SYNCING → "Syncing assets...", RUNNING → "Generating N%" with preview, COMPLETED → "Completed in Nm Ns" with auto-import, FAILED → error code + suggestion
- Mini task list replaces single progress bar in Cluster Mode. In Direct Mode, progress bar stays as-is.
- Login modal appears on mode switch (if not authed), on re-auth failure, or on Draw page auth error click
- "Remember me" on login modal controls whether encrypted password is stored for cross-session auto-login
- Template cache uses Bridge file API (same pattern as workflowCacheStore)
- lemongridStore is a single new Zustand store handling auth, tasks, and encrypted credentials

</specifics>

<deferred>
## Deferred Ideas

- LemonGrid template creation/editing from plugin — admin-only for now, plugin users cannot create templates
- Template search/filter UI — full list with categories is sufficient for initial release
- Multiple LemonGrid server profiles — single server config for simplicity
- GPU cluster status display (nodes online, utilization) — admin-level info, not needed by plugin users
- Virtual scrolling for large template lists — premature optimization
- Template favoriting/bookmarking — can be added later if template count grows
- "Forgot password?" link in login modal — internal tool, users contact admin
- Direct Mode WebSocket refactoring to use Bridge proxy — only needed if CORS issues arise; Direct Mode WS works because ComfyUI is localhost

</deferred>

---

*Phase: 06-lemongrid-integration*
*Context gathered: 2026-04-27*
