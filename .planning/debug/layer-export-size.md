---
status: verifying
trigger: "Edge case: crop fails when layer bounds equal full canvas dimensions"
created: 2026-03-17T04:00:00.000Z
updated: 2026-03-17T04:25:00.000Z
---

## Current Focus

hypothesis: RESOLVED - batchPlay crop format was incorrect; switched to DOM API crop method
test: User verification - test with any layer export
expecting: Layer export should work without "unknown exception caught" error
next_action: Wait for user verification

## Symptoms

expected: Any layer should export successfully with correct cropping to layer bounds
actual: Export fails with "unknown exception caught" error for ANY layer (even layers smaller than canvas like 483 x 444)
errors: "[Bridge] Handler error: "unknown exception caught"" when crop command is executed
reproduction: Export any layer - the crop command fails
started: After crop-based export was implemented
notes: |
  Latest console output shows crop fails for 483 x 444 layer (clearly smaller than 1024 x 1024 canvas):
  [Export] Layer bounds: {left: 266, top: 282, right: 749, bottom: 726}
  [Export] Layer dimensions: 483 x 444
  [Export] Cropping to layer bounds...
  [Bridge] Handler error: "unknown exception caught"

## Eliminated

- hypothesis: Crop fails only when layer bounds equal document dimensions (edge case)
  evidence: User tested with layer 483 x 444 (smaller than canvas) and it still failed
  timestamp: 2026-03-17T04:15:00.000Z

## Evidence

- timestamp: 2026-03-17T04:00:00.000Z
  checked: User checkpoint response from previous session
  found: Previous fix works for layers smaller than canvas, but fails for background layer with bounds {left: 0, top: 0, right: 1024, bottom: 1024}
  implication: Photoshop's crop command fails when crop area equals document dimensions - no actual cropping needed

- timestamp: 2026-03-17T04:05:00.000Z
  checked: Current crop code at main.js lines 277-291
  found: Crop is executed unconditionally whenever layer bounds are obtained
  implication: Need to add condition: skip crop when layer fills entire canvas

- timestamp: 2026-03-17T04:15:00.000Z
  checked: User checkpoint response - crop fails for 483 x 444 layer
  found: The crop command is failing for ALL layers, not just edge case. Error "unknown exception caught" occurs even when layer is clearly smaller than canvas.
  implication: The batchPlay crop format itself is incorrect - not an edge case issue

- timestamp: 2026-03-17T04:20:00.000Z
  checked: Web research on UXP crop methods
  found: UXP DOM API has document.crop(bounds) method that takes array [left, top, right, bottom]. This is simpler and more reliable than batchPlay approach.
  sources:
    - https://stackoverflow.com/questions/38509885/how-does-photoshop-bounds-crop-work-javascript
    - https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/document/
  implication: Should try DOM API crop method instead of batchPlay

## Resolution

root_cause: The batchPlay crop ActionDescriptor format was causing "unknown exception caught" errors for all layers. The batchPlay approach with nested rectangle object and pixel units is either incompatible or has incorrect field structure for UXP.
fix: Replaced batchPlay crop with UXP DOM API document.crop([left, top, right, bottom]) method. This is simpler, more reliable, and the documented way to crop documents in UXP.
verification: Needs user testing with any layer (both smaller than canvas and full canvas)
files_changed:
  - PS-plugin/ningleai/main.js
