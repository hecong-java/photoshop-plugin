---
status: complete
created: 2026-05-20
---

# ComfyUI Prompt Textbox Consistency

## Done
- Added `required?: boolean` and `description?: string` to `WorkflowInput` interface
- CLIPTextEncode prompt inputs now set `required: true`
- ComfyUI textarea rendering now matches cloud model workflow:
  - Shows red `*` for required fields
  - Uses `String(value)` instead of `value as string`
  - `isLongText` checks label + description
  - Placeholder uses description if available
- Short text input also uses `String(value)` for consistency

## Files
- `code/webapp/src/pages/Draw.tsx` (interface + rendering)
