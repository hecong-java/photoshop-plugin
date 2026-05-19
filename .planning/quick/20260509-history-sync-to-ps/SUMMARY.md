---
status: complete
created: 2026-05-09
---

# Quick Task: History Sync to PS Layer - Complete

## What was done
Added "同步到PS" (Sync to PS) button on history items that downloads the image and sends it to Photoshop as a new pixel layer via the existing PS Bridge.

## Files modified
- `code/webapp/src/pages/History.tsx` — Added `handleSyncToPS` handler with blob→base64 conversion, imports `usePSBridge`
- `code/webapp/src/components/history/HistoryItem.tsx` — Added `onSyncToPS` prop, sync button with loading state, error display
- `code/webapp/src/components/history/HistoryList.tsx` — Added `onSyncToPS` prop passthrough

## How it works
1. User clicks "同步到PS" on any history item
2. Handler fetches the first image (direct mode: ComfyUI URL fetch; cluster mode: LemonGridClient.downloadAsset)
3. Converts blob to base64 via FileReader
4. Calls `importBase64AsLayer` through PS Bridge → Photoshop creates a new pixel layer
5. Error feedback shown inline in the history item

## Verification
- TypeScript compiles with zero errors (`npx tsc --noEmit`)
- No new dependencies added
- Uses existing `btn-success` CSS class for styling
