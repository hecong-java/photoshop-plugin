---
status: investigating
trigger: "双图编辑工作流的CFG参数传值为0，但该参数已被隐藏，应该传默认值而不是0"
created: 2026-04-09T00:00:00Z
updated: 2026-04-09T00:00:00Z
---

## Current Focus

hypothesis: When a workflow parameter is hidden, the code sends 0 instead of the parameter's default value
test: Read the workflow JSON, the parameter handling code, and trace how hidden params are processed
expecting: Find logic that incorrectly sets hidden params to 0
next_action: Gather initial evidence from workflow JSON and code files

## Symptoms

expected: CFG参数被隐藏后，应该传递该参数的默认值（需要从工作流JSON或代码中确认具体默认值是多少）
actual: CFG参数被传递为0
errors: 无报错，但生成的图像质量可能受影响（CFG=0意味着模型不参考prompt）
reproduction: 运行双图编辑工作流，检查发送给ComfyUI的参数中CFG的值
started: 不确定何时开始，参数被隐藏设计后可能出现此问题

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
