---
phase: quick-6
plan: 01
subsystem: webapp
tags: [bugfix, random-seed, workflow-compilation]
dependency_graph:
  requires: []
  provides: [consistent-random-seed-display]
  affects: [Draw.tsx, handleGenerate, compileWorkflowToPrompt]
tech_stack:
  added: []
  patterns: [value-preservation, conditional-overwrite-prevention]
key_files:
  created: []
  modified:
    - code/webapp/src/pages/Draw.tsx
decisions:
  - Add undefined check before generating new random seeds in compileWorkflowToPrompt
metrics:
  duration: 2m
  completed_date: 2026-03-16
  tasks_completed: 1
  files_modified: 1
---

# Phase quick-6 Plan 01: Fix Random Seed Display Summary

**One-liner:** Fixed random seed display inconsistency between web browser and PS plugin webview by preventing compileWorkflowToPrompt from overwriting pre-generated seeds.

## Problem

The random seed generation had TWO places generating seeds:

1. **handleGenerate**: Pre-generates random seeds BEFORE calling compileWorkflowToPrompt, stores them in inputValues
2. **compileWorkflowToPrompt**: Unconditionally generates NEW random seeds during compilation, overwriting pre-generated values

This caused PS plugin webview to show different random seeds than what was actually sent to ComfyUI.

## Solution

Added conditional checks to both random seed generation blocks in compileWorkflowToPrompt:

1. **Widget-based seed generation (line 1894):**
   - Added `&& inputs[widgetName] === undefined` to the condition
   - Only generates new random seed if no value was already resolved from inputValues

2. **Inputs array-based seed generation (line 1908):**
   - Added `&& inputs[inputName] === undefined` to the condition
   - Handles nodes like RandomNoise that have inputs array but no widgets

## Changes Made

### code/webapp/src/pages/Draw.tsx

**Line 1894:** Added undefined check to widget-based random seed generation
```javascript
// Before
if (isSeedInput && widgetValues[idx + 1] === 'randomize') {

// After
if (isSeedInput && widgetValues[idx + 1] === 'randomize' && inputs[widgetName] === undefined) {
```

**Line 1908:** Added undefined check to inputs array-based random seed generation
```javascript
// Before
if (inputNameLower.includes('seed')) {

// After
if (inputNameLower.includes('seed') && inputs[inputName] === undefined) {
```

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- [x] grep confirmed both `inputs[widgetName] === undefined` and `inputs[inputName] === undefined` checks are in place
- [x] Code compiles without errors
- [x] Commit created successfully

## Self-Check: PASSED

- Files modified: code/webapp/src/pages/Draw.tsx - FOUND
- Commit 606fff5 - FOUND
