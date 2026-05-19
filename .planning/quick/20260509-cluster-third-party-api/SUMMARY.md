---
status: complete
created: 2026-05-09
---

# Quick Task: 集群模式 THIRD_PARTY_API 云端模型支持

## Result
完成。PS 插件集群模式现在支持加载和提交 THIRD_PARTY_API (云端模型) 类型的模板。

## Changes

### `code/webapp/src/services/lemongrid.ts`
- 新增 `TemplateType` 类型 (`'COMFYUI' | 'THIRD_PARTY_API'`)
- 新增 `TemplateListParams` 接口 (`status_filter`, `template_type`, `page_size`, `category`, `search`)
- `LemonGridTemplateSummary` / `LemonGridTemplateDetail` 增加 `template_type` 字段
- `listTemplates()` 支持查询参数，构建 URL query string
- `submitTask()` 新增 `taskType` 参数，默认 `'COMFYUI'`
- `normalizeTemplateDetail()` 传递 `template_type`

### `code/webapp/src/stores/lemongridStore.ts`
- `LemonGridTaskState` 新增 `templateType` 字段
- 默认值 `'COMFYUI'`

### `code/webapp/src/pages/Draw.tsx`
- 加载模板使用 `{ status_filter: 'ACTIVE', page_size: 100 }` 参数
- 模板选择器按 `template_type` 分组显示 (工作流模板 / 云端模型)
- 提交时传递正确的 `taskType`
- 重试时从 task 状态读取 `templateType`

## Verification
- TypeScript 编译通过 (`tsc --noEmit` 无错误)
- Commit: `4cb7c18`
