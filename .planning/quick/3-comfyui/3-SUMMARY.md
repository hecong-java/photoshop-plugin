---
phase: quick-3-comfyui
plan: 01
subsystem: webapp
tags: [comfyui, queue, ui, store, api]
dependency_graph:
  requires: [comfyui-service, zustand-store]
  provides: [queue-status-display]
  affects: [Draw-page]
tech_stack:
  added: [ComfyUIQueueItem, ComfyUIQueueStatus, fetchQueue]
  patterns: [Zustand store, React useEffect polling]
key_files:
  created: []
  modified:
    - code/webapp/src/services/comfyui.ts
    - code/webapp/src/stores/comfyui.ts
    - code/webapp/src/pages/Draw.tsx
    - code/webapp/src/pages/Draw.css
decisions:
  - Poll queue every 2 seconds during generation for real-time updates
  - Display queue badges only when jobs exist (not always visible)
  - Use green badge for running jobs, gray for pending
metrics:
  duration: 5m
  completed_date: 2026-03-12
  task_count: 3
  file_count: 4
---

# Quick Task 3: ComfyUI Queue Display Summary

## One-liner

Added ComfyUI task queue display showing running and pending job counts with auto-refresh during generation.

## What was done

Implemented a complete queue status feature across three layers:

1. **API Layer (comfyui.ts)**: Added `getQueue()` method to fetch queue status from `/queue` endpoint, parsing the tuple-based response format into typed `ComfyUIQueueItem` objects.

2. **State Layer (comfyui.ts store)**: Extended Zustand store with `queueRunning`, `queuePending`, `isLoadingQueue` state and `fetchQueue()` action.

3. **UI Layer (Draw.tsx)**: Added queue status display in preview header with:
   - Auto-fetch on connection
   - 2-second polling during generation
   - Visual badges for running (green, gear icon) and pending (gray, hourglass icon) jobs

## Files Modified

| File | Changes |
|------|---------|
| `code/webapp/src/services/comfyui.ts` | Added `ComfyUIQueueItem`, `ComfyUIQueueStatus` types, `queue` paths, `getQueue()` method |
| `code/webapp/src/stores/comfyui.ts` | Added queue state fields and `fetchQueue` action |
| `code/webapp/src/pages/Draw.tsx` | Added queue store usage, fetch effects, queue badges JSX |
| `code/webapp/src/pages/Draw.css` | Added `.queue-status`, `.queue-badge`, `.queue-running`, `.queue-pending` styles |

## Commits

| Commit | Message |
|--------|---------|
| `30bb172` | feat(quick-3): add getQueue method to ComfyUIClient |
| `869baf5` | feat(quick-3): add queue state to ComfyUI store |
| `0f07e4b` | feat(quick-3): add queue display UI to Draw page |

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

- TypeScript compilation passes without errors
- Queue display only shows when jobs exist (running or pending)
- Auto-refresh every 2 seconds during generation
- Green badge with gear icon for running jobs
- Gray badge with hourglass icon for pending jobs

## Self-Check: PASSED

- [x] All files exist at specified paths
- [x] All commits present in git history
