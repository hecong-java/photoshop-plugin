---
phase: quick-260317-fii-ps
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - PS-plugin/ningleai/main.js
autonomous: true
requirements: [QUICK-FIX]
must_haves:
  truths:
    - "Exported layer image matches layer bounds, not canvas size"
    - "Exported selection image matches selection bounds, not canvas size"
  artifacts:
    - path: "PS-plugin/ningleai/main.js"
      provides: "Layer/selection export with correct bounds"
  key_links:
    - from: "exportActiveLayerPngInternal"
      to: "layer.bounds"
      via: "batchPlay trim command"
      pattern: "trimDocument"
---

<objective>
Fix PS layer and selection export to output images matching the actual layer/selection bounds instead of the full canvas size.

Purpose: When users load a PS layer or selection into the ComfyUI workflow, the image should have the same dimensions as the layer content or selection area, not the entire document canvas.
Output: Modified main.js with correct export behavior.
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
# Problem Analysis

The current `exportActiveLayerPngInternal` function in `PS-plugin/ningleai/main.js`:
1. Saves the entire document as PNG via `activeDoc.saveAs.png()`
2. Only controls layer visibility to isolate the layer
3. Result: exported image is full canvas size with transparent pixels around the layer

The `exportSelectionPng` function has similar issues - the fallback path uses the same `exportActiveLayerPngInternal`.

# Solution

After saving the document, use Photoshop's "Trim" command to remove transparent pixels:
- BatchPlay action: `_obj: 'trim'` with `trimTop`, `trimBottom`, `trimLeft`, `trimRight` all set to true
- This crops the document to the visible content bounds

For layer export:
1. Save document with only target layer visible (current behavior)
2. Apply trim command to remove transparent edges
3. Export trimmed document

For selection export:
- The `exportSelectionAsFileTypePressed` already exports only the selection bounds
- The fallback path (copyToLayer + exportActiveLayerPngInternal) will benefit from the trim fix

# Key Code Locations

From PS-plugin/ningleai/main.js:
```javascript
// Line 196-262: exportActiveLayerPngInternal
// After line 242 (visibility restore), before reading file:
// Need to add trim operation after saveAs.png

// Current flow:
// 1. Save visibility state
// 2. Hide all layers except target + parents
// 3. activeDoc.saveAs.png()
// 4. Restore visibility
// 5. Read file and return base64

// Fixed flow:
// 1. Save visibility state
// 2. Hide all layers except target + parents
// 3. activeDoc.saveAs.png()
// 4. Apply trim to remove transparent edges
// 5. Save trimmed document
// 6. Restore visibility
// 7. Read file and return base64
```

# Photoshop BatchPlay Trim Action

```javascript
await action.batchPlay([
  {
    _obj: 'trim',
    _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
    trimTop: true,
    trimBottom: true,
    trimLeft: true,
    trimRight: true,
    trimBasedOn: { _enum: 'trimBasedOn', _value: 'transparency' }
  }
], { synchronousExecution: true, modalBehavior: 'execute' });
```
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix exportActiveLayerPngInternal to trim exported image</name>
  <files>PS-plugin/ningleai/main.js</files>
  <action>
Modify the `exportActiveLayerPngInternal` function in `PS-plugin/ningleai/main.js` to trim the exported image to the layer bounds.

Current implementation (lines 196-262):
1. Creates temp folder and file
2. Collects all layers and saves visibility state
3. Makes only target layer (and its parents) visible
4. Saves document as PNG via `activeDoc.saveAs.png(exportedFile, {}, true)`
5. Restores original visibility
6. Reads file and converts to base64

Required fix:
After step 4 (saveAs.png), before step 5 (restore visibility), add a trim operation:

```javascript
// After the saveAs.png call (around line 234), add:
// Trim transparent pixels to get layer bounds
await action.batchPlay([
  {
    _obj: 'trim',
    _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
    trimTop: true,
    trimBottom: true,
    trimLeft: true,
    trimRight: true,
    trimBasedOn: { _enum: 'trimBasedOn', _value: 'transparency' }
  }
], { synchronousExecution: true, modalBehavior: 'execute' });

// Save the trimmed document
await activeDoc.saveAs.png(exportedFile, {}, true);
```

Note: The trim modifies the document in place, so we need to:
1. First save the full canvas (for potential undo/revert if needed)
2. Apply trim
3. Save trimmed version (overwrites the file)
4. Then restore visibility

Alternatively, use a cleaner approach:
1. Duplicate the document first
2. Apply trim to the duplicate
3. Export from the duplicate
4. Close duplicate without saving

Implement the cleaner approach to avoid modifying the original document:
```javascript
// After making only target layer visible:
// Duplicate document for safe trimming
const duplicatedDoc = await activeDoc.duplicate();

try {
  // Trim the duplicate
  await action.batchPlay([
    {
      _obj: 'trim',
      _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
      trimTop: true,
      trimBottom: true,
      trimLeft: true,
      trimRight: true,
      trimBasedOn: { _enum: 'trimBasedOn', _value: 'transparency' }
    }
  ], { synchronousExecution: true, modalBehavior: 'execute' });

  // Export from the trimmed duplicate
  await duplicatedDoc.saveAs.png(exportedFile, {}, true);
} finally {
  // Close duplicate without saving
  await duplicatedDoc.closeWithoutSaving();
}

// Then restore original document visibility (existing code)
```
  </action>
  <verify>
    <automated>grep -n "trim" "D:/projects/photoshop-plugin/PS-plugin/ningleai/main.js" | head -5</automated>
  </verify>
  <done>
    exportActiveLayerPngInternal exports image matching layer bounds, not canvas size.
    Function includes document duplicate, trim, and closeWithoutSaving pattern.
  </done>
</task>

</tasks>

<verification>
1. Manual test in Photoshop: Create a document with a small layer (e.g., 200x200 pixels on a 1000x1000 canvas)
2. Select the layer and click "Load from PS Layer" button
3. Verify the uploaded image dimensions match the layer bounds (200x200), not canvas (1000x1000)
4. Test with selection: Create a selection area smaller than canvas
5. Verify exported selection matches selection bounds
</verification>

<success_criteria>
- Layer export produces image with dimensions matching layer content bounds
- Selection export produces image with dimensions matching selection bounds
- Original document is not modified (duplicate + close pattern)
- Existing functionality preserved (visibility restoration, error handling)
</success_criteria>

<output>
After completion, create `.planning/quick/260317-fii-ps/260317-fii-SUMMARY.md`
</output>
