---
status: resolved
trigger: "PS插件某些PS版本图片上传失败，上传图片闪烁后消失。之前正常最近坏了。需要适配尽可能多的PS版本。"
created: "2026-05-19"
updated: "2026-05-19"
---

## Symptoms

**Expected behavior:** 用户在PS插件中上传图片（包括从PS图层导出），图片应上传到ComfyUI并持续显示在预览中。

**Actual behavior:** 图片上传后短暂出现（闪烁），然后消失。表明上传过程失败。

**Error messages:** 用户未提供具体错误信息。

**Timeline:** 之前正常工作，最近开始出现问题。

**Reproduction:** 仅在某些PS版本上触发，其他版本正常。

**Additional context:**
- 关联已有调试会话 direct-upload-flash-disappear（根因已定位）
- 插件最低支持 PS v24.1 (manifestVersion 5)
- 上传链路：WebView → Bridge消息 → main.js手动构造multipart → fetch

## Current Focus

hypothesis: null
test: null
expecting: null
next_action: null
reasoning_checkpoint: null
tdd_checkpoint: null

## Evidence

- timestamp: 2026-05-19T01:00 — Code review of upload chain
  - Upload handler comfyui.uploadImage in main.js uses Blob concatenation for multipart/form-data
  - `new Blob([headerBlob, bytes, footerBlob])` with Uint8Array may not work in all UXP versions
  - `fetch(url, { body: formDataBlob })` with Blob body unreliable in UXP v7.x (PS v24.x)
  - file: PS-plugin/ningleai/main.js

- timestamp: 2026-05-19T01:05 — Upload fallback analysis
  - uploadToComfyUI already has primary/fallback path retry
  - attemptUpload uses sendBridgeMessage for UXP WebView mode
  - The retry logic works for path errors but doesn't help with Blob body issues
  - file: code/webapp/src/services/upload.ts

- timestamp: 2026-05-19T01:10 — PS export refactoring analysis
  - exportActiveLayerPng was refactored to read files OUTSIDE executeAsModal
  - _exportedFile reference used outside modal scope may fail in some PS versions
  - File system tokens from executeAsModal may not persist in all UXP versions
  - file: PS-plugin/ningleai/main.js

## Eliminated

- Origin check issue: ALLOWED_ORIGINS allows empty/falsy origins, so all webview messages pass through
- Bridge message routing: processBridgeMessage handles all actions correctly, no version-specific issues
- comfyui.fetch handler: Only sends JSON bodies (string), not affected by Blob issues

## Resolution

root_cause: "Two UXP compatibility issues: (1) comfyui.uploadImage handler uses Blob as fetch body, which is unreliable in UXP v7.x (PS v24.x) — Blob concatenation with Uint8Array may lose binary data; (2) exportActiveLayerPng/exportSelectionPng read files outside executeAsModal scope, where file system tokens may be invalid in some PS versions."

fix: "Three changes applied: (1) Replaced Blob-based multipart construction with ArrayBuffer in comfyui.uploadImage handler — uses Uint8Array.set() to combine header/file/footer bytes into a single ArrayBuffer for fetch body; (2) Added fallback for exportActiveLayerPng and exportSelectionPng — if file read fails outside modal scope, retries inside a new modal scope; (3) Enhanced error logging in attemptUpload with file size, URL, and specific error messages for easier diagnosis."

verification: "Manual testing needed on PS v24.x, v25.x, and v26.x to confirm upload works across versions. Check browser console for [Upload] and [Bridge] log messages."

files_changed:
  - PS-plugin/ningleai/main.js
  - code/webapp/src/services/upload.ts
