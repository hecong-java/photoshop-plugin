---
phase: 09-lemongrid-task-queue
reviewed: 2026-05-20T12:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - code/webapp/src/services/lemongrid.ts
  - code/webapp/src/stores/lemongridStore.ts
  - code/webapp/src/pages/Draw.tsx
  - code/webapp/src/pages/Draw.css
  - code/webapp/src/components/MiniTaskList.tsx
  - code/webapp/src/components/MiniTaskList.css
findings:
  critical: 2
  warning: 8
  info: 5
  total: 15
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-05-20T12:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed 6 source files implementing the LemonGrid task queue integration: the API client service, Zustand store, Draw page (large file with cluster mode additions), MiniTaskList component, and two CSS files. The implementation follows established patterns from the existing ComfyUI integration. Two critical bugs were found: an undefined variable reference that will throw a runtime error, and a missing guard that allows API calls with an empty server URL. Several warnings address missing error handling, potential memory leaks, and defensive coding improvements.

## Critical Issues

### CR-01: Undefined variable `diagStep` causes runtime ReferenceError

**File:** `code/webapp/src/pages/Draw.tsx:1379`
**Issue:** Line 1379 references `diagStep` in a template literal, but `diagStep` is never declared anywhere in the file or its imports. When a workflow's response data lacks a `nodes` field, this line will throw a `ReferenceError: diagStep is not defined`, crashing the workflow loading flow. This appears to be a leftover from a diagnostic refactoring where a variable like `const diagStep = 'Step X'` was removed but the reference was missed.
**Fix:**
```typescript
// Line 1379: Replace the diagnostic placeholder with a static label
setWorkflowError(`读取工作流失败: 返回数据缺少 nodes 字段, keys=${keys}`);
```

### CR-02: `LemonGridClient` constructed with empty serverUrl in multiple call sites

**File:** `code/webapp/src/components/MiniTaskList.tsx:133-134`
**File:** `code/webapp/src/pages/Draw.tsx:3182`
**Issue:** Both `MiniTaskList.handleCancel` and `Draw.startPollingForTask` create a `new LemonGridClient({ serverUrl })` without checking whether `serverUrl` is empty or null. The `LemonGridClient` constructor strips trailing slashes but does not validate against empty strings. This results in API calls to relative paths (e.g., `/api/v1/tasks/xxx`) which will resolve against the current page origin rather than the intended LemonGrid server, causing silent failures or errors against the wrong host.
**Fix:**
```typescript
// MiniTaskList.tsx handleCancel (line 131-140)
const handleCancel = async (taskId: string) => {
  try {
    const serverUrl = useLemonGridStore.getState().serverUrl;
    if (!serverUrl) return; // Guard against empty server URL
    const client = new LemonGridClient({ serverUrl });
    await client.cancelTask(taskId);
    useLemonGridStore.getState().updateTask(taskId, { status: 'CANCELLED' });
  } catch (e) {
    console.error('[MiniTaskList] Cancel failed:', e);
  }
};

// Draw.tsx startPollingForTask (line 3182) -- add same guard
const serverUrl = useLemonGridStore.getState().serverUrl;
if (!serverUrl) return; // Guard against empty server URL
```

## Warnings

### WR-01: No cleanup for polling timers in `startPollingForTask`

**File:** `code/webapp/src/pages/Draw.tsx:3177-3220`
**Issue:** The `startPollingForTask` function uses recursive `setTimeout` for polling but provides no mechanism to cancel it. If the component unmounts or the task is completed via WebSocket while polling is still active, the polling continues indefinitely until a terminal state is reached or an auth error occurs. This wastes network resources and can cause state updates on unmounted components.
**Fix:** Return a cleanup function or use a ref-based cancellation token:
```typescript
const startPollingForTask = (taskId: string) => {
  let cancelled = false;
  const poll = async () => {
    if (cancelled) return;
    // ... existing poll logic ...
    if (!cancelled) setTimeout(poll, interval);
  };
  poll();
  return () => { cancelled = true; };
};
```

