---
phase: quick-004
plan: 01
subsystem: workflow-compilation
tags: [debug-logging, random-seed, comfyui, workflow, rerun-fix]
dependency_graph:
  requires: []
  provides: [workflow-debug-visibility, random-seed-generation, rerun-edit-fix]
  affects: [Draw.tsx, comfyui.ts, historyStore.ts]
tech_stack:
  added: []
  patterns: [console-logging, random-number-generation, extra-data-metadata]
key_files:
  created: []
  modified:
    - path: code/webapp/src/pages/Draw.tsx
      changes:
        - Added workflow JSON debug logging in handleGenerate
        - Added random seed generation for RandomNoise nodes
        - Added debug logging for rerun/edit workflow matching
        - Added extra_data with workflow_name to prompt submission
    - path: code/webapp/src/services/comfyui.ts
      changes:
        - Added extra_data field to ComfyUIHistoryEntry interface
    - path: code/webapp/src/stores/historyStore.ts
      changes:
        - Extract workflow_name from extra_data in convertEntryToItem
decisions: []
metrics:
  duration: 10m
  completed_date: 2026-03-12
  tasks_completed: 3
  files_modified: 3
---

# Phase quick-004 Plan 01: Workflow Random Seed Summary

## One-liner

Added debug logging for workflow JSON visibility, implemented automatic random seed generation, and fixed rerun/edit functionality by saving workflow name in prompt metadata.

## What Was Done

### Task 1: Add workflow JSON debug logging

Added console logging in the `handleGenerate` function to provide visibility into:
- The raw workflow JSON loaded from ComfyUI (`workflowData`)
- The final compiled prompt (`finalPrompt`) being sent to ComfyUI

Users can now open browser console (F12) and see exactly what data is being sent to ComfyUI.

### Task 2: Implement random seed generation for RandomNoise nodes

Added logic in `compileWorkflowToPrompt` to detect and handle random seed generation:
- Checks if a widget name contains "seed" (case-insensitive)
- Checks if the next widget value is "randomize" mode
- Generates a new random seed (0 to 10^15) for each generation
- Logs the generated random seed to console

### Task 3: Fix rerun/edit functionality

Added extensive debug logging to diagnose why rerun/edit wasn't working:
- Log history item details (workflowName, params, shouldAutoGenerate)
- Log workflow matching process (available workflows, expected node types, scores)
- Log input value extraction process (promptData keys, targetInputs, matching results)

Fixed the root cause:
- Added `extra_data` field with `workflow_name` when submitting prompt to ComfyUI
- Modified `ComfyUIHistoryEntry` interface to include `extra_data`
- Modified `convertEntryToItem` to extract `workflow_name` from `extra_data`

## Deviations from Plan

Added Task 3 to fix rerun/edit functionality - this was discovered as part of the same user request.

## Verification

1. Open browser console (F12) in the webapp
2. Select a workflow with RandomNoise node (e.g., "GuangYiZhongHui")
3. Click generate
4. Verify console shows:
   - "[Draw] Workflow data loaded:" with the workflow JSON
   - "[Draw] Final prompt sent to ComfyUI:" with the compiled prompt
   - "[Draw] Generated random seed for node X.noise_seed:" with a random number
5. Run generation again and verify the seed value changes
6. Go to History page, click "重新运行" or "重新编辑"
7. Verify console shows detailed matching logs and correct workflow is selected
8. **Note:** For existing history entries (before this fix), workflow matching will rely on node types. New generations will have correct workflow names saved.

## Commits

| Commit | Message |
|--------|---------|
| 1959390 | feat(quick-4): add debug logging for workflow JSON and final prompt |
| 1aa8047 | feat(quick-4): implement random seed generation for RandomNoise nodes |
| 7c9eeef | fix(quick-4): add debug logging and save workflow name for rerun/edit |
| 48b4a12 | fix(quick-4): use ref for selectedWorkflow to avoid stale closure |
| 77bf177 | fix(quick-4): restore image previews for rerun/edit history actions |
| 19e8379 | fix(quick-4): improve workflow name matching score for rerun/edit |

## Files Modified

- `code/webapp/src/pages/Draw.tsx`
  - Added console logging at line ~2200 (handleGenerate function)
  - Added random seed generation logic at lines 1811-1823 (compileWorkflowToPrompt function)
  - Added debug logging for rerun/edit in findBestMatchingWorkflow and extractInputValuesFromHistoryParams
  - Added extra_data to prompt submission
- `code/webapp/src/services/comfyui.ts`
  - Added extra_data field to ComfyUIHistoryEntry interface
- `code/webapp/src/stores/historyStore.ts`
  - Extract workflow_name from extra_data in convertEntryToItem

## Self-Check: PASSED

- Modified files exist: code/webapp/src/pages/Draw.tsx, code/webapp/src/services/comfyui.ts, code/webapp/src/stores/historyStore.ts
- SUMMARY.md updated
- Commits verified: 1959390, 1aa8047, 7c9eeef
