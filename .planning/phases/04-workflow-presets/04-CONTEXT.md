# Phase 4: 工作流参数预设功能 - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

为用户提供工作流参数预设管理功能：用户可以保存当前工作流的参数组合为命名预设，支持新增、修改、删除、导入和导出。方便用户在多组参数之间快速切换，避免重复手动调参。

</domain>

<decisions>
## Implementation Decisions

### 预设存储
- **D-01:** 预设数据存储在 Bridge 文件系统（本地磁盘），不使用 localStorage
- **D-02:** 预设文件保存在插件安装目录下的 `presets/` 文件夹中
- **D-03:** 每个预设一个独立的 JSON 文件，文件名格式为 `{工作流名}-{预设名}.json`

### UI 交互
- **D-04:** 预设管理 UI 为下拉菜单 + 管理按钮形式，位于 Draw.tsx 工作流参数区域顶部
- **D-05:** 工具栏包含：预设下拉选择器、新增(+)、设置/编辑(⚙)、导入导出按钮
- **D-06:** 新增预设时使用默认名称（如"预设 1"、"预设 2"），用户可以之后重命名
- **D-07:** 删除预设前弹出确认对话框，防止误删
- **D-08:** 切换预设前检查当前参数是否有未保存的修改，有修改则弹出确认提示

### 预设数据范围
- **D-09:** 预设保存 inputValues（文本、数字、布尔、下拉选择）+ imageFilenames（ComfyUI 上传后的文件名引用）
- **D-10:** 预设不保存图片 base64 数据，仅保存文件名引用
- **D-11:** 图片引用失效时（ComfyUI 端文件已被清理）该参数位置显示提示，让用户重新上传

### 导入导出
- **D-12:** 导出格式为 JSON 文件，每个预设一个独立文件
- **D-13:** 文件名格式：`{工作流名}-{预设名}.json`，存放在 `presets/` 目录
- **D-14:** 导入时如果同名预设已存在，弹出对话框让用户选择：覆盖、跳过、或重命名

### Claude's Discretion
- JSON 文件的具体结构（字段名、元数据字段）
- 预设文件的编码格式和版本管理
- 预设列表的排序方式（按创建时间/修改时间/名称）
- 预设加载时的过渡动画或 loading 状态
- Bridge API 的具体调用方式（新增/修改/删除/读取预设文件的 handler 设计）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 现有存储模式
- `code/webapp/src/stores/workflowCacheStore.ts` — 现有的参数缓存 store，了解当前 inputValues/imageData/imageFilenames 数据结构
- `code/webapp/src/stores/configStore.ts` — Zustand store 模式参考（persist + actions）

### Bridge 通信
- `code/webapp/src/services/upload.ts` — Bridge 消息协议和文件操作 API
- `PS-plugin/ningleai/main.js` — Bridge handler 实现，需要扩展文件操作 handler

### UI 页面
- `code/webapp/src/pages/Draw.tsx` — 主工作流页面，预设 UI 集成位置
- `code/webapp/src/types/config.ts` — 现有类型定义模式

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `workflowCacheStore.ts` — WorkflowCacheEntry 接口定义了 inputValues/imageData/imageFilenames 的类型，预设数据结构可以参考和复用
- `upload.ts` — `bridgeFetch` 和 `sendBridgeMessage` 已封装 Bridge 通信协议，预设文件操作可复用
- `Draw.tsx` — WorkflowInput/WorkflowInputGroup 接口定义了参数输入的结构

### Established Patterns
- Zustand store + persist 中间件用于全局状态管理
- Bridge handler 模式：main.js 中 handlers 对象注册命令，upload.ts 中封装对应的 WebApp 端调用函数
- 类型定义放在 `types/` 目录，接口用 PascalCase

### Integration Points
- Draw.tsx 页面顶部工作流选择器区域 → 新增预设下拉菜单和工具按钮
- Bridge main.js → 新增预设文件 CRUD 的 handler（readPreset, writePreset, deletePreset, listPresets）
- upload.ts → 新增预设文件操作的 WebApp 端 API 封装

</code_context>

<specifics>
## Specific Ideas

- 预设下拉菜单 UI 参考 Draw.tsx 现有的工作流选择器风格，保持一致性
- 预设工具栏：下拉选择器 + 新增(+) + 编辑/重命名/删除(⚙) + 导入导出按钮
- 导入导出通过 Bridge API 实现文件系统操作，UXP 环境中使用 `uxp.storage.localFileSystem`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-workflow-presets*
*Context gathered: 2026-04-14*