### WR-02: Blob URL memory leak in `handleTaskCompletion`

**File:** `code/webapp/src/pages/Draw.tsx:3256-3267`
**Issue:** `handleTaskCompletion` creates blob URLs via `URL.createObjectURL(blob)` on lines 3261 and 3267 for each downloaded asset but never calls `URL.revokeObjectURL()` for them. Each blob URL holds a reference to the Blob in memory. Over time with many completed tasks, this accumulates leaked blob URLs. The `addClusterOutputImage` store call also stores the URL without a cleanup path.
**Fix:** Either revoke after use (if transient) or implement a cleanup mechanism in the store when tasks are removed:
```typescript
// In removeTask or clearClusterOutputImages, revoke stored blob URLs
clearClusterOutputImages: () => set((state) => {
  state.clusterOutputImages.forEach(img => {
    if (img.url.startsWith('blob:')) URL.revokeObjectURL(img.url);
  });
  return { clusterOutputImages: [] };
}),
```

### WR-03: `completingTaskIds` ref grows unboundedly

**File:** `code/webapp/src/pages/Draw.tsx:3223-3227`
**Issue:** `completingTaskIds` is a `Set<string>` that only has entries added (line 3227) but never removed. Over time, as tasks complete, this set grows without bound. While the idempotency guard is correct, the set should be pruned when tasks are removed from the store, or it should be cleared periodically.
**Fix:** Clear entries when tasks are removed, or use a Map with timestamps for periodic cleanup:
```typescript
// After successfully handling completion, consider removing the taskId:
// completingTaskIds.current.delete(taskId); // after download completes
```

### WR-04: `handleRetryTask` sets `isGenerating` but never resets it on failure

**File:** `code/webapp/src/pages/Draw.tsx:3285-3313`
**Issue:** Line 3285 sets `setIsGenerating(true)` but the `catch` block on line 3311 only logs the error. There is no `finally` block to reset `isGenerating` to `false`. If `client.submitTask` throws, the UI remains stuck in a "generating" state, blocking future direct-mode generations.
**Fix:**
```typescript
const handleRetryTask = async (taskId: string) => {
  // ...
  setIsGenerating(true);
  try {
    // ... submit logic ...
  } catch (error) {
    console.error('[Draw] Retry failed:', error);
  } finally {
    setIsGenerating(false);
  }
};
```

### WR-05: `handleRetryTask` uses hardcoded version `1` instead of original task version

**File:** `code/webapp/src/pages/Draw.tsx:3289`
**Issue:** The retry call passes `1` as the template version: `client.submitTask(task.templateId, task.params, 1, ...)`. The original task's version is not stored in `LemonGridTaskState`, so if the template has been updated to version 2+, the retry will submit against the wrong version, potentially causing API errors or mismatched behavior.
**Fix:** Either store `templateVersion` in `LemonGridTaskState` or fetch the current template version before retrying.

### WR-06: Duplicate `LemonGridClient` instantiation per ETA poll cycle

**File:** `code/webapp/src/components/MiniTaskList.tsx:91-97`
**Issue:** The ETA polling effect creates a new `LemonGridClient` instance on every 30-second interval for every queued task. While not a correctness bug, it creates unnecessary object allocations. A single client instance could be created once outside the polling loop.
**Fix:** Create the client once before the `for` loop:
```typescript
const fetchETAs = async () => {
  const serverUrl = useLemonGridStore.getState().serverUrl;
  if (!serverUrl) return;
  const client = new LemonGridClient({ serverUrl });
  for (const task of queuedTasks) {
    // ... use client ...
  }
};
```

### WR-07: `normalizeParamSchema` always logs to console

