---
status: diagnosed
trigger: "用户反馈安装Photoshop插件后出现多种间歇性问题：电脑变卡、快捷键失效（不能删除图层等）、上传图片时间很长、提示词无法输入、界面无法缩放或编辑、快捷键需要重置。问题不确定什么操作会触发，出现是随机的。"
created: 2026-04-16T00:00:00Z
updated: 2026-04-16T00:00:00Z
---

## Current Focus

hypothesis: Multiple contributing root causes identified - focus stealing via UXP WebView focus management, executeAsModal blocking Photoshop UI, and potential duplicate message listeners
test: Code review completed
expecting: Root causes match all reported symptoms
next_action: Return diagnosis

## Symptoms

expected: 插件安装后电脑运行流畅，所有Photoshop快捷键正常工作，界面响应及时
actual: 多种间歇性问题 - 上传图片时间有时很长，提示词无法输入，界面无法缩放或编辑，快捷键需要重置，删除图层等操作失效
errors: 用户未提供具体错误信息
reproduction: 不确定具体触发条件，问题是间歇性/随机出现的
started: 安装插件后出现，不确定是立即出现还是使用一段时间后出现

## Eliminated

- hypothesis: CSS/layout thrashing causing performance issues
  evidence: CSS is minimal, no expensive animations or layout patterns found. The pulse-glow animation is lightweight.
  timestamp: 2026-04-16

- hypothesis: Event listener leak in React components
  evidence: ContextMenu.tsx properly cleans up keydown listener (line 39). PromptReverseProvider.tsx properly cleans up scroll/resize/contextmenu listeners. usePSBridge.ts uses a guard flag to prevent duplicate attachment.
  timestamp: 2026-04-16

## Evidence

- timestamp: 2026-04-16
  checked: main.js - executeAsModal usage
  found: Multiple batchPlay calls use { synchronousExecution: true, modalBehavior: 'execute' } wrapped in core.executeAsModal(). This puts Photoshop into modal state which blocks ALL keyboard shortcuts, including delete layer, while the operation runs.
  implication: While executeAsModal is active, Photoshop's native shortcuts are completely disabled. Any plugin operation (export, import, upload) triggers this modal state.

- timestamp: 2026-04-16
  checked: main.js - base64 conversion in exportActiveLayerPngInternal (lines 345-352)
  found: Large image binary-to-base64 conversion using String.fromCharCode.apply in chunks of 0x8000. For high-resolution images (e.g., 2048x2048 PNG ~8-16MB), this creates massive temporary strings on the main thread.
  implication: This synchronous string concatenation blocks the UXP main thread during export, which can freeze both Photoshop UI and the plugin panel.

- timestamp: 2026-04-16
  checked: main.js - comfyui.fetch handler (lines 781-873)
  found: Binary response conversion (lines 837-842) uses the same String.fromCharCode.apply pattern for ALL binary responses (images, outputs). Large ComfyUI output images (can be 5-20MB) are converted to base64 synchronously.
  implication: Fetching output images via bridge blocks the main thread for potentially seconds.

- timestamp: 2026-04-16
  checked: Duplicate window.addEventListener('message') in webapp
  found: TWO separate message listeners are registered: one in services/upload.ts (line 57) and one in hooks/usePSBridge.ts (line 51). Both operate on separate `pendingRequests` Maps. When a bridge response arrives, BOTH listeners process it, but only one has the matching UUID entry.
  implication: Not a direct performance issue, but creates confusion. The upload.ts listener has no guard against re-registration (runs at module load time, so only once). The usePSBridge listener uses `listenerAttached` guard. No listener cleanup on unmount since both are module-level.

- timestamp: 2026-04-16
  checked: Draw.tsx - WebSocket handling during generation
  found: WebSocket is opened at generation start and closed in the finally block. During generation, queue is polled every 1000ms via setInterval (lines 423-426). If WebSocket fails, falls back to polling at 1200ms intervals for up to 2 minutes.
  implication: During generation, there is a 1-second polling loop plus potentially a WebSocket connection. This is moderate and unlikely to cause severe lag.

- timestamp: 2026-04-16
  checked: main.js - fs.listDownloads handler (lines 608-629)
  found: Reads the ENTIRE content of every file in the downloads folder to get file sizes (lines 615-619). If many files or large files exist, this reads all of them into memory synchronously.
  implication: This is a potential performance bottleneck that worsens over time as more files accumulate.

- timestamp: 2026-04-16
  checked: main.js - exportActiveLayerPngInternal temp folder cleanup
  found: Temporary folders and files are created for each export (lines 206-208, 399-401) but never deleted after use. Over time, these accumulate in the temp folder.
  implication: Growing temp folder could slow file system operations, but unlikely to be the primary cause.

- timestamp: 2026-04-16
  checked: index.html - webview configuration
  found: webview uses uxpEnableMessageBridge="true" which enables focus sharing between Photoshop and the webview panel. The webview loads from a remote server (http://123.207.74.28:8080).
  implication: When the webview panel has focus (user interacts with plugin UI), Photoshop's native shortcuts are routed to the webview instead of Photoshop. This is the UXP platform behavior for webview panels.

- timestamp: 2026-04-16
  checked: PromptReverseProvider.tsx - contextmenu event listener
  found: Global contextmenu listener on window (line 40) that calls e.preventDefault() on images with data-prompt-reverse attribute. This intercepts right-click on ALL images in the plugin.
  implication: Minimal impact - only prevents default on specific images.

- timestamp: 2026-04-16
  checked: manifest.json - requiredPermissions
  found: clipboard: "readAndWrite" permission requested. The plugin has full access to local filesystem and all network domains.
  implication: clipboard permission could theoretically interact with system clipboard operations.

## Resolution

root_cause: THREE primary root causes identified:

1. **UXP WebView Focus Stealing (SHORTCUTS/INPUT ISSUES)**: When the plugin's webview panel has keyboard focus, Photoshop's native shortcuts (Delete, Ctrl+Z, etc.) are captured by the webview instead of being forwarded to Photoshop. This is inherent to UXP's webview architecture with `uxpEnableMessageBridge="true"`. The webview does not forward unhandled keyboard events back to Photoshop. This explains: shortcut keys not working, inability to delete layers, and the need to reset shortcuts (users likely click elsewhere to return focus to PS).

2. **executeAsModal Blocking (INTERMITTENT SHORTCUT/INPUT FREEZE)**: Operations like `exportActiveLayerPng`, `importImageAsLayer`, `exportSelectionPng` all call `core.executeAsModal()` with `synchronousExecution: true`. While modal execution is active, Photoshop enters a modal state where ALL keyboard shortcuts and most UI interactions are blocked. For export operations, this includes: document duplication, layer visibility toggling, cropping, resizing, PNG saving, and base64 encoding. This modal state can last seconds to tens of seconds for large images. During this time, users experience shortcuts not working and the interface appearing frozen.

3. **Synchronous Main Thread Heavy Operations (LAG/SLOW UPLOADS)**: The binary-to-base64 conversion pattern used throughout main.js (String.fromCharCode.apply in 32KB chunks, then string concatenation) runs synchronously on the UXP main thread. For large images (export output, upload data, fetch responses), this creates temporary strings of potentially tens of megabytes, blocking the UI thread. The `fs.listDownloads` handler reads every file entirely to get sizes, which compounds over time. The `comfyui.fetch` handler does the same binary-to-base64 conversion for all image responses.

fix: (diagnosis only mode - no fix applied)
verification: (not applicable)
files_changed: []
