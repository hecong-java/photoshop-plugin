# Phase 6: LemonGrid Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-27
**Phase:** 06-lemongrid-integration
**Areas discussed:** Workflow Source & Templates, Progress Tracking & Task Lifecycle, Credential Storage & Authentication, Queue & State UX, Settings & Mode Toggle UI, Service & Bridge Architecture, Preset Integration, Code Architecture & Sharing

---

## Workflow Source & Templates

| Option | Description | Selected |
|--------|-------------|----------|
| Bundle with plugin | Workflow JSONs bundled with plugin, read via Bridge fs API | |
| Fetch from ComfyUI still | Continue fetching from ComfyUI /userdata | |
| LemonGrid templates | Use LemonGrid's template system with template_id + param_schema | ✓ |

**User's choice:** LemonGrid templates

| Option | Description | Selected |
|--------|-------------|----------|
| Full template-driven | Parameter UI rendered from param_schema types | ✓ |
| Templates + local config | Templates for workflow JSON, node-config.json for UI | |
| Templates as workflow source only | Full ComfyUI parameters without param_schema | |

**User's choice:** Full template-driven

| Option | Description | Selected |
|--------|-------------|----------|
| Template workflow_json | Submit full workflow JSON from template | |
| Template ID + params only | Submit template_id and parameters, server resolves workflow | ✓ |
| Both (hybrid) | Support both approaches | |

**User's choice:** Template ID + params only

| Option | Description | Selected |
|--------|-------------|----------|
| Independent lists | Each mode has own workflow list, reload on switch | ✓ |
| Shared with matching | Cache both, try to match by name | |

**User's choice:** Independent lists (strictly mode-separated)

| Option | Description | Selected |
|--------|-------------|----------|
| Cache + refresh | Cache templates locally, manual refresh button | ✓ |
| Always fetch fresh | No cache, always fetch from server | |
| Session-only cache | In-memory cache only | |

**User's choice:** Cache + refresh

| Option | Description | Selected |
|--------|-------------|----------|
| Use template metadata | Categories from LemonGrid template schema | ✓ |
| Show all templates | Flat list | |
| Categorized by type | Plugin-side grouping | |

**User's choice:** Use template metadata for organization

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch detail on select | Load param_schema when user picks template | ✓ |
| Fetch all upfront | Load all template details at startup | |

**User's choice:** Fetch detail on select

| Option | Description | Selected |
|--------|-------------|----------|
| Render from schema types | Dynamic UI components based on param_schema types | ✓ |
| Pre-built UI per template | Hard-coded layouts for known templates | |

**User's choice:** Render from schema types

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, presets per template | Same preset store, template_id as key | ✓ |
| No presets in cluster mode | Presets only in Direct Mode | |

**User's choice:** Yes, presets per template

**Notes:** Additional decisions: Show thumbnails, show template help, admin-only management, server-side role-based filtering, block until connected at startup, allow offline parameter editing, auto-detect version changes, same image input UI with different upload target, auto-detect image inputs from param_schema, full list with categories (no search), show connection status on Draw page.

---

## Progress Tracking & Task Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Polling only | Poll GET /tasks/{id} every 2 seconds | |
| WebSocket + polling fallback | Try WS first, auto-fallback to polling | ✓ |
| WebSocket only | No polling, WS only | |

**User's choice:** WebSocket + polling fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Proxy through Bridge | New lemongrid.websocket handler in main.js | ✓ |
| Direct WS + polling fallback | Try direct WS from webview, fallback on failure | |

**User's choice:** Proxy through Bridge

| Option | Description | Selected |
|--------|-------------|----------|
| Show all states | Distinct UI for PENDING, QUEUED, SYNCING, RUNNING, COMPLETED, FAILED, CANCELLED | ✓ |
| Simplified 3-state | Waiting, Generating, Done/Failed | |

**User's choice:** Show all states distinctly

| Option | Description | Selected |
|--------|-------------|----------|
| Same progress bar | Reuse component, different data source | ✓ |
| Enhanced cluster progress bar | New component with queue/sync/generate phases | |

**User's choice:** Reuse existing progress bar component (enhanced with state text)

| Option | Description | Selected |
|--------|-------------|----------|
| Show queue ETA | Use /tasks/{id}/eta endpoint | |
| Queue position only | Just show position number | ✓ |

**User's choice:** Queue position only, no ETA

| Option | Description | Selected |
|--------|-------------|----------|
| Adaptive polling | 2s queue, 1s running | ✓ |
| Fixed 2-second | Same interval throughout | |

**User's choice:** Adaptive polling (2s queue, 1s run)

**Notes:** Additional decisions: Show previews during running, show duration on completion, no stall detection, no timeout (rely on server), cancel via LemonGrid API, download all outputs, auto-import all results to PS, same History panel with source filter, per-task WebSocket for concurrency, auto-fallback to polling (no user prompt), support concurrent tasks, mini task list UI, snapshot params at submit, auto re-auth on 401, retry button on failure, same PS import flow, error codes + suggestions, toast on mode switch, auto-display results, block mode switch during tasks, auto-detect environment, same handleGenerate function with branch, independent output state, poll for completion, queue position from task status.

