---
status: resolved
trigger: "集群模式下，选择comfyui工作流，参数节点显示没有按照API接口开放的节点全部显示"
created: "2026-05-28"
updated: "2026-05-28"
---

# Debug Session: cluster-workflow-params-incomplete

## Symptoms

- **Expected:** 集群模式下选择ComfyUI工作流后，参数面板只显示API标记为暴露的节点参数，且一个节点有多个暴露参数时应全部显示
- **Actual:** 集群模式下，当一个节点有多个参数时，只显示了其中一个参数，其他API暴露的参数未显示
- **Scope:** 只有集群模式(Cluster/LemonGrid)有问题，本地直连模式正常
- **Error messages:** 无报错
- **Timeline:** 未确认是否曾经正常工作过
- **Reproduction:** 切换到集群模式 -> 选择一个ComfyUI工作流 -> 查看参数面板 -> 发现节点只显示部分参数

## Current Focus

- hypothesis: Label-based dedup filter drops parameters sharing the same label text
- next_action: fix applied
- reasoning_checkpoint: root cause confirmed
- tdd_checkpoint: (empty)

## Evidence

- timestamp: 2026-05-28T00:00:00Z
  file: code/webapp/src/pages/Draw.tsx
  line: 4554
  detail: "Cluster mode param rendering uses `.filter((field, idx, arr) => arr.findIndex(f => f.label === field.label) === idx)` to deduplicate by field.label. This drops all but the first parameter when multiple fields share the same label text (e.g., two CLIPTextEncode inputs both labeled 'prompt'). The unique key should be field.name (input_name from API) instead."

## Eliminated

- configStore filtering (getAllowedInputs): only applies to local mode parseWorkflowInputs path, not cluster template rendering
- parseWorkflowInputs: only used in local/direct mode, cluster mode uses param_schema directly
- normalizeParamSchema / normalizeParamField: correctly maps all API fields, no data loss here

## Resolution

- root_cause: "In Draw.tsx line 4554, the cluster-mode parameter rendering deduplicates fields by `field.label` instead of `field.name`. When multiple exposed parameters share the same label text (e.g., two inputs both labeled 'prompt' on different nodes, or same-label inputs on one node), only the first one is kept and the rest are silently dropped."
- fix: "Changed the dedup filter from `f.label === field.label` to `f.name === field.name` in Draw.tsx line 4554. The `field.name` (from API `input_name`) is the correct unique identifier for each parameter. TypeScript compilation passes cleanly."
