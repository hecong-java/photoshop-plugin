# Photoshop ComfyUI Plugin

## What This Is

一个 Photoshop UXP 插件，用于连接 ComfyUI 进行 AI 图像生成。插件通过 Bridge 通信层与 Photoshop 原生 API 交互，支持在 Photoshop 中直接使用 ComfyUI 工作流生成图像并导入为图层。

## Core Value

让用户在 Photoshop 中无缝使用 ComfyUI 的 AI 图像生成能力，无需在多个应用之间切换。

## Requirements

### Validated

- ✓ React Webapp 嵌入 Photoshop UXP WebView — existing
- ✓ Bridge 通信层用于 Photoshop 原生操作 — existing
- ✓ ComfyUI REST API 集成与端点探测 — existing
- ✓ 工作流列表展示与选择 — existing
- ✓ 生成历史记录 — existing
- ✓ 图像导入到 Photoshop 图层 — existing
- ✓ Zustand 状态管理与 localStorage 持久化 — existing

### Active

- [ ] 配置文件动态显示节点 - 用户通过 JSON 配置文件指定要显示的节点参数
- [ ] 参数本地文件缓存 - 按工作流分别缓存参数到本地文件，下次打开自动恢复

### Out of Scope

- OAuth 认证 — ComfyUI 依赖网络级访问控制
- 移动端支持 — 仅支持 Photoshop 桌面版

## Context

### 技术环境
- Photoshop 2023+ (UXP 支持)
- ComfyUI 服务器（独立部署）
- React 19 + TypeScript 5.9 + Vite 7

### 现有架构
- WebView UI Layer: React 组件、页面、hooks、services、stores
- Bridge Layer (main.js): Photoshop 原生操作、网络代理
- ComfyUI Integration Layer: API 客户端、端点探测、工作流管理

### 关键文件
- `code/webapp/src/services/comfyui.ts` - ComfyUI 客户端
- `code/webapp/src/stores/settingsStore.ts` - 设置存储
- `PS-plugin/ningleai/main.js` - Bridge 通信层

## Constraints

- **平台**: Photoshop UXP 环境，需要 Bridge 代理网络请求绕过 CORS
- **存储**: localStorage 在 UXP 环境可用，但需要 Bridge 进行文件系统操作
- **配置**: JSON 配置文件需与插件安装文件放在一起

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 配置文件与插件放在一起 | 用户方便找到和编辑配置 | — Pending |
| 按工作流分别缓存参数 | 不同工作流的参数结构不同，独立存储更合理 | — Pending |
| 缓存存储到本地文件 | 实现跨会话持久化，不受浏览器数据清理影响 | — Pending |

---
*Last updated: 2026-03-11 after initialization*