---

## Credential Storage & Authentication

| Option | Description | Selected |
|--------|-------------|----------|
| Token + username only | JWT token + username in Zustand persist, password never stored | ✓ (base decision) |
| Remember password (encrypted) | AES encrypted password for auto-login | ✓ ("Remember me" option) |
| Plain text | All in localStorage plain text | |

**User's choice:** Token + username only by default, AES encrypted password with "Remember me" option

| Option | Description | Selected |
|--------|-------------|----------|
| Login form in Settings | Settings page with server URL + username + password fields | |
| Modal dialog on demand | Popup when auth needed | ✓ |

**User's choice:** Modal dialog on demand (appears on mode switch + re-auth failure)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto re-login | Re-authenticate silently with stored credentials | ✓ |
| Manual re-login | Show "Session expired", user re-enters password | |

**User's choice:** Auto re-login

**Notes:** Additional decisions: Try silent auto-login first, show connection status in Settings + Draw page, auto-open login modal on mode switch, Logout button in Settings, "Remember me" with AES encryption, use refresh tokens (7-day), validate token on startup, client-side input validation, specific error messages, show loading state, hide token expiry from user, cancel tasks on logout, no forgot password link, toast + auto-reconnect on network loss, show auth errors on Draw page, fetch user info on login, new lemongridStore, single server profile, keep server URL + username after logout.

---

## Queue & State UX

| Option | Description | Selected |
|--------|-------------|----------|
| Show position from task status | Queue position from task status response | ✓ |
| Fetch from queue API | Separate API call for full queue info | |

**User's choice:** Show position from task status

| Option | Description | Selected |
|--------|-------------|----------|
| Hide cluster status | No GPU node info for plugin users | ✓ |
| Show cluster status | Display node count and utilization | |

**User's choice:** Hide cluster status

| Option | Description | Selected |
|--------|-------------|----------|
| Colored state badges | Color-coded badges for each task state | ✓ |
| Text-only labels | Plain text state names | |

**User's choice:** Colored state badges

| Option | Description | Selected |
|--------|-------------|----------|
| Click to see error details | Failed badge, expand for error info | ✓ |
| Inline error in task list | Error message visible without interaction | |

**User's choice:** Click to see error details

| Option | Description | Selected |
|--------|-------------|----------|
| Keep completed in list | Stay until dismissed or mode switch | ✓ |
| Auto-move to History | Disappear from task list on completion | |

**User's choice:** Keep completed in list

**Notes:** Additional decisions: Show limit reached message, mini task list below Generate button, expandable task items (collapsed = progress + badge, expanded = details + actions + thumbnail), compact single-row items, newest first, running count summary, retry + dismiss buttons, cancel in task list, no task ID shown, show result thumbnail, show template name per task, all outputs auto-import to PS.

---

## Settings & Mode Toggle UI

| Option | Description | Selected |
|--------|-------------|----------|
| Settings page toggle | Radio buttons at top of Settings page | ✓ |
| Draw page toggle | Toggle on main work page | |

**User's choice:** Settings page toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Show only relevant settings | Hide inactive mode's section | ✓ |
| Show both, gray out inactive | Both sections always visible | |

**User's choice:** Show only relevant mode settings

---

## Service & Bridge Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| TaskService interface | Shared interface, two implementations | ✓ |
| Direct function calls | No abstraction, if/else in Draw.tsx | |

**User's choice:** TaskService interface pattern

| Option | Description | Selected |
|--------|-------------|----------|
| New lemongrid.fetch handler | Separate handler with JWT auth | ✓ |
| Extend comfyui.fetch | Add auth parameter to existing handler | |

**User's choice:** New lemongrid.fetch handler (also new lemongrid.websocket and lemongrid.uploadAsset)

---

## Preset Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Same preset store, template_id as key | Extend existing store | ✓ |
| Separate preset store | New store for Cluster Mode | |

**User's choice:** Same preset store with template_id as key. Import/export works the same.

---

## Code Architecture & Sharing

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror ComfyUIClient | Independent LemonGridClient with same interface | ✓ |
| Wrapper around ComfyUIClient | Thin wrapper translating calls | |

**User's choice:** Mirror ComfyUIClient interface

| Option | Description | Selected |
|--------|-------------|----------|
| Extract shared utils | Common module for base64, blob, progress | ✓ |
| Independent implementations | Each mode has own utilities | |

**User's choice:** Extract shared utilities

---

## Claude's Discretion

- Exact param_schema field type → UI component mapping
- AES encryption key derivation strategy
- Login modal visual layout
- Mini task list animations
- Error code → user message mapping
- Retry/backoff strategy

## Deferred Ideas

- Template creation/editing from plugin — admin-only for now
- Template search/filter UI — full list sufficient
- Multiple LemonGrid server profiles — single config
- GPU cluster status display — admin-level
- Template favoriting — future enhancement
- "Forgot password?" link — internal tool
- Direct Mode WebSocket Bridge proxy refactor — only if CORS issues arise
