---
phase: 06-lemongrid-integration
plan: 03
subsystem: LemonGrid Integration
tags: [mini-task-list, websocket-progress, polling-fallback, retry, cancel, history-filter, cluster-tasks]
dependency_graph:
  requires: [06-01, 06-02]
  provides: [MiniTaskList, WS progress tracking, polling fallback, task retry/cancel, result download/import, history source filter]
  affects: [Draw.tsx, Draw.css, MiniTaskList.tsx, MiniTaskList.css]
tech-stack:
  added: [window message event listener for Bridge WS relay, per-task polling loops]
  patterns: [WebSocket + polling dual-mode progress, per-task WS connections through Bridge refs, expand/collapse task items]
key-files:
  created:
    - code/webapp/src/components/MiniTaskList.tsx
    - code/webapp/src/components/MiniTaskList.css
  modified:
    - code/webapp/src/pages/Draw.tsx
    - code/webapp/src/pages/Draw.css
decisions:
  - MiniTaskList as standalone component with props for onRetry and onImportResult callbacks
  - Badge CSS class names follow pattern badge-{status} with color mapping per D-57
  - Per-task WebSocket connections tracked in useRef to avoid re-render issues
  - Polling fallback auto-activates on WS close/failure with no user prompt per D-38
  - Adaptive polling interval: 1s for RUNNING, 2s for PENDING/QUEUED/SYNCING per D-28
  - handleClusterSubmit keeps isGenerating true after submit (removed early false-set from Plan 02)
  - History source filter only visible in Cluster Mode, defaults to 'all'
  - Concurrent limit error detected by error message content (concurrent/limit/429)
metrics:
  duration: 16min
  completed: 2026-04-28
  tasks: 2
  files: 4
---

# Phase 06 Plan 03: Mini task list, WebSocket progress, polling fallback, retry, history filter Summary

Complete Cluster Mode task lifecycle: MiniTaskList component with expandable items and state badges, WebSocket progress tracking through Bridge proxy with auto-fallback to polling, task cancel/retry/dismiss actions, result auto-download and PS import, and History panel source filter per D-22 through D-69.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | MiniTaskList component with state badges, expand/collapse, and task actions | 2c57814 | MiniTaskList.tsx, MiniTaskList.css |
| 2 | WebSocket progress + polling fallback + retry + result download + history filter in Draw.tsx | c11d84b | Draw.tsx, Draw.css |

## Key Changes

### Task 1: MiniTaskList Component

- **MiniTaskList.tsx**: New component per D-55 through D-68. Receives `onRetry` and `onImportResult` callbacks as props. Reads all tasks from lemongridStore, sorted by `submittedAt` descending (newest first). Summary bar shows counts of running/completed/failed tasks. Collapsed view shows template name + mini progress bar + state badge in single row (~36px height). Expanded view shows queue position, progress detail, duration, error code/message/suggestion, retry/dismiss buttons, import buttons for completed tasks, and thumbnail. Cancel button visible in collapsed view (no expand needed). Badge colors: PENDING(gray), QUEUED(yellow), SYNCING(blue), RUNNING(green), COMPLETED(green+check), FAILED(red), CANCELLED(gray). Uses LemonGridClient.cancelTask for cancel action.
- **MiniTaskList.css**: Compact styling with dark theme consistent with existing Draw.css conventions. Progress bar mini at 4px height, badge pills with color-coded backgrounds, error section with red tint, import/retry/dismiss buttons.

### Task 2: Draw.tsx Cluster Task Lifecycle

- **Draw.tsx**: Added imports for `sendBridgeMessage`, `ensureValidToken`, `MiniTaskList`. Added state: `historySourceFilter` ('all'|'direct'|'cluster'), `wsConnectionRefs` (useRef for per-task WS connection IDs). Modified `handleClusterSubmit`: removed premature `setIsGenerating(false)`, added `startClusterWebSocket(result.id)` call after task submission. Added `syncGeneratedImageToPsLayer` for cluster result PS import (uses 'cluster-output' as workflow name). Added `startClusterWebSocket`: creates per-task WS through Bridge via `sendBridgeMessage('lemongrid.websocket', { taskId })`, falls back to polling on failure. Added `closeTaskWebSocket`: closes WS connection via Bridge. Added `startPollingForTask`: recursive setTimeout polling with adaptive intervals (1s running, 2s queued), auto re-auth via `ensureValidToken`, updates store on each poll, stops on terminal state. Added `handleTaskCompletion`: downloads all output assets via `LemonGridClient.downloadAsset`, auto-imports each to PS layer, stores in `clusterOutputImages`. Added `handleRetryTask`: removes failed task, re-submits with same params. Added `handleImportClusterResult`: re-downloads and imports specific asset. Added `useEffect` for WS message listener: handles `lemongrid.ws.message` (task_started/progress/completed/failed) and `lemongrid.ws.close` (auto-fallback to polling). Added `useEffect` cleanup for WS connections on unmount. Added concurrent task limit error detection (concurrent/limit/429). Added MiniTaskList rendering below Generate button in Cluster Mode. Added History source filter (All/Direct/Cluster) in preview header when in Cluster Mode.
- **Draw.css**: Added `.history-source-filter` styling with active/inactive button states.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- TypeScript compilation: PASSED (zero errors after both tasks)
- `lemongrid.ws.message` message handler present in Draw.tsx (line 513)
- `startPollingForTask` function defined (line 2951)
- `handleRetryTask` function defined (line 3026)
- `handleImportClusterResult` function defined (line 3066)
- `MiniTaskList` component rendered in Draw.tsx (line 4430)
- `historySourceFilter` state and filter buttons present (line 268, 3803-3813)
- `badge-queued` CSS class generated by dynamic `badge-${badge}` pattern in MiniTaskList
- `formatDuration` helper function present in MiniTaskList (line 53)

## Self-Check: PASSED

- code/webapp/src/components/MiniTaskList.tsx: FOUND
- code/webapp/src/components/MiniTaskList.css: FOUND
- code/webapp/src/pages/Draw.tsx: FOUND
- code/webapp/src/pages/Draw.css: FOUND
- Commit 2c57814: FOUND in git log
- Commit c11d84b: FOUND in git log
