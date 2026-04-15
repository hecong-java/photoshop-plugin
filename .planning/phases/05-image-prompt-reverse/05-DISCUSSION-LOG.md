# Phase 5: 图片提示词反推功能 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 05-image-prompt-reverse
**Areas discussed:** 功能触发方式与交互流程, AI模型与实现方式, 结果展示与复用, 图片来源与预处理, 配置与网络, Prompt设计

---

## 功能触发方式与交互流程

| Option | Description | Selected |
|--------|-------------|----------|
| Draw 页面内新按钮 | 在 Draw 页面工作流区域上方增加一个"反推提示词"按钮 | |
| 独立页面/Tab | 在设置页面增加独立 Tab | |
| 右键菜单触发 | 在图片上右键时出现"反推提示词"选项 | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| 一键式流程 | 点击按钮 → 选择/上传图片 → 自动反推 → 显示结果 | |
| 分步引导流程 | 选择图片 → 预览 → 选择模型/参数 → 发送 → 显示结果 | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Draw 页图片 + 结果图片 | 工作流输入区和生成结果图片上右键触发 | |
| 仅结果图片 | 仅在生成结果图片上右键触发 | |
| 所有页面图片 | Draw 页输入/输出图片、历史记录页面图片，全局统一右键菜单 | ✓ |

**User's choice:** 右键菜单触发 + 分步引导流程 + 所有页面图片
**Notes:** 需要设计全局右键菜单组件，绑定到所有图片元素

---

## AI模型与实现方式

| Option | Description | Selected |
|--------|-------------|----------|
| ComfyUI 工作流 | 创建专用 ComfyUI 工作流 JSON 执行反推 | |
| 直接 API 调用 | 直接调用 ComfyUI API 执行反推节点 | |
| 第三方 API | 不依赖 ComfyUI，通过独立 API 服务实现 | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| CLIP Interrogator | 生成自然语言描述性提示词 | ✓ |
| WD14 Tagger | 生成标签式关键词 | |
| Joy Caption | 新一代图文描述模型 | |
| 支持多种模型切换 | 提供多种模型选项让用户选择 | |

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI Vision API | GPT-4o 等多模态模型 API | |
| 国内云服务 API | 阿里云/百度等国内云服务图像识别 API | ✓ |
| 自定义 API 端点 | 用户自行配置 URL 和参数 | |
| 本地模型 (Ollama) | 运行本地模型反推 | |

| Option | Description | Selected |
|--------|-------------|----------|
| 阿里云百炼 (通义千问 VL) | DashScope API，支持图像理解 | ✓ |
| 百度智能云 (文心 VL) | 文心一言 VL 模型 | |
| 智谱 AI (GLM-4V) | GLM-4V 视觉模型 | |
| OpenAI 兼容格式 | 自定义兼容端点 | |

**User's choice:** 第三方 API + CLIP Interrogator 风格 + 阿里云百炼（通义千问 VL）

---

## 结果展示与复用

| Option | Description | Selected |
|--------|-------------|----------|
| 模态框/弹窗 | 弹出模态框显示反推结果，含文本区、复制按钮、填入按钮 | ✓ |
| 侧边/底部面板 | 在图片旁展开面板显示结果 | |
| 内联提示 | 结果显示在右键菜单下方 | |

| Option | Description | Selected |
|--------|-------------|----------|
| 自然语言描述 | 连贯的自然语言描述，如"日落时分的山湖美景" | ✓ |
| 标签列表 | 逗号分隔的标签 | |
| 两者都显示 | 同时显示描述和标签 | |

| Option | Description | Selected |
|--------|-------------|----------|
| 复制 + 填入提示词 | 复制到剪贴板 + 填入当前提示词输入框 | ✓ |
| 仅复制到剪贴板 | 只提供复制功能 | |
| 复制 + 填入 + 保存历史 | 最全功能但更复杂 | |

**User's choice:** 模态框弹窗 + 自然语言描述 + 复制 + 填入提示词

---

## 图片来源与预处理

| Option | Description | Selected |
|--------|-------------|----------|
| 右键图片本身 | 从右键点击的图片直接获取 | ✓ |
| 重新选择上传 | 触发后弹出文件选择器 | |
| 右键图片 + 可切换上传 | 默认右键图片，可切换为上传 | |

| Option | Description | Selected |
|--------|-------------|----------|
| Base64 直传 | 图片转 base64 直接发送给 API | ✓ |
| URL 方式 | 先上传到 URL，再用 URL 调用 | |

**User's choice:** 右键图片本身 + Base64 直传

---

## 配置与网络

| Option | Description | Selected |
|--------|-------------|----------|
| Settings 页面新增区域 | 在现有 Settings 页面增加"提示词反推"配置区 | ✓ |
| 反推弹窗内引导配置 | 首次使用时在弹窗内引导配置 | |
| 配置文件方式 | 通过 Bridge 读写配置文件 | |

| Option | Description | Selected |
|--------|-------------|----------|
| Bridge 代理 + 浏览器直连自适应 | UXP 环境 Bridge 代理，浏览器直连 | ✓ |
| 始终直连 | 始终从 WebApp 直接发送请求 | |

**User's choice:** Settings 页面配置 + Bridge 代理 + 浏览器直连自适应

---

## Prompt 设计

| Option | Description | Selected |
|--------|-------------|----------|
| 内置固定 Prompt | 系统提示词内置在代码中，不可修改 | |
| 用户可自定义 Prompt | 允许用户在 Settings 自定义系统提示词 | |
| 多套预设模板 | 提供多套预设模板，用户可选择 | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| 英文提示词 | 与主流 AI 绘图工具兼容 | |
| 中文提示词 | 对中文用户更友好 | ✓ |
| 用户可选择语言 | 在设置中选择输出语言 | |

**User's choice:** 多套预设模板 + 中文提示词

---

## Claude's Discretion

- 具体 Prompt 模板内容设计
- DashScope API 请求/响应格式细节
- 模态框 UI 布局和样式
- 右键菜单组件具体实现
- Base64 图片大小限制和压缩策略
- API 超时和重试策略
- 错误提示文案

## Deferred Ideas

None — discussion stayed within phase scope
