---
phase: 09-lemongrid-task-queue
plan: 02
subsystem: ui
tags: [lemongrid, queue, badge, eta, polling, react]

requires:
  - phase: 09-lemongrid-task-queue
    plan: 01
    provides: LemonGridClient.getQueueSummary/getTaskETA, lemongridStore.queueSummary, etaMinutes field
provides:
  - Cluster queue badge in Draw.tsx preview section showing platform-wide queue counts and wait time
  - Queue summary polling useEffect at 15-second intervals in Cluster Mode
  - Per-task ETA display in MiniTaskList (collapsed header + expanded details)
  - Per-task ETA polling useEffect at 30-second intervals for QUEUED tasks
affects: []

tech-stack:
  added: []
  patterns: [reuse existing queue-status-badge CSS for cluster badge, sequential ETA fetch for queued tasks]

key-files:
  created: []
  modified:
    - code/webapp/src/pages/Draw.tsx
    - code/webapp/src/pages/Draw.css
    - code/webapp/src/components/MiniTaskList.tsx
    - code/webapp/src/components/MiniTaskList.css

key-decisions:
  - "Cluster queue badge uses '平台:' prefix to distinguish platform-wide counts from user's own tasks (per RESEARCH Pitfall 3)"
  - "ETA polling only runs for QUEUED tasks to avoid 404 errors on non-queued tasks (per RESEARCH Pitfall 1)"
  - "Green color (#48bb78) for ETA text distinguishes estimated wait from yellow (#ecc94b) queue position"
  - "Draw.tsx commit includes pre-existing improvements (hidden field skip, image asset ID handling) that were in working tree"

requirements-completed: [Q-01, Q-02, Q-03]

duration: 2min
completed: 2026-05-20
---

# Phase 9 Plan 2: Queue UI Badge and Per-Task ETA Display Summary

**Added cluster queue badge with 15-second polling in Draw.tsx preview section and per-task ETA display with 30-second polling in MiniTaskList**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-20T03:21:11Z
- **Completed:** 2026-05-20T03:24:56Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Cluster queue badge displays platform-wide queue status ("平台: X 运行中 · Y 排队中 · ~Z分钟") in preview section header
- Queue summary polls every 15 seconds via getQueueSummary() when in Cluster Mode and authenticated
- MiniTaskList shows per-task ETA in minutes for QUEUED tasks in both collapsed and expanded views
- Per-task ETA polls every 30 seconds for QUEUED tasks only, silently catching 404 errors
- Direct Mode queue badge remains completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cluster queue badge to Draw.tsx preview section with queue summary polling** - `ab4498f` (feat)
2. **Task 2: Add per-task ETA display to MiniTaskList with ETA polling** - `0881cec` (feat)

## Files Created/Modified
- `code/webapp/src/pages/Draw.tsx` - Added TaskQueueSummary import, queueSummary selector, 15-second queue summary polling useEffect, cluster queue badge JSX
- `code/webapp/src/pages/Draw.css` - Pre-existing change (position: relative on .multi-image-add) included in commit; no new CSS rules needed for cluster badge (reuses existing queue-status-badge pattern)
- `code/webapp/src/components/MiniTaskList.tsx` - Added useEffect import, 30-second ETA polling useEffect, ETA display in collapsed header and expanded details
- `code/webapp/src/components/MiniTaskList.css` - Added .eta-text and .eta-detail styles with green color (#48bb78)

## Decisions Made
- Used "平台:" prefix on cluster queue badge text to clearly distinguish platform-wide queue counts from user's own task list (addresses RESEARCH Pitfall 3)
- Only fetch ETA for QUEUED tasks -- RUNNING/COMPLETED tasks return 404 since they are no longer in Redis ZSET (addresses RESEARCH Pitfall 1)
- Green ETA text (#48bb78) vs yellow queue position (#ecc94b) provides visual differentiation between "estimated wait time" and "position in queue"
- No CSS changes needed for cluster badge -- reuses existing .queue-status-badge pattern from Draw.css

## Deviations from Plan

### Note: Pre-existing Working Tree Changes

The Task 1 commit for Draw.tsx included pre-existing uncommitted changes that were in the working tree before this phase started:
- Hidden field skipping in template parameter building (lines ~3055-3075)
- Image field asset ID handling with array unwrapping for LemonGrid backend compatibility

These changes were not part of Plan 09-02 but were present in the modified Draw.tsx file and could not be separated from the plan's changes without interactive staging (which is not supported).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 09 is now complete with both plans done
- Queue status is visible to users in Cluster Mode with platform-wide badge and per-task ETAs
- All polling properly stops when not in Cluster Mode or not connected

---
*Phase: 09-lemongrid-task-queue*
*Completed: 2026-05-20*

## Self-Check: PASSED

- FOUND: code/webapp/src/pages/Draw.tsx
- FOUND: code/webapp/src/pages/Draw.css
- FOUND: code/webapp/src/components/MiniTaskList.tsx
- FOUND: code/webapp/src/components/MiniTaskList.css
- FOUND: .planning/phases/09-lemongrid-task-queue/09-02-SUMMARY.md
- FOUND: commit ab4498f
- FOUND: commit 0881cec
