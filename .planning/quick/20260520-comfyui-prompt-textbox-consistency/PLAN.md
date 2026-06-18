---
status: in-progress
created: 2026-05-20
---

# ComfyUI Prompt Textbox Consistency

## Goal
Make ComfyUI workflow prompt textarea consistent with cloud model workflow's prompt textarea.

## Changes
1. Add `required?: boolean` to `WorkflowInput` interface
2. Set `required: true` for CLIPTextEncode prompt inputs (always required)
3. Update ComfyUI textarea rendering (line ~3892-3907):
   - Show required mark `*` when `input.required` is true
   - Use `String(value)` instead of `value as string`
   - Use `input.description || `输入${input.label}...`` for placeholder
4. Enhance `isLongText` regex to check label + optional description

## Files
- `code/webapp/src/pages/Draw.tsx`
