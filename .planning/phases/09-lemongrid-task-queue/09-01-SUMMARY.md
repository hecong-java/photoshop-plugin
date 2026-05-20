---
phase: 09-lemongrid-task-queue
plan: 01
subsystem: api
tags: [lemongrid, queue, eta, zustand]

requires:
  - phase: 06-lemongrid-integration
    provides: LemonGridClient class with fetchJson pattern, lemongridStore with task tracking
provides:
  - TaskQueueSummary and TaskETAResponse interfaces exported from lemongrid.ts
  - LemonGridClient.getQueueSummary() method for platform-wide queue status
  - LemonGridClient.getTaskETA(taskId) method for per-task ETA estimates
  - queueSummary transient state in lemongridStore
  - etaMinutes field on LemonGridTaskState for per-task ETA display
affects: [09-02-PLAN.md]

tech-stack:
  added: []
  patterns: [fetchJson generic pattern reused for queue endpoints, transient store fields via partialize exclusion]

key-files:
  created: []
  modified:
    - code/webapp/src/services/lemongrid.ts
    - code/webapp/src/stores/lemongridStore.ts

key-decisions:
  - "getTaskETA only called for QUEUED tasks -- returns 404 for tasks not in Redis ZSET (per research pitfall 1)"
  - "queueSummary is transient state not persisted to localStorage via partialize exclusion"
  - "etaMinutes stored as minutes (integer) rather than raw seconds for direct UI consumption"

patterns-established:
  - "Queue API pattern: fetchJson generic with backend-verified endpoint paths"
  - "Transient store field pattern: add to interface and defaults, exclude from partialize"

requirements-completed: [Q-01, Q-02, Q-03]

duration: 3min
completed: 2026-05-20
---

# Phase 9 Plan 1: Queue API Types, Methods, and Store State Summary

**Added TaskQueueSummary/TaskETAResponse types, getQueueSummary/getTaskETA API methods, and queueSummary transient state with per-task etaMinutes field**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-20T03:14:11Z
- **Completed:** 2026-05-20T03:17:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- LemonGridClient extended with two new API methods following existing fetchJson pattern
- TaskQueueSummary and TaskETAResponse interfaces exported for queue data modeling
- lemongridStore extended with transient queueSummary state and setQueueSummary action
- LemonGridTaskState extended with etaMinutes field for per-task ETA display in UI

## Task Commits

Each task was committed atomically:

1. **Task 1: Add queue API types and methods to LemonGridClient** - `07958f1` (feat)
2. **Task 2: Add queueSummary state to lemongridStore and etaMinutes to LemonGridTaskState** - `7313d0b` (feat)

## Files Created/Modified
- `code/webapp/src/services/lemongrid.ts` - Added TaskQueueSummary and TaskETAResponse interfaces, getQueueSummary() and getTaskETA() methods
- `code/webapp/src/stores/lemongridStore.ts` - Added queueSummary transient state, setQueueSummary action, etaMinutes field on LemonGridTaskState

## Decisions Made
- Used fetchJson generic pattern for both new API methods -- consistent with existing getTaskStatus/getTaskHistory
- queueSummary is transient (not in partialize) -- queue data is stale on reload, no value in persisting
- etaMinutes stored as integer minutes rather than float seconds -- UI displays whole minutes, avoids repeated conversion
- getTaskETA documented as QUEUED-only in JSDoc -- prevents 404 errors from calling on non-queued tasks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Data layer complete: API methods, types, and store state ready for Plan 09-02
- Plan 09-02 will add: cluster queue badge UI, per-task ETA display in MiniTaskList, polling useEffect in Draw.tsx

---
*Phase: 09-lemongrid-task-queue*
*Completed: 2026-05-20*

## Self-Check: PASSED

- FOUND: code/webapp/src/services/lemongrid.ts
- FOUND: code/webapp/src/stores/lemongridStore.ts
- FOUND: .planning/phases/09-lemongrid-task-queue/09-01-SUMMARY.md
- FOUND: commit 07958f1
- FOUND: commit 7313d0b
