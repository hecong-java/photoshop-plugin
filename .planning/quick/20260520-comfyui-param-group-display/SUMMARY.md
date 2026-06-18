---
status: complete
date: 2026-05-20
quick_id: "20260520-comfyui-param-group-display"
---

# Quick Task: ComfyUI工作流参数名称显示group

## What was done

1. Added `group?: string` to `ParamSchemaField` interface in `lemongrid.ts`
2. Preserved `group` field during normalization in `normalizeParamField`
3. Updated Draw.tsx label logic to show group in parameter names:
   - English label + Chinese group → use group as label
   - Both available and different → show "group/label" format

## Files Changed

- `code/webapp/src/services/lemongrid.ts` — Added `group` field to interface and normalization
- `code/webapp/src/pages/Draw.tsx` — Updated group display logic for parameter labels

## Verification

- TypeScript compilation passes with no errors
