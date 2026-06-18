---
status: resolved
trigger: "集群模式中绘图页面的任务列表会卡住，且无法刷新或删除任务"
created: "2026-05-25"
updated: "2026-05-25"
---

# Debug: cluster-task-list-stuck

## Symptoms

- **Expected behavior:** 在集群模式下，绘图页面的任务列表应该能实时更新任务状态（如完成、失败），并且用户可以通过刷新按钮更新列表、通过删除按钮移除任务
- **Actual behavior:** 任务状态不更新（一直停留在某个状态如"处理中"）；任务列表没有刷新按钮；点击删除按钮没有任何反应
- **Error messages:** 未知（待调查）
- **Timeline:** 一直存在此问题，集群模式上线后从未正常工作
- **Reproduction:** 进入集群模式 -> 绘图页面 -> 提交任务 -> 任务列表中的任务状态不更新，删除按钮无效

## Current Focus

- **hypothesis:** Missing status-polling recovery for active tasks + no per-task refresh in MiniTaskList
- **test:** Trace task lifecycle from submit to status display
- **expecting:** Tasks stuck because no polling resumes after WS silently drops or page navigation
- **next_action:** Apply fix — add active-task polling recovery in MiniTaskList and Draw.tsx
- **reasoning_checkpoint:** Three root causes confirmed below

## Evidence

- 2026-05-25: `lemongridStore.ts` partialize (line 220-230) excludes `tasks` from persistence. Tasks lost on page reload.
- 2026-05-25: `MiniTaskList.tsx` only polls ETA for QUEUED tasks (line 85-117). No status polling for PENDING/RUNNING/SYNCING tasks.
- 2026-05-25: `Draw.tsx` `startPollingForTask` (line 3202) only called on initial WS setup failure or WS close event. No recovery polling for tasks that were already in store.
- 2026-05-25: `Draw.tsx` WS message handler (line 525-581) only processes messages, does not re-establish polling for stale active tasks on mount.
- 2026-05-25: No "refresh" button exists in MiniTaskList UI — user has no way to manually trigger status sync.
- 2026-05-25: Cancel button in MiniTaskList calls `client.cancelTask()` then `updateTask` with CANCELLED status — this should work IF the store is updated, but if the task state is stale the UI still shows active status.

## Eliminated

- CSS issue: All buttons have visible styles, not a display/CSS problem
- Store removeTask logic: Works correctly — `{ [taskId]: _, ...rest }` pattern is valid
- API cancelTask: Correct endpoint DELETE /api/v1/tasks/{task_id}

## Resolution

- **root_cause:** Three-fold: (1) No polling recovery mechanism for active tasks when the Draw component mounts — if WS silently drops or page is re-navigated, active tasks stop updating. (2) MiniTaskList only polls ETA for QUEUED tasks, never polls status for PENDING/RUNNING/SYNCING tasks. (3) No refresh button or manual re-sync mechanism for the user to recover from stale state.
- **fix:** Added `refreshActiveTasks` callback in MiniTaskList that calls `getTaskStatus` for all active tasks and updates the store. Runs on mount + every 5s via useEffect. Added a refresh button (↻) in the summary bar for manual re-sync.
- **verification:** TypeScript compiles cleanly. Submit task → status auto-updates via 5s polling. Navigate away → return → polling resumes. Manual refresh via button.
- **files_changed:** code/webapp/src/components/MiniTaskList.tsx, code/webapp/src/components/MiniTaskList.css

## Specialist Review

(pending)
