---
phase: 08-lemongrid-preset-prompt-reverse
plan: 01
subsystem: api
tags: [lemongrid, rest, preset, prompt-reverse, vitest]

# Dependency graph
requires:
  - phase: 06-lemongrid-integration
    provides: lemongridFetch, ensureValidToken, LemonGridClient, useLemonGridStore
  - phase: 07-dingtalk-auth
    provides: ensureValidToken with DingTalk auth provider support
provides:
  - clusterPresetService.ts - LemonGrid preset CRUD via REST API
  - clusterPromptReverseService.ts - LemonGrid prompt reverse via asset_id and image upload
  - 16 passing unit tests across both services
affects: [08-lemongrid-preset-prompt-reverse, preset-ui, prompt-reverse-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [service-layer-switching-by-connectionMode, vi.hoisted-for-constructable-mocks]

key-files:
  created:
    - code/webapp/src/services/clusterPresetService.ts
    - code/webapp/src/services/clusterPromptReverseService.ts
    - code/webapp/src/services/__tests__/clusterPresetService.test.ts
    - code/webapp/src/services/__tests__/clusterPromptReverseService.test.ts
  modified: []

key-decisions:
  - "clusterPresetService uses lemongridFetch + ensureValidToken directly (not LemonGridClient internal methods)"
  - "uploadForReversePrompt creates LemonGridClient instance for asset upload, separate from reverse-prompt call"
  - "Used vi.hoisted for constructable class mocks in prompt reverse tests"

patterns-established:
  - "Cluster service pattern: import from lemongridStore + lemongrid-auth, no Bridge dependency"
  - "LemonGrid preset API path: /api/v1/templates/{templateId}/presets/*"
  - "LemonGrid reverse-prompt API path: POST /api/v1/assets/library/reverse-prompt with { asset_id }"

requirements-completed: [SC-1, SC-2, SC-3, SC-4]

# Metrics
duration: 5min
completed: 2026-05-20
---

# Phase 8 Plan 01: LemonGrid Cluster Preset and Prompt Reverse Services Summary

**Two cluster-mode service modules with 16 passing tests: preset CRUD via LemonGrid REST API and prompt reverse via asset upload + KIE Gemini endpoint**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-20T01:25:20Z
- **Completed:** 2026-05-20T01:29:51Z
- **Tasks:** 2
- **Files modified:** 4 (all new files)

## Accomplishments
- clusterPresetService.ts with full CRUD (listPresets, createPreset, updatePreset, deletePreset) against LemonGrid REST API
- clusterPromptReverseService.ts with reversePromptFromAsset (by asset_id) and uploadForReversePrompt (blob to temp asset)
- 16 passing unit tests (12 preset + 4 prompt reverse) with mocked lemongridFetch and LemonGridClient
- No modifications to any existing files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create clusterPresetService.ts with LemonGrid preset CRUD** - `77eae4f` (feat)
2. **Task 2: Create clusterPromptReverseService.ts with asset-based reverse prompt** - `ef123c4` (feat)

## Files Created/Modified
- `code/webapp/src/services/clusterPresetService.ts` - LemonGrid preset CRUD via REST (listPresets, createPreset, updatePreset, deletePreset + ClusterPresetMeta interface)
- `code/webapp/src/services/clusterPromptReverseService.ts` - LemonGrid prompt reverse (reversePromptFromAsset, uploadForReversePrompt + ClusterReversePromptResult/Analysis interfaces)
- `code/webapp/src/services/__tests__/clusterPresetService.test.ts` - 12 unit tests covering all CRUD operations, error handling, 409 conflict, 204 silent delete
- `code/webapp/src/services/__tests__/clusterPromptReverseService.test.ts` - 4 unit tests covering reverse prompt, error text, asset upload, fallback mime type

## Decisions Made
- Used lemongridFetch + ensureValidToken directly in clusterPresetService (avoids LemonGridClient.fetchJson which is private)
- uploadForReversePrompt creates a new LemonGridClient instance for asset upload, since LemonGridClient already handles UXP Bridge proxy and browser mode branching
- Used vi.hoisted() pattern for constructable mock classes in prompt reverse tests (standard Vitest approach for hoisted mock factories that need to be constructable)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- LemonGridClient mock in tests required constructable function (not arrow function). Resolved using vi.hoisted() to create a vi.fn() with a named function body that can be used with `new`. Initial attempts with inline class and arrow function mocks failed because vi.mock factories are hoisted above variable declarations.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both cluster services are ready for UI integration (Plan 02)
- PresetToolbar can branch on connectionMode to call clusterPresetService instead of preset.ts
- PromptReverseFlow can branch on connectionMode to call clusterPromptReverseService instead of dashscope.ts

## Self-Check: PASSED

All 5 files verified present. Both commit hashes (77eae4f, ef123c4) found in git log.

---
*Phase: 08-lemongrid-preset-prompt-reverse*
*Completed: 2026-05-20*
