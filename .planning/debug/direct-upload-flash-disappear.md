---
status: root_cause_found
trigger: "用户反馈在PS插件中使用直连模式，上传图片，闪了一下，然后图片又不显示了，其他人没问题"
created: "2026-05-16"
updated: "2026-05-16"
---

## Symptoms

**Expected behavior:** 用户在PS插件中使用直连模式上传图片后，图片应持续显示在图层中。

**Actual behavior:** 图片上传后在图层中短暂出现（闪了一下），然后突然消失。

**Error messages:** 用户未报告具体错误信息。

**Timeline:** 最近才出现的问题，之前该用户使用直连模式上传是正常的。

**Reproduction:** 仅特定用户使用直连模式上传图片时触发。其他用户使用相同直连模式上传正常。

**Additional context:**
- 仅影响一个用户，其他用户直连模式正常
- 集群模式表现未确认
- 最近才开始出现此问题

## Current Focus

hypothesis: "uploadToComfyUI fallback logic only triggers on 405 errors — user's ComfyUI may have a different reverse proxy configuration that returns a non-405 error for the wrong upload path"
test: null
expecting: null
next_action: "fix the upload fallback to be more resilient to different error types"
reasoning_checkpoint: null
tdd_checkpoint: null

## Evidence

- timestamp: 2026-05-16T10:00 — Code review of upload flow
  - `uploadImageFileToInput` (Draw.tsx:2802) creates blob URL preview immediately, then uploads to ComfyUI asynchronously
  - On upload failure (catch block, line 2843-2853): clears `uploadedImagePreviews`, `uploadedImageBlobsRef`, `uploadedImageBase64Ref`
  - This matches the "flash then disappear" pattern: preview appears -> upload fails -> preview cleared
  - file: code/webapp/src/pages/Draw.tsx
  - lines: 2802-2854

- timestamp: 2026-05-16T10:10 — Upload fallback logic analysis
  - `uploadToComfyUI` (upload.ts:297) only falls back to alternate path on 405/Method Not Allowed errors
  - If user's ComfyUI returns 404, 403, 500, or times out, the fallback is NOT attempted
  - Each direct-mode user connects to their own ComfyUI instance with potentially different config
  - file: code/webapp/src/services/upload.ts
  - lines: 297-325

- timestamp: 2026-05-16T10:15 — Bridge upload path analysis
  - In UXP WebView mode, upload uses `sendBridgeMessage('comfyui.uploadImage', { url: uploadUrl, ... })`
  - The URL is constructed as `{baseUrl}/upload/image` or `{baseUrl}/api/upload/image` based on `prefixMode`
  - If stored `prefixMode` doesn't match the user's actual ComfyUI config, the upload path will be wrong
  - Bridge handler in main.js (line 878) constructs multipart/form-data manually and POSTs to the URL
  - file: code/webapp/src/services/upload.ts
  - lines: 327-368

- timestamp: 2026-05-16T10:20 — Recent code changes
  - `uploadedImagePreviews` type changed from `Record<string, string>` to `Record<string, string | string[]>`
  - But `uploadedImagePreviewsRef` was NOT updated — still typed as `Record<string, string>`
  - This type mismatch is a TypeScript issue but does not cause runtime problems for direct mode (which only stores strings)
  - `fetchWorkflows` now passes `prefixMode` to `listWorkflows` and `getObjectInfo` — previously used default
  - file: code/webapp/src/pages/Draw.tsx
  - lines: 257, 277

- timestamp: 2026-05-16T10:25 — StrictMode remount analysis
  - Line 396-404: Restore image previews from ref on mount (handles React StrictMode remount)
  - The ref is typed as `Record<string, string>` but state can hold `string | string[]`
  - For direct mode, this is fine since only strings are stored
  - The remount logic would not cause the preview to disappear for a single user
  - file: code/webapp/src/pages/Draw.tsx
  - lines: 396-404

- timestamp: 2026-05-16T10:30 — Root cause narrowed to upload failure + narrow fallback
  - The "only one user" pattern strongly suggests user-specific ComfyUI configuration
  - The user may have recently changed their ComfyUI setup (updated, added reverse proxy, changed nginx config)
  - The stored `prefixMode` may no longer match their ComfyUI's actual path requirements
  - The fallback only catches 405 errors — other HTTP errors (404, 500, CORS) are not retried with alternate path
  - file: code/webapp/src/services/upload.ts
  - lines: 305-325

## Eliminated

- React StrictMode remount: Would affect all users, not just one. Ref type mismatch is TypeScript-only, no runtime effect for direct mode (strings only).
- Blob URL revocation: Only happens on workflow switch (handleWorkflowSelect) or explicit removal — not triggered by upload.
- Cache size limits: MAX_IMAGE_SIZE (500KB) only affects workflow cache persistence, not the upload flow or preview display.
- Bridge message race condition: The double `pendingRequests.set` is functionally correct; the overwrite has the correct resolve/reject with timeout cleanup.
- Auto-sync to PS layers: `importBase64ToPsLayer` is only called for generated output images, never for uploaded inputs.

## Resolution

root_cause: "uploadToComfyUI fallback only triggers on HTTP 405 errors. When a user's ComfyUI has a path mismatch (e.g., reverse proxy returning 404/500/CORS error for the wrong prefix path), the upload fails without trying the alternate path. The preview appears (blob URL), then the upload fails and the catch block clears the preview — producing the flash-then-disappear symptom. Only affects users whose ComfyUI configuration doesn't match the stored prefixMode."

fix: "Widen the upload fallback in uploadToComfyUI to try the alternate path on any HTTP error (not just 405). Additionally, log the error details so the user can see what went wrong. Consider adding a connectivity check that tests both paths before upload."

verification: "1. Simulate wrong prefixMode: set oss when ComfyUI needs api (or vice versa). 2. Verify the fallback now catches the error and retries. 3. Verify the preview persists after successful upload via fallback path."

files_changed:
  - code/webapp/src/services/upload.ts
  specialist_hint: typescript
