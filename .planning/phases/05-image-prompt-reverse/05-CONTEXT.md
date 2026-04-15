# Phase 5: 图片提示词反推功能 - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

为用户提供图片提示词反推功能：用户在任何页面右键点击图片，通过阿里云百炼（通义千问 VL）API 分析图片内容，生成中文自然语言描述性提示词。结果以模态框展示，支持复制到剪贴板或一键填入当前提示词输入框。

</domain>

<decisions>
## Implementation Decisions

### 功能触发与交互
- **D-01:** 通过右键菜单触发"反推提示词"功能，图片上右键时出现该选项
- **D-02:** 采用分步引导流程：右键触发 → 图片预览确认 → 选择 Prompt 模板 → 发送 API 请求 → 显示结果
- **D-03:** 右键菜单覆盖所有页面图片：Draw 页输入区图片、生成结果图片、历史记录页面图片，使用全局统一右键菜单组件

### AI 模型与 API
- **D-04:** 使用第三方 API 实现反推，不依赖 ComfyUI 工作流
- **D-05:** API 服务使用阿里云百炼平台的通义千问 VL 模型（DashScope API）
- **D-06:** 反推结果风格为 CLIP Interrogator 式的自然语言描述（非标签列表）
- **D-07:** 默认输出中文提示词

### 结果展示与复用
- **D-08:** 反推结果通过模态框/弹窗展示，包含文本展示区和操作按钮
- **D-09:** 结果格式为自然语言描述（非逗号分隔标签）
- **D-10:** 提供两个复用按钮："复制到剪贴板"和"填入当前提示词输入框"

### 图片处理
- **D-11:** 直接使用右键点击的图片作为输入，无需额外选择或上传
- **D-12:** 图片以 Base64 编码直接发送给 API

### 配置与网络
- **D-13:** API Key 在现有 Settings 页面新增"提示词反推"配置区域
- **D-14:** 网络请求采用自适应方式：UXP 环境通过 Bridge 代理，浏览器环境直连（复用 bridgeFetch 模式）

### Prompt 设计
- **D-15:** 提供多套预设 Prompt 模板（详细描述、简洁描述、构图分析、风格分析等），用户在分步流程中选择

### Claude's Discretion
- 具体的 Prompt 模板内容设计
- DashScope API 的请求/响应格式细节
- 模态框的具体 UI 布局和样式
- 右键菜单组件的具体实现方式
- Base64 图片大小限制和压缩策略
- API 调用的超时处理和重试策略
- 错误状态的用户提示文案

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 现有服务与模式
- `code/webapp/src/services/upload.ts` — Bridge 通信协议、bridgeFetch 网络请求封装、文件操作 API
- `code/webapp/src/services/comfyui.ts` — ComfyUIClient 类实现参考（API 客户端模式、endpoint 探测）
- `code/webapp/src/stores/settingsStore.ts` — 设置存储模式（Zustand + persist，API Key 存储方式参考）
- `PS-plugin/ningleai/main.js` — Bridge handler 实现，可能需要新增 DashScope API 代理 handler

### UI 集成点
- `code/webapp/src/pages/Draw.tsx` — 主工作流页面，提示词输入框位置、生成结果图片展示区域
- `code/webapp/src/pages/Settings.tsx` — 设置页面，新增反推 API 配置区域
- `code/webapp/src/pages/History.tsx` — 历史记录页面，结果图片展示区域
- `code/webapp/src/components/upload/ImageUpload.tsx` — 图片上传组件，可参考图片处理模式

### 类型与工具
- `code/webapp/src/types/config.ts` — 现有类型定义模式参考

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bridgeFetch` (upload.ts) — 已实现 UXP/浏览器自适应的网络请求封装，DashScope API 调用可复用
- `sendBridgeMessage` (upload.ts) — Bridge 通信封装，如需在 UXP 环境代理 API 请求可复用
- `settingsStore.ts` — Zustand persist 模式，新增 API Key 配置可参照
- `ImageUpload.tsx` — 图片拖拽上传组件，可参考图片处理和预览模式
- `ConfirmDialog.tsx` (preset/) — 现有对话框组件，反推结果弹窗可参考

### Established Patterns
- Zustand store + persist 中间件用于全局状态和配置管理
- Bridge handler 模式：main.js 中 handlers 对象注册命令，upload.ts 中封装 WebApp 端调用
- 设置项统一在 Settings 页面管理，使用 input + 状态绑定模式
- 页面间共享组件放在 `components/` 目录下

### Integration Points
- Draw.tsx 提示词输入区域 → "填入提示词"按钮的目标位置
- Draw.tsx 生成结果图片、History.tsx 历史图片 → 右键菜单绑定目标
- Settings.tsx → 新增"提示词反推"配置区（API Key、Prompt 模板选择）
- main.js Bridge → 可能需要新增 DashScope API 代理 handler（UXP 环境中绕过 CORS）

</code_context>

<specifics>
## Specific Ideas

- 右键菜单组件应设计为全局组件，可绑定到任意图片元素
- Prompt 模板示例：详细描述（"请详细描述这张图片的内容、构图、色彩和风格"）、简洁描述（"用一句话描述这张图片"）、构图分析（"分析这张图片的构图和视觉层次"）
- 模态框包含：图片预览缩略图、反推结果文本区、Prompt 模板选择器、复制/填入按钮
- API Key 使用 Settings 页面管理，与 ComfyUI 连接设置同级展示

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-image-prompt-reverse*
*Context gathered: 2026-04-15*
