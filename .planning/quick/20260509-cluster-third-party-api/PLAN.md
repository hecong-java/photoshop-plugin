---
status: in-progress
created: 2026-05-09
---

# Quick Task: 集群模式增加 THIRD_PARTY_API 云端模型模板支持

## Description
LemonGrid 后端已支持 template_type 过滤参数，PS 插件需要适配，在集群模式下同时加载 COMFYUI 工作流模板和 THIRD_PARTY_API 云端模型模板。

## Tasks

### T1: Update `listTemplates()` to accept filter params
**File:** `code/webapp/src/services/lemongrid.ts`
- Add `TemplateListParams` interface with `status_filter`, `template_type`, `page_size` fields
- Update `listTemplates(params?)` to build query string from params
- Add `template_type` field to `LemonGridTemplateSummary` interface

### T2: Update `submitTask()` to accept dynamic task_type
**File:** `code/webapp/src/services/lemongrid.ts`
- Add `taskType` parameter (default `'COMFYUI'`) to `submitTask()`
- Use it instead of hardcoded `'COMFYUI'`

### T3: Load both template types in Draw.tsx
**File:** `code/webapp/src/pages/Draw.tsx`
- In the `loadTemplates` useEffect and refresh handler, call `listTemplates()` with `status_filter=ACTIVE&page_size=100` (no template_type filter = returns both types)
- This single call gets all active templates regardless of type

### T4: Group template selector by template_type then category
**File:** `code/webapp/src/pages/Draw.tsx`
- Change `<optgroup>` grouping: first by `template_type` (COMFYUI → "工作流模板", THIRD_PARTY_API → "云端模型"), then by `category`

### T5: Pass correct task_type when submitting
**File:** `code/webapp/src/pages/Draw.tsx`
- In `handleClusterSubmit` and retry handler, determine task_type from selected template's `template_type` field
- Pass to `submitTask()` call

## Verification
- TypeScript compiles without errors
- Template selector shows two groups: "工作流模板" and "云端模型"
- Selecting a THIRD_PARTY_API template submits with task_type='THIRD_PARTY_API'
