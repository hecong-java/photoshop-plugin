---
phase: 06-lemongrid-integration
plan: 01
subsystem: LemonGrid Integration
tags: [bridge, auth, store, settings, login, mode-toggle]
dependency_graph:
  requires: []
  provides: [lemongrid.fetch, lemongrid.websocket, lemongrid.uploadAsset, lemongridStore, connectionMode, lemongrid-auth, LoginModal]
  affects: [main.js, settingsStore, Settings.tsx]
tech-stack:
  added: [Web Crypto API (AES-GCM), Zustand persist, Bridge WebSocket relay]
  patterns: [JWT auth injection via Bridge, AES-GCM password encryption, service adapter]
key-files:
  created:
    - code/webapp/src/stores/lemongridStore.ts
    - code/webapp/src/services/lemongrid-auth.ts
    - code/webapp/src/components/LoginModal.tsx
    - code/webapp/src/components/LoginModal.css
  modified:
    - PS-plugin/ningleai/main.js
    - code/webapp/src/stores/settingsStore.ts
    - code/webapp/src/pages/Settings.tsx
    - code/webapp/src/pages/Settings.css
decisions:
  - Bridge handlers inject JWT from settingsStorage (set by webview via settings.set)
  - WebSocket proxied through main.js via lemongrid.websocket handler with connection ID tracking
  - AES-GCM encryption for Remember Me uses PBKDF2 key derivation with static salt
  - Tasks and clusterOutputImages are transient (not persisted) per D-102
  - Browser mode adds Authorization header manually from lemongridStore; UXP mode relies on Bridge
metrics:
  duration: 12min
  completed: 2026-04-27
  tasks: 2
  files: 8
---

# Phase 06 Plan 01: Bridge handlers, auth service, stores, login modal, settings toggle Summary

LemonGrid Cluster Mode foundation with four Bridge proxy handlers (lemongrid.fetch, lemongrid.websocket, lemongrid.websocket.close, lemongrid.uploadAsset), JWT auth lifecycle via lemongrid-auth.ts, persistent lemongridStore for auth tokens and task tracking, LoginModal with Remember Me, and Settings page mode toggle.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Bridge handlers + settingsStore extension + lemongridStore | 247a5e4 | main.js, settingsStore.ts, lemongridStore.ts |
| 2 | lemongrid-auth service + LoginModal + Settings mode toggle | ce92dd3 | lemongrid-auth.ts, LoginModal.tsx, LoginModal.css, Settings.tsx, Settings.css |

## Key Changes

### Task 1: Bridge Handlers and Stores

- **main.js**: Added `lemongrid.fetch` handler that reads JWT from `settingsStorage.get('lemongrid')` and injects `Authorization: Bearer` header. Added `lemongrid.websocket` handler that creates a WebSocket to LemonGrid's `/ws/v1/realtime?token=JWT` endpoint and relays messages to the webview via `postMessage`. Added `lemongrid.websocket.close` handler for cleanup. Added `lemongrid.uploadAsset` handler with multipart form data, `name="file"` field name, `library_type` form field, and JWT auth injection. Active WS connections tracked in `handlers._lgWsConnections` Map.
- **settingsStore.ts**: Added `connectionMode: 'direct' | 'cluster'` field with `setConnectionMode` action, defaulting to `'direct'`. Added to `partialize` for persistence.
- **lemongridStore.ts**: New Zustand persist store (`Ningleai-lemongrid`) with auth state (accessToken, refreshToken, tokenExpiresAt, username, userRole, isConnected), Remember Me state (encryptedPassword, rememberMe), task tracking (tasks Record, clusterOutputImages array). Partialize excludes tasks and clusterOutputImages per D-102. Includes version 1 with migration support.

### Task 2: Auth Service, Login Modal, Settings UI

- **lemongrid-auth.ts**: Provides `lemongridFetch` (mirrors bridgeFetch but uses `lemongrid.fetch` Bridge action), `loginToLemonGrid` (POST /api/v1/auth/login), `refreshAccessToken` (POST /api/v1/auth/refresh), `ensureValidToken` (checks expiry with 2-min buffer, tries refresh then re-login), `getUserProfile` (GET /api/v1/auth/me), `encryptPassword`/`decryptPassword` (AES-GCM via Web Crypto API with PBKDF2 key derivation), and `syncAuthToBridge` (pushes tokens to main.js settingsStorage).
- **LoginModal.tsx**: Modal with server URL, username, password inputs, Remember Me checkbox, loading spinner state, input validation (URL format, non-empty fields), specific error messages per D-84 (401, network, invalid URL). Pre-fills from stored values. Keyboard support (Enter to submit, Escape to cancel).
- **Settings.tsx**: Added connection mode toggle radio buttons ("直连 (ComfyUI)" / "集群 (LemonGrid)") at top of settings grid. Conditional rendering: ComfyUI card and Capabilities matrix visible only in direct mode, LemonGrid card visible only in cluster mode. LemonGrid card shows server URL input, login/logout button, username and role display. Mode switch to cluster auto-opens login modal if not authenticated (D-75). Mode switch blocked when cluster tasks are running (D-48). Logout clears auth but keeps serverUrl and username (D-76).

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- TypeScript compilation: PASSED (zero errors)
- All 4 Bridge handlers present in main.js
- `connectionMode` field and `setConnectionMode` action in settingsStore
- `useLemonGridStore` exported from lemongridStore
- All 4 exported auth functions in lemongrid-auth.ts
- LoginModal component with all required props and error messages
- Settings page with mode toggle and conditional sections

## Self-Check: PASSED

All files exist. All commits present in git log.
