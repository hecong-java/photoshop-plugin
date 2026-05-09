---
phase: quick-260509-cluster-history-lemongrid-api
plan: 01
subsystem: frontend
tags: [history, lemongrid, cluster, api]
dependency_graph:
  requires: [lemongridStore, LemonGridClient, historyStore]
  provides: [cluster-history-in-history-panel]
  affects: [History.tsx, HistoryList.tsx, HistoryList.css, historyStore.ts, lemongrid.ts]
tech_stack:
  added: [LemonGridTaskHistoryItem, LemonGridTaskHistoryResponse, getTaskHistory, fetchFromCluster]
  patterns: [dual-source-history-merge, css-data-attribute-badge]
key_files:
  created: []
  modified:
    - code/webapp/src/services/lemongrid.ts
    - code/webapp/src/stores/historyStore.ts
    - code/webapp/src/pages/History.tsx
    - code/webapp/src/components/history/HistoryList.tsx
    - code/webapp/src/components/history/HistoryList.css
decisions:
  - Cluster items stored separately in clusterItems array; merging done in UI layer
  - CSS data-source attribute used for cluster badge instead of modifying HistoryItemComponent
  - Cluster items cannot be deleted from history page (server-side managed)
  - Cluster fetch failure does not wipe ComfyUI items
  - "Not connected" guard updated to allow viewing when either ComfyUI or LemonGrid is connected
metrics:
  duration: 5m
  completed: 2026-05-09
  tasks: 2
  files: 5
---

# Quick Task 260509: Cluster History via LemonGrid API Summary

LemonGrid cluster task history wired into unified History panel with dual-source merge and visual source badge.

## What Changed

### Task 1: LemonGridClient.getTaskHistory + historyStore.fetchFromCluster (81cfc40)
- Added `LemonGridTaskHistoryItem` and `LemonGridTaskHistoryResponse` interfaces to lemongrid.ts
- Added `LemonGridClient.getTaskHistory()` method calling `GET /api/v1/tasks?history_only=true`
- Added optional `source` field to `HistoryItem` interface (`'direct' | 'cluster'`)
- Added `clusterItems` array and `fetchFromCluster(serverUrl)` action to historyStore
- `fetchFromCluster` maps LemonGrid task fields to HistoryItem with `source='cluster'`
- `fetchFromComfyUI` items tagged with `source='direct'`
- Cluster fetch failure is non-destructive (logs warning, does not wipe ComfyUI items)

### Task 2: History.tsx integration with source badge (1d68b6e)
- History.tsx fetches from both ComfyUI and LemonGrid when connected
- Items merged into `allItems` sorted by timestamp descending
- Header shows "(N direct + M cluster)" breakdown when cluster items exist
- Cluster items tagged with "[集群]" badge via CSS `data-source` attribute
- Download handler branches for cluster (LemonGrid asset URL) vs direct (ComfyUI view URL) items
- Refresh button reloads both sources
- Delete guarded to skip cluster items (server-side managed)
- "Not configured" guard updated to show if either ComfyUI or LemonGrid is connected
- HistoryList accepts `directCount`/`clusterCount` props for source breakdown display

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- TypeScript compiles with zero errors (`npx tsc --noEmit`)
- All 5 modified files present on disk
- Both commits present in git log

## Self-Check: PASSED

All 6 files verified present on disk. Both commit hashes (81cfc40, 1d68b6e) verified in git log.
