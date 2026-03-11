# Quick Task 001: 修复参数设置显示问题

**Status:** Completed
**Date:** 2026-03-11

## Problem

用户报告"参数设置中没显示任何节点信息"。

## Root Cause

`configStore.ts` 和 `config.ts` 文件中存在重复代码块导致语法错误：

### configStore.ts
- `shouldDisplayNode` 函数重复（第31-43行 和 第45-59行）
- `loadConfig` 函数重复（第82-103行 和 第104-122行）

### config.ts
- `loadPluginConfig` 函数重复（第77-117行 和 第118-143行）

这些重复代码块导致 JavaScript 解析错误，使整个 store 无法正常工作，进而导致 `shouldDisplayNode` 和 `getAllowedInputs` 函数失效，参数设置无法正确过滤显示。

## Solution

删除重复的代码块，保留第一个完整实现。

## Files Modified

- `code/webapp/src/stores/configStore.ts` - 删除重复的 `shouldDisplayNode` 和 `loadConfig` 代码
- `code/webapp/src/services/config.ts` - 删除重复的 `loadPluginConfig` 代码

## Verification

- TypeScript 编译通过 (`npx tsc --noEmit`)
- 代码结构正确，函数定义唯一
