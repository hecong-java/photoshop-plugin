# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## layer-export-size — Layer export uses full canvas instead of layer content bounds
- **Date:** 2026-03-17T03:20:00.000Z
- **Error patterns:** crop, rectangle, bounds, full canvas, layer dimensions, batchPlay, DOM API, pixelsUnit
- **Root cause:** The DOM API `document.crop()` method requires a specific Rectangle object format, not a plain array `[left, top, right, bottom]`. When passing an array, it throws "Rectangle does not contain key: left".
- **Fix:** Use batchPlay with the correct ActionDescriptor format for crop: nested `to` object with `_obj: 'rectangle'` and individual bounds as `_unit: 'pixelsUnit', _value: number` properties.
- **Files changed:** PS-plugin/ningleai/main.js
---

