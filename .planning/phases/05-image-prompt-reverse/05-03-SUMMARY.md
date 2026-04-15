---
phase: 05-image-prompt-reverse
plan: 03
subsystem: ui
tags: [zustand, react, context-menu, state-machine, tdd, vitest]

# Dependency graph
requires:
  - phase: 05-01
    provides: dashscope.ts service with imageElementToBase64, PROMPT_TEMPLATES, PromptTemplate type
provides:
  - promptReverseStore with FlowStep state machine and abort handling
  - ContextMenu component with viewport-clamped positioning
  - PromptReverseProvider with global right-click listener on img[data-prompt-reverse]
affects: [05-04, draw-page, history-page]

# Tech tracking
tech-stack:
  added: []
  patterns: [zustand-store-state-machine, global-context-menu-provider, data-attribute-image-targeting]

key-files:
  created:
    - code/webapp/src/stores/promptReverseStore.ts
    - code/webapp/src/stores/__tests__/promptReverseStore.test.ts
    - code/webapp/src/components/promptReverse/ContextMenu.tsx
    - code/webapp/src/components/promptReverse/ContextMenu.css
    - code/webapp/src/components/promptReverse/PromptReverseProvider.tsx
  modified: []

key-decisions:
  - "startFlow resets all state to INITIAL_STATE before setting new values, preventing stale data from previous flows"
  - "abortController stored in Zustand store for access across state machine transitions"
  - "ContextMenu uses fixed overlay + stopPropagation pattern for reliable dismiss behavior"

patterns-established:
  - "FlowStep state machine pattern: closed -> preview -> template -> loading -> result with abort-on-new-flow"
  - "Global provider pattern: PromptReverseProvider wraps children + renders ContextMenu overlay"
  - "Data-attribute targeting: img[data-prompt-reverse] enables opt-in context menu on any image"

requirements-completed: [D-01, D-02, D-03, D-11, D-12]

# Metrics
duration: 5min
completed: 2026-04-15
---

# Phase 5 Plan 03: Context Menu & Store Summary

**Zustand state machine for prompt reverse flow with global right-click context menu targeting img[data-prompt-reverse] elements**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-15T08:20:49Z
- **Completed:** 2026-04-15T08:26:15Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Zustand store with full FlowStep state machine (closed/preview/template/loading/result) and 10 passing tests
- Global ContextMenu component with cursor positioning, viewport clamping, and multi-modal dismiss (click-outside, Escape, scroll, resize)
- PromptReverseProvider that detects right-click on img[data-prompt-reverse] elements, extracts images to base64 via imageElementToBase64, and starts the flow

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing tests for promptReverseStore** - `835a9ab` (test)
2. **Task 1 GREEN: Implement promptReverseStore state machine** - `918d93b` (feat)
3. **Task 2: Create ContextMenu, CSS, and PromptReverseProvider** - `d463322` (feat)

_Note: Task 1 was TDD with RED and GREEN commits; no refactor needed._

## Files Created/Modified
- `code/webapp/src/stores/promptReverseStore.ts` - Zustand store with FlowStep state machine, abort handling, template lookup
- `code/webapp/src/stores/__tests__/promptReverseStore.test.ts` - 10 tests covering all state transitions and edge cases
- `code/webapp/src/components/promptReverse/ContextMenu.tsx` - Right-click context menu with "反推提示词" action
- `code/webapp/src/components/promptReverse/ContextMenu.css` - Menu styling with z-index 1500, dark theme, hover effects
- `code/webapp/src/components/promptReverse/PromptReverseProvider.tsx` - Global provider with contextmenu listener and image extraction

## Decisions Made
- startFlow resets all state to INITIAL_STATE before setting new values, preventing stale data from previous flows
- abortController stored in Zustand store for access across state machine transitions
- ContextMenu uses fixed overlay + stopPropagation pattern for reliable dismiss behavior

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Store and context menu are ready for Plan 04 (PromptReverseFlow modal integration into App.tsx)
- Provider needs to be mounted in App.tsx main content area (Plan 04 scope)
- img elements need data-prompt-reverse attribute added in Draw.tsx and History.tsx (Plan 04 scope)

## Self-Check: PASSED

- All 5 created files verified on disk
- All 3 commits verified in git log (835a9ab, 918d93b, d463322)

---
*Phase: 05-image-prompt-reverse*
*Completed: 2026-04-15*
