# Phase 4: 工作流参数预设功能 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 04-workflow-presets
**Areas discussed:** 预设存储位置, 预设管理 UI 交互, 预设数据范围, 导入导出设计

---

## 预设存储位置

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage | Zustand persist，零配置但容量有限 | |
| Bridge 文件系统 | 本地磁盘文件，无大小限制 | ✓ |
| 混合方案 | localStorage 索引 + 文件同步，双重逻辑 | |

**User's choice:** Bridge 文件系统
**Notes:** 预设文件保存在插件安装目录下的 presets/ 文件夹

### 文件位置

| Option | Description | Selected |
|--------|-------------|----------|
| 插件同目录 | presets/ 在插件安装目录下 | ✓ |
| ComfyUI 服务端 | 通过 API 管理，可跨设备 | |
| 用户自定义路径 | 设置中配置路径 | |

**User's choice:** 插件同目录

---

## 预设管理 UI 交互

| Option | Description | Selected |
|--------|-------------|----------|
| 下拉菜单 + 管理按钮 | 顶部紧凑工具栏 | ✓ |
| 独立弹窗面板 | 点击弹出预设管理窗口 | |
| 侧边栏面板 | 右侧可折叠预设列表 | |

**User's choice:** 下拉菜单 + 管理按钮

### 切换行为

| Option | Description | Selected |
|--------|-------------|----------|
| 立即替换 | 无确认直接替换 | |
| 确认后替换 | 检查未保存修改，有修改则确认 | ✓ |
| 应用确认模式 | 选择后需手动点应用 | |

**User's choice:** 确认后替换

### 预设名称

| Option | Description | Selected |
|--------|-------------|----------|
| 弹窗输入名称 | 新增时输入名称和备注 | |
| 默认名称 + 可重命名 | 默认"预设 1"等，后续可改名 | ✓ |

**User's choice:** 默认名称 + 可重命名

### 删除确认

| Option | Description | Selected |
|--------|-------------|----------|
| 确认后删除 | 弹出确认对话框 | ✓ |
| 直接删除 | 无确认直接删除 | |

**User's choice:** 确认后删除

---

## 预设数据范围

| Option | Description | Selected |
|--------|-------------|----------|
| 仅文本/数字参数 | 只保存 inputValues | |
| 参数 + 图片引用 | inputValues + imageFilenames | ✓ |
| 参数 + 图片 base64 | 完整恢复包括图片数据 | |

**User's choice:** 参数 + 图片引用

### 图片失效处理

| Option | Description | Selected |
|--------|-------------|----------|
| 提示用户重新上传 | 显示"图片不可用"提示 | ✓ |
| 回退到默认值 | 自动使用工作流默认值 | |
| 本地缓存备份 | localStorage 缓存图片 base64 | |

**User's choice:** 提示用户重新上传

---

## 导入导出设计

| Option | Description | Selected |
|--------|-------------|----------|
| JSON 文件，每预设一个 | 文件名：工作流名-预设名.json | ✓ |
| JSON 文件，按工作流打包 | 文件名：工作流名-presets.json | |
| 单文件全局导出 | 所有预设打包成一个文件 | |

**User's choice:** JSON 文件，每预设一个

### 导入冲突处理

| Option | Description | Selected |
|--------|-------------|----------|
| 提示选择 | 弹出覆盖/跳过/重命名选项 | ✓ |
| 自动覆盖 | 同名预设直接替换 | |
| 自动重命名 | 加后缀保留所有版本 | |

**User's choice:** 提示选择

---

## Claude's Discretion

- JSON 文件具体结构设计
- 预设排序方式
- 预设加载过渡状态
- Bridge handler 具体实现

## Deferred Ideas

None — discussion stayed within phase scope