**File:** `code/webapp/src/services/lemongrid.ts:227`
**Issue:** Line 227 unconditionally logs `'[LemonGrid] normalizeParamSchema: X total, Y hidden'` via `console.log`. This fires on every template detail load and will pollute the console in production.
**Fix:** Remove the log or change to a debug-level mechanism:
```typescript
function normalizeParamSchema(rawSchema: RawParamSchemaField[]): ParamSchemaField[] {
  if (!Array.isArray(rawSchema)) return [];
  return rawSchema.map(normalizeParamField);
}
```

### WR-08: Zustand persist stores `encryptedPassword` in localStorage

**File:** `code/webapp/src/stores/lemongridStore.ts:222`
**Issue:** The `partialize` function persists `encryptedPassword` to localStorage under the key `'Ningleai-lemongrid'`. Even though it is described as "encrypted," storing any form of password in localStorage is a security risk: localStorage is accessible to any JavaScript running on the same origin (including XSS attacks or malicious browser extensions). If the encryption key is also client-side, this provides only obfuscation.
**Fix:** Consider using sessionStorage (cleared on tab close) or the Web Crypto API with a non-extractable key, or avoid persisting the password entirely and require re-entry.

## Info

### IN-01: Excessive diagnostic `console.log` statements in Draw.tsx

**File:** `code/webapp/src/pages/Draw.tsx` (lines 410, 592-598, 700-703, 717, 728, 770, 937-963, 1128-1135, 1172-1183, 1308, 1326-1327, 3489-3510, etc.)
**Issue:** Draw.tsx contains dozens of `console.log` diagnostic statements with detailed state dumps, character code arrays, and step-by-step tracing. These were useful during development but add noise in production.
**Fix:** Remove or convert to debug-level logging gated behind a flag:
```typescript
const DEBUG = process.env.NODE_ENV === 'development';
if (DEBUG) console.log(...);
```

### IN-02: `console.warn` in production code paths in lemongrid.ts

**File:** `code/webapp/src/services/lemongrid.ts:246, 358, 371, 532`
**Issue:** Multiple `console.warn` calls exist in normal error handling paths (missing param_schema, unexpected API response, getTemplateDetail fallback). These will appear in production consoles for expected edge cases.
**Fix:** Consider removing warnings for expected fallback paths (like missing param_schema which is handled gracefully) or downgrading to silent handling.

### IN-03: `LEMONGRID_ERROR_SUGGESTIONS` lookup may use wrong key

**File:** `code/webapp/src/components/MiniTaskList.tsx:257`
**Issue:** The error suggestion lookup uses `task.errorCode || ''` which falls back to looking up `LEMONGRID_ERROR_SUGGESTIONS['']`. This key does not exist in the map, so it will always fall through to the `'请重试'` default when `errorCode` is null/empty. This is not a bug but is slightly misleading -- the fallback string `'请重试'` is correct but the empty-string lookup is unnecessary.
**Fix:** Use nullish coalescing:
```typescript
{LEMONGRID_ERROR_SUGGESTIONS[task.errorCode ?? ''] || '请重试'}
```

### IN-04: `seedModes` state is shared between direct and cluster modes

**File:** `code/webapp/src/pages/Draw.tsx:258`
**Issue:** A single `seedModes` state object is shared across both direct mode (ComfyUI workflow inputs) and cluster mode (template param_schema inputs). Since field names between modes are unlikely to collide, this works in practice, but it means seed mode selections from one mode leak into the other mode's state.
**Fix:** This is a minor quality issue. Consider clearing `seedModes` when switching `connectionMode`.

### IN-05: Duplicate text rendering branch in cluster mode

**File:** `code/webapp/src/pages/Draw.tsx:2071-2086`
**Issue:** In the direct mode input parsing, there is a branch `type: isLongText ? 'text' : 'text'` which always evaluates to `'text'`. The ternary is dead code.
**Fix:**
```typescript
inputs.push({
  name: generatedName,
  type: 'text',
  label: resolveInputLabel(inputName, inputRecord.label),
  default: inputDefaultRaw,
});
```

---

_Reviewed: 2026-05-20T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
