---
status: resolved
trigger: LemonGrid插件中历史图片加载性能过低，需要调查当前实现方式以及LemonGrid项目本身的图片加载机制
created: 2026-05-20
updated: 2026-05-20
---

## Symptoms

### Expected Behavior
LemonGrid任务历史中的图片应该快速加载显示，不造成页面卡顿或内存问题。

### Actual Behavior
- 加载速度很慢
- 页面卡顿/无响应
- 内存占用过高
- 部分图片不显示

### Error Messages
无运行时错误，但内存和性能问题严重。

### Timeline
持续存在的问题。

### Reproduction
打开LemonGrid任务历史，查看已完成任务的生成图片。

### Context
- 场景：LemonGrid集群中已完成任务的生成图片
- 对比参考：本地LemonGrid项目代码位于 D:\projects\LemonGrid\LemonGrid

## Current Focus

hypothesis: CONFIRMED — 插件端下载全分辨率Blob到内存，而非使用缩略图API URL
next_action: root cause found
test: null
expecting: null
reasoning_checkpoint: null

## Evidence

- 2026-05-20: **Plugin implementation** (`code/webapp/src/stores/historyStore.ts` lines 334-408): `fetchFromCluster()` downloads every asset as a full-resolution Blob via `client.downloadAsset(firstAssetId)`, then creates `URL.createObjectURL(blob)`. This fetches the ENTIRE full-resolution PNG/JPG for every single task in history, sequentially, and holds them all in memory as Blob URLs.
- 2026-05-20: **LemonGrid project implementation** (`fluxcore-frontend/src/pages/design/components/TaskHistory.tsx` lines 278-284): Uses `assetApi.getThumbnailUrl(task.output_file_ids[0])` which returns the URL string `/api/v1/assets/library/${assetId}/thumbnail`. The browser loads these as lazy HTTP requests — small resized images, no Blob storage in JS memory.
- 2026-05-20: **LemonGrid project implementation** (`fluxcore-frontend/src/pages/design/components/TaskCard.tsx` lines 204-207): Same pattern — uses thumbnail URL for completed task output preview images via `<img src={assetApi.getThumbnailUrl(assetId)}>` — small, lazy-loaded thumbnails.
- 2026-05-20: **Thumbnail API exists** (`fluxcore-backend/app/api/v1/assets.py` line 975): Backend already has a `GET /library/{asset_id}/thumbnail` endpoint that serves pre-generated resized thumbnails. The backend generates these on upload (`asset_service.py` line 285+).
- 2026-05-20: **Plugin fetchFromCluster fetches ALL pages** (`historyStore.ts` lines 340-347): Iterates through all pages (page_size=50) and downloads ALL tasks' first asset as full Blob before any UI renders. With 200 tasks, this means 200 sequential full-resolution image downloads.
- 2026-05-20: **Plugin stores Blobs in memory** (`lemongridStore.ts` lines 26-29): `ClusterOutputImage` interface stores `blob: Blob | null` alongside the URL, doubling memory usage for every image.
- 2026-05-20: **Plugin has no thumbnail API call** (`code/webapp/src/services/lemongrid.ts`): The `LemonGridClient` class has no `getThumbnailUrl()` method and no thumbnail endpoint usage at all. Only has `downloadAsset()` which fetches the full file.

## Eliminated

- Not a network latency issue — the problem is architectural (downloading full blobs instead of using thumbnail URLs)
- Not a rendering issue — CSS/layout is fine

## Resolution

root_cause: The plugin's `fetchFromCluster()` in historyStore.ts downloads every history task's output image as a full-resolution Blob via `downloadAsset()`, then holds all Blobs in memory as object URLs. The LemonGrid project itself uses a dedicated thumbnail API (`/api/v1/assets/library/{assetId}/thumbnail`) that returns pre-generated small images, loaded lazily by the browser via plain `<img src>` — no Blob storage, no JS memory pressure. The plugin is missing the thumbnail API entirely; it has no awareness that the backend supports thumbnail endpoints.

fix: Three changes needed:
1. Add `getThumbnailUrl(assetId: string): string` method to `LemonGridClient` in `lemongrid.ts` that returns `{serverUrl}/api/v1/assets/library/${assetId}/thumbnail`. This mirrors the LemonGrid project's `assetApi.getThumbnailUrl()`.
2. Rewrite `fetchFromCluster()` in `historyStore.ts` to use thumbnail URLs instead of downloading full Blobs. Set `thumbnailUrl` and `imageUrl` to the thumbnail URL string for list view, and only download the full Blob on-demand when the user clicks "download" or "sync to PS".
3. Remove the Blob storage from the cluster history flow — don't store `blob: Blob` in memory for every history item. The `ClusterOutputImage` type in `lemongridStore.ts` should only store the URL string, and download the Blob on-demand in the action handlers.

verification: After fix, history page should load nearly instantly (only API calls for task list metadata, no asset downloads). Memory usage should stay flat until user explicitly downloads/views a full image.

files_changed:
- code/webapp/src/services/lemongrid.ts (add getThumbnailUrl method)
- code/webapp/src/stores/historyStore.ts (rewrite fetchFromCluster to use thumbnail URLs)
- code/webapp/src/stores/lemongridStore.ts (remove blob from ClusterOutputImage, keep URL-only for history)
