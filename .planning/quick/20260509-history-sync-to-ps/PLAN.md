---
status: in-progress
created: 2026-05-09
---

# Quick Task: History Sync to PS Layer

## Goal
Add a "sync to PS layer" button on history items that downloads the image and sends it to Photoshop as a new layer via the existing PS Bridge.

## Tasks

### T1: Add `onSyncToPS` prop to HistoryItem + HistoryList
- Files: `HistoryItem.tsx`, `HistoryList.tsx`
- Add `onSyncToPS: (item: HistoryItem) => Promise<void>` prop
- Add "同步到PS" button in actions row with loading state

### T2: Implement `handleSyncToPS` in History.tsx
- File: `History.tsx`
- Import `usePSBridge` hook
- Handle both direct (ComfyUI fetch → blob → base64) and cluster (LemonGridClient.downloadAsset → blob → base64)
- Call `importBase64AsLayer` with base64 data
- Add success/error toast state

### T3: Add button styling
- File: `HistoryItem.css`
- Style the sync-to-PS button to fit existing button styles (use btn-success class)

## Key Decisions
- Use `importBase64AsLayer` (not `importImageAsLayer`) because history images come from URLs, not local file paths
- Blob → base64 conversion via FileReader in the handler
- Reuse existing download infrastructure for fetching images
