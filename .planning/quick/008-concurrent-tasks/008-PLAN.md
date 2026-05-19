# Plan 008: Enable Concurrent Task Submission in Cluster Mode

**Created:** 2026-04-29
**Scope:** Cluster Mode (LemonGrid) only — Direct Mode unchanged
**Related:** D-39 (Support concurrent tasks)

---

## Problem

The UI uses a single `isGenerating` boolean lock that blocks all task submission while any task is running. This prevents users from submitting multiple tasks to LemonGrid, even though the backend supports it (per D-39) and the task store already tracks multiple tasks.

**Root causes:**
1. `isGenerating` (line 309) — single boolean, set `true` in `handleClusterSubmit`, blocks Generate button
2. `progress` (line 301) — single state object, only tracks ONE task's progress at a time
3. `setIsGenerating(false)` called when ANY task completes — would prematurely unlock if multiple tasks running
4. Generate button disabled when `isGenerating === true` (line 4418)

**Key insight:** The cluster task tracking is ALREADY per-task in `lemongridStore.tasks`. The `isGenerating` and `progress` states are Direct Mode legacy. Cluster Mode should use the store exclusively.

---

## Changes

### T1: Remove `isGenerating` dependency from Cluster Mode submission

**File:** `code/webapp/src/pages/Draw.tsx`

In `handleClusterSubmit()` (line 2807):
- Remove `setIsGenerating(true)` (line 2810)
- Remove `setProgress(...)` call (lines 2811-2818) — progress is per-task in store
- In error catch blocks:
  - Remove `setIsGenerating(false)` (lines 2869, 2889)
  - Show error via toast/notification instead of progress state

### T2: Remove `setIsGenerating(false)` from cluster completion handlers

**File:** `code/webapp/src/pages/Draw.tsx`

Remove `setIsGenerating(false)` from these cluster-only code paths:
- WS `task_failed` handler (line 549)
- Polling terminal state handler (line 2979)
- Polling auth error (line 2985)
- `handleTaskCompletion` early return (line 3023)
- `handleTaskCompletion` success (line 3045)
- Retry error handler (line 3084)

**Important:** Do NOT touch `setIsGenerating(false)` in Direct Mode code paths (line 3439 and others in the ComfyUI WebSocket flow).

### T3: Update Generate button to allow concurrent submission in Cluster Mode

**File:** `code/webapp/src/pages/Draw.tsx`

In the Generate button (line 4413):
- `disabled` prop: In Cluster Mode, remove `isGenerating` check. Keep `!selectedTemplate || !isLemonGridConnected`
- Button text: In Cluster Mode, show running count when tasks are active (e.g., "生成中 (2)...") instead of locking
- In Direct Mode: keep current behavior (`isGenerating` still blocks)

```tsx
// Before
disabled={
  connectionMode === 'cluster'
    ? !selectedTemplate || isGenerating || !isLemonGridConnected
    : !selectedWorkflow || isGenerating || !comfyUISettings.isConnected
}

// After
disabled={
  connectionMode === 'cluster'
    ? !selectedTemplate || !isLemonGridConnected
    : !selectedWorkflow || isGenerating || !comfyUISettings.isConnected
}
```

### T4: Update "生成中" badge to show task count summary

**File:** `code/webapp/src/pages/Draw.tsx`

At line 3820, replace the single `isGenerating` badge with a cluster-aware count:

```tsx
// For Cluster Mode, derive from store:
const clusterTasks = useLemonGridStore(s => s.tasks);
const activeClusterCount = Object.values(clusterTasks).filter(
  t => ['PENDING', 'QUEUED', 'SYNCING', 'RUNNING'].includes(t.status)
).length;

// Badge:
{connectionMode === 'cluster' && activeClusterCount > 0 && (
  <span className="generating-badge">{activeClusterCount} 任务处理中</span>
)}
{connectionMode !== 'cluster' && isGenerating && (
  <span className="generating-badge">生成中...</span>
)}
```

### T5: Handle concurrent limit (429) gracefully

**File:** `code/webapp/src/pages/Draw.tsx`

In `handleClusterSubmit()` catch block (lines 2873-2888):
- Keep the concurrent limit error detection
- Change behavior: show a toast/notification instead of setting progress error state
- User can dismiss and try again later — UI stays interactive

---

## Verification

1. Submit a cluster task → button remains enabled
2. Submit a second task while first is running → both appear in MiniTaskList
3. Complete one task → other tasks continue tracking normally
4. Complete all tasks → button still enabled
5. Hit concurrent limit (429) → see error message, button still enabled
6. Direct Mode: behavior completely unchanged (isGenerating still works)
7. Retry a failed task while another task is running → retry works
8. Cancel a running task while others are running → only cancelled task affected

## Files Modified

- `code/webapp/src/pages/Draw.tsx` — all changes

## Risk Assessment

- **Low risk:** Cluster Mode already tracks per-task state. This change removes a UI restriction, not adds new logic.
- **Direct Mode:** Completely unchanged. `isGenerating` still controls Direct Mode.
- **Edge case:** Multiple tasks completing simultaneously — each has its own WS/polling loop and idempotency guard (`completingTaskIds` ref).
