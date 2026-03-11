# Quick Task 001: 修复参数设置显示问题

**Status:** Completed
**Date:** 2026-03-11

## Problem

用户报告"参数设置中没显示任何节点信息"和"上传图片节点怎么没显示"。

## Root Cause

### 问题 1：重复代码块导致语法错误

`configStore.ts` 和 `config.ts` 文件中存在重复代码块导致语法错误：

- `configStore.ts`: `shouldDisplayNode` 和 `loadConfig` 函数重复
- `config.ts`: `loadPluginConfig` 函数重复

这些重复代码块导致 JavaScript 解析错误，使整个 store 无法正常工作。

### 问题 2：输入名称匹配逻辑错误

在 `Draw.tsx` 的 `filteredInputGroups` 中，输入名称过滤逻辑有 bug：

- 输入名称格式为 `${inputName}_${nodeId}`（例如 `image_100`）
- 但 `allowedInputs` 包含的是基础名称（例如 `["image"]`）
- 原代码直接比较完整名称和基础名称，导致 LoadImage 等节点被错误过滤

## Solution

1. 删除 configStore.ts 和 config.ts 中的重复代码块
2. 修复 Draw.tsx 中的输入名称匹配逻辑，提取基础名称后再比较

## Files Modified

- `code/webapp/src/stores/configStore.ts` - 删除重复代码
- `code/webapp/src/services/config.ts` - 删除重复代码
- `code/webapp/src/pages/Draw.tsx` - 修复输入名称匹配逻辑

## Commits

- 5510f56: fix(quick-001): 修复参数设置显示问题
- 919a844: fix(config): correct input name matching for allowedInputs filter

## Verification

- TypeScript 编译通过 (`npx tsc --noEmit`)
- LoadImage 节点现在应该正确显示
