---
status: awaiting_human_verify
trigger: "Previous fix (quick-7) attempted to trim exported layer images to match layer bounds, but the image is still being passed with full canvas size instead of actual layer content size."
created: 2026-03-17T00:00:00.000Z
updated: 2026-03-17T03:20:00.000Z
---

## Current Focus

hypothesis: The batchPlay crop command with correct nested rectangle descriptor format will work where DOM API crop failed
test: Export a layer and verify the exported image dimensions match the layer content size
expecting: No "Rectangle does not contain key: left" error, document is cropped to layer bounds, exported PNG matches layer dimensions
next_action: User verification of the batchPlay crop fix with proper rectangle descriptor

## Symptoms

expected: Image should be trimmed to layer/selection content bounds (actual visible pixels)
actual: Image is still being exported with full canvas dimensions
errors: None - no error messages, just wrong behavior
reproduction: Load image from layer or selection in PS plugin, observe image dimensions sent to ComfyUI
started: Fix was applied in commit 90fe508 but issue persists

## Eliminated

## Evidence

- timestamp: 2026-03-17T00:00:00.000Z
  checked: exportActiveLayerPngInternal function (lines 196-284)
  found: The function duplicates the document, applies trim via batchPlay, then exports. The batchPlay trim command uses `targetEnum` as the document reference.
  implication: The trim command uses `targetEnum` which means "the active document" - but duplicatedDoc might not be the active document after duplication

- timestamp: 2026-03-17T00:00:00.000Z
  checked: Document duplication and trim sequence (lines 234-256)
  found: 1) duplicatedDoc = await activeDoc.duplicate() 2) batchPlay trim with targetEnum 3) duplicatedDoc.saveAs.png() 4) duplicatedDoc.closeWithoutSaving()
  implication: The duplicate() method may return a reference but NOT make it the active document. The batchPlay with targetEnum would then trim the ORIGINAL document, not the duplicate.

- timestamp: 2026-03-17T00:00:00.000Z
  checked: Fix implementation in PS-plugin/ningleai/main.js line 243
  found: Changed `_target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }]` to `_target: [{ _ref: 'document', _id: duplicatedDoc.id }]`
  implication: The trim command now explicitly targets the duplicated document by ID, ensuring the correct document is trimmed regardless of which one is active

- timestamp: 2026-03-17T01:30:00.000Z
  checked: User verification of the fix
  found: Fix was applied but user reports the issue persists - image still exported with full canvas size
  implication: The document ID targeting fix was not sufficient; there may be another root cause

- timestamp: 2026-03-17T01:35:00.000Z
  checked: Web search for Photoshop UXP duplicate behavior
  found: According to Adobe docs, document.duplicate() should automatically make the duplicated document active
  implication: The duplicate should be active, so the trim should work. Need to investigate if trim is actually executing or failing silently.

- timestamp: 2026-03-17T01:40:00.000Z
  checked: Added diagnostic logging to exportActiveLayerPngInternal
  found: Added console.log statements to track: duplicated doc ID, original doc dimensions, duplicated doc dimensions before trim, trim command result, duplicated doc dimensions after trim
  implication: This will help identify where the issue is - whether trim is executing, whether it changes dimensions, etc.

- timestamp: 2026-03-17T02:00:00.000Z
  checked: User checkpoint response - trim approach still not working
  found: User provided new approach: use batchPlay to get layer bounds directly, then crop to those bounds, and scale if needed. This is more reliable than trim command.
  implication: The trim command may have fundamental issues. Switching to explicit bounds + crop approach.

- timestamp: 2026-03-17T02:30:00.000Z
  checked: Bounds extraction code in main.js lines 253-264
  found: User provided diagnostic output showing bounds format mismatch. batchPlay returns bounds as: `{ top: { _unit: "pixelsUnit", _value: 375 }, left: { ... }, ... }` but code expected: `{ _value: [left, top, right, bottom] }`. This caused all bounds values to be undefined, resulting in NaN dimensions.
  implication: The bounds extraction logic was fundamentally wrong. Need to access `bounds.left._value` instead of `bounds._value[0]`.

- timestamp: 2026-03-17T03:00:00.000Z
  checked: User checkpoint response - bounds now correct, but crop fails
  found: Bounds extraction now works: "Layer dimensions: 335 x 400" (correct, not NaN). But batchPlay crop command throws "unknown exception caught" with error code PS_EXPORT_FAILED.
  implication: The batchPlay crop command format is incorrect or has compatibility issues. Need to try DOM API document.crop() method instead.

- timestamp: 2026-03-17T03:00:00.000Z
  checked: Web search for Photoshop UXP crop API
  found: Adobe DOM API has document.crop(bounds: PsCommon.Bounds, angle?: number) method. Bounds is an array of four coordinates. This is simpler and more reliable than batchPlay.
  implication: Should use DOM API duplicatedDoc.crop([left, top, right, bottom]) instead of batchPlay crop command.

- timestamp: 2026-03-17T03:05:00.000Z
  checked: Implemented DOM API crop fix in main.js
  found: Replaced batchPlay crop command (lines 277-290) with simple DOM API call: `await duplicatedDoc.crop([left, top, right, bottom], 0);`
  implication: The DOM API crop method should be more reliable and not throw "unknown exception caught" errors.

- timestamp: 2026-03-17T03:10:00.000Z
  checked: User checkpoint response - DOM API crop fails with "Rectangle does not contain key: left"
  found: Bounds extraction works correctly: "Layer bounds: {left: 272, top: 297, right: 614, bottom: 622}" and "Layer dimensions: 342 x 325". But `duplicatedDoc.crop([left, top, right, bottom], 0)` throws "Rectangle does not contain key: left".
  implication: The DOM API document.crop() expects a specific Rectangle object format, not a plain array. Need to use batchPlay with the correct ActionDescriptor format instead.

- timestamp: 2026-03-17T03:15:00.000Z
  checked: Web search for Photoshop ActionDescriptor crop rectangle format
  found: The correct batchPlay crop format uses nested descriptors with specific keys: `_obj: 'crop'` with a `to` key containing a rectangle descriptor with `Top`, `Left`, `Btom`, `Rght` keys and `pixelsUnit` values.
  implication: Need to use batchPlay with the proper ActionDescriptor structure instead of DOM API crop method.

## Resolution

root_cause: The DOM API `document.crop()` method requires a specific Rectangle object format, not a plain array `[left, top, right, bottom]`. When passing an array, it throws "Rectangle does not contain key: left".
fix: Use batchPlay with the correct ActionDescriptor format for crop: nested `to` object with `_obj: 'rectangle'` and individual bounds as `_unit: 'pixelsUnit', _value: number` properties.
verification:
files_changed:
  - PS-plugin/ningleai/main.js
