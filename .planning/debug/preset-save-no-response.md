---
status: resolved
trigger: "预设功能暂时无法用 - 集群模式下点击保存预设按钮(+)无反应，该功能从未实际验证过"
created: 2026-05-26
updated: 2026-05-26
---

## Symptoms

- **Expected behavior:** 点击 PresetToolbar 中的 `+` 按钮后，应将当前参数保存为预设到 LemonGrid 服务器
- **Actual behavior:** 点击按钮后没有任何可见的反馈（无成功提示、无错误提示）
- **Error messages:** 无（错误被 catch 后仅 console.error）
- **Timeline:** 该功能从未实际验证过（一直没用过）
- **Reproduction:** 在集群模式下打开 Draw 页面，点击预设工具栏的 `+` 按钮
- **Connection mode:** Cluster (LemonGrid)

## Code Context

### Key files:
- `code/webapp/src/components/preset/PresetToolbar.tsx` — UI 组件，`handleAddPreset` 处理保存逻辑
- `code/webapp/src/services/clusterPresetService.ts` — LemonGrid REST API 封装
- `code/webapp/src/services/preset.ts` — 本地 Bridge 通信封装（集群模式不使用）
- `code/webapp/src/stores/presetStore.ts` — Zustand store

### Call chain (cluster mode):
1. `PresetToolbar.handleAddPreset()` → `clusterPresetService.createPreset(workflowName, nextName, parameters)`
2. `clusterPresetService.createPreset()` → `ensureValidToken()` then `lemongridFetch(POST /api/v1/templates/{templateId}/presets)`
3. API endpoint: `POST {serverUrl}/api/v1/templates/{templateId}/presets` with body `{ template_id, name, parameters, scope }`

### Root cause candidates:
1. **LemonGrid API 未实现 presets 端点** — 服务器可能返回 404/500，错误被 catch 静默吞掉
2. **Token 认证失败** — `ensureValidToken()` 可能失败，导致请求未发出
3. **请求参数格式问题** — `parameters` 字段合并了 inputValues 和 imageFilenames，但服务端期望不同格式
4. **错误静默吞掉** — 所有 handler 用 try/catch 包裹但只 console.error，无 UI 反馈

### Initial evidence:
- `PresetToolbar.tsx:80-116` — handleAddPreset in cluster mode
- `clusterPresetService.ts:38-61` — createPreset calls POST to LemonGrid
- Error handling at line 113-115: `catch (error) { console.error('Failed to add preset:', error); }` — silent failure

## Current Focus

**hypothesis:** Two bugs found: (1) Silent error handling with no UI feedback, (2) `loadPresets` from presetStore calls local Bridge service instead of cluster service, causing preset list to be wiped after save.
**test:** Code review confirmed
**expecting:** Fix: add cluster-aware reload and user-visible error/success feedback
**next_action:** apply fix
**reasoning_checkpoint:** Root cause confirmed via code analysis.

## Evidence

- 2026-05-26: Read PresetToolbar.tsx, clusterPresetService.ts, presetStore.ts, preset.ts, lemongrid-auth.ts, lemongridStore.ts, lemongrid.ts
- Bug 1: `handleAddPreset` catch block (PresetToolbar.tsx:113-115) only does `console.error` — no UI toast/alert/dialog
- Bug 2: `handleAddPreset` line 88 calls `loadPresets(workflowName)` from presetStore which calls `presetService.listPresets` (Bridge/local service). In cluster mode without Bridge, `hasBridgeTransport()` returns false, so `listPresets` returns `[]`. This wipes the preset list after a successful save.
- Bug 2 also affects `handleDeletePreset` (line 191) and `handleRenameConfirm` (line 211) — same wrong `loadPresets` call in cluster mode.
- The initial useEffect (lines 46-61) correctly uses `clusterPresetService.listPresets` for loading, but none of the mutation handlers use it for reload.

## Eliminated

- LemonGrid API endpoint format — appears correct per service code
- Token auth — `ensureValidToken` works correctly, throws on failure but catch swallows it

## Resolution

**root_cause:** Two bugs: (1) Error handling in all preset mutation handlers (add/delete/rename) silently catches errors with only `console.error`, giving zero UI feedback. (2) After cluster-mode mutations, `loadPresets` from the presetStore calls the local Bridge service (`presetService.listPresets`) which returns empty in cluster mode, wiping the preset list. The initial useEffect correctly uses `clusterPresetService.listPresets` but the mutation handlers do not.

**fix:**
1. Add a `loadClusterPresets` function that wraps `clusterPresetService.listPresets` and updates the store (matching the pattern in the useEffect).
2. Replace all `loadPresets(workflowName)` calls in cluster-mode code paths with the new cluster-aware reload.
3. Add user-visible error feedback (toast/notification) in catch blocks for preset operations.
