# Quick Task 001: 修复参数设置显示问题

**Status:** Ready for execution
**Created:** 2026-03-11

## Problem

用户报告"参数设置中没显示任何节点信息"。经分析发现 `configStore.ts` 和 `config.ts` 文件中存在重复代码块导致语法错误：

### configStore.ts 问题
- `shouldDisplayNode` 函数重复（第31-43行 和 第45-59行）
- `loadConfig` 函数重复（第82-103行 和 第104-122行）

### config.ts 问题
- `loadPluginConfig` 函数重复（第77-117行 和 第118-143行）

这些重复代码块导致 JavaScript 解析错误，影响整个 store 的功能，进而导致参数设置无法正确显示。

## Tasks

### Task 1: 修复 configStore.ts 重复代码

**Files:**
- `code/webapp/src/stores/configStore.ts`

**Action:**
删除重复的代码块，保留第一个完整实现：
1. 删除第44-59行的重复 `shouldDisplayNode` 代码
2. 删除第104-122行的重复 `loadConfig` 代码

**Verify:**
- 文件语法正确，无重复函数定义
- TypeScript 编译通过

**Done:**
- `shouldDisplayNode` 只出现一次
- `loadConfig` 只出现一次

---

### Task 2: 修复 config.ts 重复代码

**Files:**
- `code/webapp/src/services/config.ts`

**Action:**
删除重复的 `loadPluginConfig` 函数（第118-143行）

**Verify:**
- 文件语法正确
- TypeScript 编译通过

**Done:**
- `loadPluginConfig` 函数只出现一次
