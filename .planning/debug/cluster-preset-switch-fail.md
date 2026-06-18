---
status: resolved
trigger: "集群模式预设切换失败 - 在集群(lemongrid)模式下，切换预设时出现失败"
created: "2026-05-26"
updated: "2026-05-26"
---

# Debug: Cluster Mode Preset Switch Failure

## Symptoms

- **Expected:** Switch presets in cluster (LemonGrid) mode, parameters should update accordingly
- **Actual:** Error occurs after clicking any preset in cluster mode
- **Reproduction:** Any preset fails when switching in cluster mode
- **Mode-specific:** Local ComfyUI mode works fine, only cluster mode is affected

## Current Focus

**Hypothesis:** CONFIRMED - `presetStore.selectPreset()` unconditionally calls local `presetService.readPreset()`, which fails in cluster mode because Bridge transport is unavailable
**Next Action:** Fix applied

## Evidence

- timestamp: 2026-05-26T00:01
  file: code/webapp/src/stores/presetStore.ts
  line: 46-55
  detail: >
    `selectPreset(filename)` always calls `presetService.readPreset(filename)`.
    In cluster mode, `filename` is a cluster preset ID (UUID), not a local file.
    `presetService.readPreset` requires Bridge transport which is unavailable in cluster mode,
    throwing 'Bridge transport unavailable for preset.read'.

- timestamp: 2026-05-26T00:01
  file: code/webapp/src/components/preset/PresetToolbar.tsx
  line: 176
  detail: >
    `applyPresetFromFile` correctly handles cluster mode (lines 148-178),
    fetching preset from `clusterPresetService.listPresets` and building a `PresetFile` object.
    But then calls `await selectPreset(filename)` on line 176, which triggers the broken store path.

- timestamp: 2026-05-26T00:01
  file: code/webapp/src/components/preset/PresetToolbar.tsx
  line: 117
  detail: >
    `handleAddPreset` also calls `selectPreset(created.filename)` after creating a new cluster preset,
    triggering the same Bridge-read failure.

- timestamp: 2026-05-26T00:01
  file: code/webapp/src/components/preset/PresetToolbar.tsx
  line: 248
  detail: >
    `handleRenameConfirm` calls `selectPreset(selectedPresetName)` after renaming in cluster mode,
    same Bridge-read failure.

- timestamp: 2026-05-26T00:01
  file: code/webapp/src/services/preset.ts
  line: 21-26
  detail: >
    `readPreset` checks `hasBridgeTransport()` and throws if unavailable.
    In cluster mode, Bridge is not running, so this always fails.

## Eliminated

- API endpoint issue: cluster preset service API is correct, the problem is in the local store layer

## Resolution

**root_cause:**
  `presetStore.selectPreset()` unconditionally calls `presetService.readPreset()` which requires
  Bridge transport. In cluster mode, Bridge is unavailable, so selecting any preset throws
  'Bridge transport unavailable for preset.read'. Three call sites in PresetToolbar were affected:
  `applyPresetFromFile` (line 176), `handleAddPreset` (line 117), and `handleRenameConfirm` (line 248).
  All three correctly handle cluster data from the LemonGrid API but then delegate to `selectPreset()`
  which re-reads from the local Bridge filesystem.

**fix:**
  Added a `selectClusterPreset()` helper and `buildPresetFileFromCluster()` helper in PresetToolbar.tsx.
  All three cluster-mode call sites now use `selectClusterPreset(presetId, presetData)` to directly set
  store state (`selectedPresetName`, `selectedPresetData`, `isLoading: false`) instead of calling the
  store's `selectPreset()` which would attempt a Bridge read. The local (non-cluster) code paths remain
  unchanged. Type-check passes clean.
