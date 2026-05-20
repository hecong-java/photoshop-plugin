# Roadmap: Photoshop ComfyUI Plugin

**Created:** 2026-03-11
**Granularity:** Standard
**Core Value:** 让用户在 Photoshop 中无缝使用 ComfyUI 的 AI 图像生成能力

---

## Phases

- [ ] **Phase 1: Configuration System** - JSON config parsing and dynamic node display
- [ ] **Phase 2: Local Caching** - Parameter caching to local files
- [ ] **Phase 3: Integration & Testing** - Full integration testing and refinement
- [ ] **Phase 4: 工作流参数预设功能** - 参数预设的保存、管理、导入导出
- [ ] **Phase 5: 图片提示词反推功能** - 通过图片反推生成提示词
- [x] **Phase 8: LemonGrid 预设与反推提示词集成** - 将预设和反推提示词功能接入 LemonGrid 已有基础设施 *(completed 2026-05-20)*
- [ ] **Phase 9: 接入LemonGrid的任务队列信息** - 在插件中展示 LemonGrid 平台的任务队列状态信息

---

## Phase Details

### Phase 1: Configuration System

**Goal:** Users can customize which ComfyUI node parameters are displayed in the plugin through a JSON configuration file.

**Depends on:** Nothing (first phase)

**Requirements:** CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, INTG-01

**Success Criteria** (what must be TRUE):
1. User can place a JSON config file alongside the plugin installation
2. Plugin reads and parses the JSON config on startup
3. Only nodes specified in config (by class_type) have their parameters displayed
4. Parameters are dynamically rendered based on node structure from ComfyUI API
5. Nodes not in config use default values from the workflow without showing UI

**Plans:** 5 plans

Plans:
- [x] 01-00-PLAN.md — Test scaffolds for TDD workflow
- [x] 01-01-PLAN.md — Bridge handler and config file template
- [x] 01-02-PLAN.md — Config service and Zustand store
- [x] 01-03-PLAN.md — UI integration in Draw.tsx
- [ ] 01-04-PLAN.md — Human verification checkpoint

---

### Phase 2: Local Caching

**Goal:** User-modified parameter values persist across sessions with per-workflow isolation.

**Depends on:** Phase 1

**Requirements:** CACH-01, CACH-02, CACH-03, CACH-04, CACH-05, INTG-02, INTG-03

**Success Criteria** (what must be TRUE):
1. User-modified parameter values are automatically cached when changed
2. Each workflow has its own isolated cache storage
3. Opening a workflow automatically loads the previously cached parameter values
4. Cache files are written to local filesystem via Bridge API
5. Cache data includes complete state of all displayed node parameters

**Plans:** TBD

---

### Phase 3: Integration & Testing

**Goal:** Configuration and caching systems work together seamlessly with the existing plugin architecture.

**Depends on:** Phase 1, Phase 2

**Requirements:** (Integration validation phase - validates all previous requirements work together)

**Success Criteria** (what must be TRUE):
1. User can configure nodes, modify parameters, and have values persist across sessions
2. Switching between workflows loads the correct cached parameters for each
3. Configuration changes are reflected immediately without plugin restart
4. Cache and config systems do not interfere with existing plugin features
5. All existing functionality (workflow selection, image generation, layer import) continues to work

**Plans:** TBD

---

### Phase 8: LemonGrid 预设与反推提示词集成

**Goal:** 将已有的工作流参数预设功能（Phase 4）和图片提示词反推功能（Phase 5）接入 LemonGrid 集群模式，复用 LemonGrid 已有的预设和图片分析基础设施，使这两个功能在 Cluster Mode 下完整可用。

**Depends on:** Phase 4, Phase 5, Phase 6, Phase 7

**Requirements:** SC-1, SC-2, SC-3, SC-4, SC-5

**Success Criteria** (what must be TRUE):
1. Cluster Mode 下用户可以保存、管理模板参数预设
2. 预设数据通过 LemonGrid API 持久化（而非仅本地存储）
3. Cluster Mode 下用户可以右键图片反推提示词
4. 反推提示词复用 LemonGrid 已有的图片分析能力
5. Direct Mode 和 Cluster Mode 的预设与反推功能各自独立工作

**Plans:** 3 plans

Plans:
- [x] 08-01-PLAN.md — Cluster preset service and cluster prompt reverse service (with tests)
- [x] 08-02-PLAN.md — PresetToolbar and PromptReverseFlow cluster mode branching
- [x] 08-03-PLAN.md — Draw.tsx data-asset-id wiring and mode switch cleanup

### Phase 9: 接入LemonGrid的任务队列信息

**Goal:** 在插件中接入 LemonGrid 平台的任务队列信息，使用户能够查看当前平台的队列状态（如排队任务数、预计等待时间等），帮助用户了解任务提交后的排队情况。

**Depends on:** Phase 6, Phase 8

**Requirements:** Q-01, Q-02, Q-03

**Success Criteria** (what must be TRUE):
1. Cluster Mode 下用户可以查看 LemonGrid 平台的队列状态信息
2. 队列信息实时更新或定期刷新
3. 队列状态以直观的方式展示（如排队数量、预计等待时间）
4. 不影响现有 Direct Mode 功能

**Plans:** 2 plans

Plans:
- [ ] 09-01-PLAN.md — Queue API types, methods, and store state
- [ ] 09-02-PLAN.md — Cluster queue badge, per-task ETA display, and polling

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Configuration System | 4/5 | In progress | 01-00, 01-01, 01-02, 01-03 |
| 2. Local Caching | 0/1 | Not started | - |
| 3. Integration & Testing | 0/1 | Not started | - |
| 4. 工作流参数预设功能 | 0/3 | Not started | - |
| 5. 图片提示词反推功能 | 0/4 | Planning | - |
| 05.1. Plugin Performance Fix | 3/3 | Complete   | 2026-04-17 |
| 6. LemonGrid Integration | 3/3 | Complete | 2026-04-28 |
| 7. DingTalk Auth Integration | 3/3 | Complete | 07-01, 07-02, 07-03 |
| 7. DingTalk Auth Integration | 3/3 | Complete | 2026-05-08 |
| 8. LemonGrid 预设与反推提示词集成 | 3/3 | Complete | 08-01, 08-02, 08-03 |
| 9. 接入LemonGrid的任务队列信息 | 0/2 | Planning | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 1 | Complete |
| CONF-03 | Phase 1 | Complete |
| CONF-04 | Phase 1 | Complete |
| CONF-05 | Phase 1 | Complete |
| CACH-01 | Phase 2 | Pending |
| CACH-02 | Phase 2 | Pending |
| CACH-03 | Phase 2 | Pending |
| CACH-04 | Phase 2 | Pending |
| CACH-05 | Phase 2 | Pending |
| INTG-01 | Phase 1 | Complete |
| INTG-02 | Phase 2 | Pending |
| INTG-03 | Phase 2 | Pending |
| PRESET-01 | Phase 4 | Pending |
| PRESET-02 | Phase 4 | Pending |
| PRESET-03 | Phase 4 | Pending |
| PRESET-04 | Phase 4 | Pending |
| PRESET-05 | Phase 4 | Pending |
| PRESET-06 | Phase 4 | Pending |
| PRESET-07 | Phase 4 | Pending |
| PRESET-08 | Phase 4 | Pending |
| D-01 | Phase 5 | Planned |
| D-02 | Phase 5 | Planned |
| D-03 | Phase 5 | Planned |
| D-04 | Phase 5 | Planned |
| D-05 | Phase 5 | Planned |
| D-06 | Phase 5 | Planned |
| D-07 | Phase 5 | Planned |
| D-08 | Phase 5 | Planned |
| D-09 | Phase 5 | Planned |
| D-10 | Phase 5 | Planned |
| D-11 | Phase 5 | Planned |
| D-12 | Phase 5 | Planned |
| D-13 | Phase 5 | Planned |
| D-14 | Phase 5 | Planned |
| D-15 | Phase 5 | Planned |
| PERF-01 | Phase 05.1 | Planned |
| PERF-02 | Phase 05.1 | Planned |
| PERF-03 | Phase 05.1 | Planned |
| PERF-04 | Phase 05.1 | Planned |
| PERF-05 | Phase 05.1 | Planned |
| PERF-06 | Phase 05.1 | Planned |
| PERF-07 | Phase 05.1 | Planned |
| D-01..D-29 | Phase 7 | Planned |
| Q-01 | Phase 9 | Planned |
| Q-02 | Phase 9 | Planned |
| Q-03 | Phase 9 | Planned |

**Coverage:** requirements mapped (100%)

### Phase 4: 工作流参数预设功能

**Goal:** 用户可以保存、管理当前工作流的参数预设，支持预设的新增、修改、删除、导入和导出操作，方便快速切换不同参数组合。

**Depends on:** Phase 1, Phase 2

**Requirements:** PRESET-01, PRESET-02, PRESET-03, PRESET-04, PRESET-05, PRESET-06, PRESET-07, PRESET-08

**Success Criteria** (what must be TRUE):
1. 用户可以为当前工作流保存一组参数作为预设（新增）
2. 用户可以修改已保存的预设参数（修改）
3. 用户可以删除不需要的预设（删除）
4. 用户可以导出预设到文件（导出）
5. 用户可以从文件导入预设（导入）
6. 用户可以快速在不同预设之间切换应用

**Plans:** 3 plans

Plans:
- [x] 04-01-PLAN.md — Types, Bridge handlers, service layer, Zustand store, and tests
- [x] 04-02-PLAN.md — UI components (PresetToolbar, ConfirmDialog) and Draw.tsx integration
- [ ] 04-03-PLAN.md — Human verification checkpoint

### Phase 5: 图片提示词反推功能

**Goal:** 用户右键点击任意图片，通过 DashScope Qwen VL API 分析图片内容生成中文自然语言描述性提示词，结果支持复制和填入提示词输入框。

**Depends on:** Phase 4

**Requirements:** D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-12, D-13, D-14, D-15

**Success Criteria** (what must be TRUE):
1. 用户可在任何页面右键点击图片触发"反推提示词"
2. 分步引导流程：预览确认 -> 模板选择 -> API 分析 -> 结果展示
3. 提供4种描述模板（详细/简洁/构图/风格分析）
4. 结果支持复制到剪贴板和填入提示词输入框
5. API Key 在设置页面管理，持久化存储
6. 网络请求自适应 UXP/Browser 环境

**Plans:** 4 plans

Plans:
- [x] 05-01-PLAN.md — DashScope API service and prompt templates
- [x] 05-02-PLAN.md — Settings store extension and DashScope config UI
- [x] 05-03-PLAN.md — Prompt reverse store, context menu, and provider component
- [x] 05-04-PLAN.md — Multi-step modal and full page integration

---

### Phase 05.1: Plugin Performance Fix

**Goal:** Fix three diagnosed root causes causing keyboard shortcut failures, UI freezing during image export/import, and slow uploads. Plus secondary wins: console.log cleanup, temp file cleanup, fs.listDownloads optimization.

**Depends on:** Phase 05

**Requirements:** PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06, PERF-07

**Success Criteria** (what must be TRUE):
1. PS keyboard shortcuts (Delete, Ctrl+Z, Ctrl+S, etc.) work when plugin webview has focus
2. Large image export/import does not freeze Photoshop UI
3. executeAsModal scope is minimized to only batchPlay calls
4. React list components use memoization to prevent cascading re-renders
5. No console.log statements remain in production main.js code
6. Temp export folders are cleaned up after export operations
7. fs.listDownloads returns file list without reading entire file contents

**Plans:** 3/3 plans complete

Plans:
- [x] 05.1-01-PLAN.md — Keyboard shortcut passthrough via Bridge (PERF-01)
- [x] 05.1-02-PLAN.md — Async base64 conversion and executeAsModal scope reduction (PERF-02, PERF-03)
- [x] 05.1-03-PLAN.md — React render optimization and secondary wins (PERF-04, PERF-05, PERF-06, PERF-07)

### Phase 6: LemonGrid Integration

**Goal:** Add "Cluster Mode" to the Photoshop ComfyUI Plugin that connects to LemonGrid's GPU cluster management platform. Users can switch between Direct Mode (existing single ComfyUI instance) and Cluster Mode (LemonGrid platform with multi-GPU scheduling). Cluster Mode uses LemonGrid's template system, JWT authentication, and task API.

**Depends on:** Phase 5

**Requirements:** D-01 through D-105 (decisions in 06-CONTEXT.md)

**Success Criteria** (what must be TRUE):
1. Users can toggle between Direct Mode and Cluster Mode in Settings
2. Cluster Mode authenticates via LemonGrid JWT login
3. Template list replaces workflow list in Cluster Mode
4. Parameters render dynamically from template param_schema
5. Tasks submit via LemonGrid API and track progress via WebSocket/polling
6. Results auto-download and import to PS layers
7. Mini task list shows all cluster tasks with state badges and actions
8. History panel has source filter for Direct/Cluster/All
9. Direct Mode remains completely unchanged

**Plans:** 3 plans

Plans:
- [x] 06-01-PLAN.md — Bridge handlers, stores, auth service, login modal, and Settings mode toggle
- [x] 06-02-PLAN.md — LemonGridClient service, template system, dynamic param UI, and preset integration
- [x] 06-03-PLAN.md — Mini task list, WebSocket progress, polling fallback, retry/cancel, and history filter

### Phase 7: DingTalk Auth Integration

**Goal:** 在 Photoshop 插件中接入钉钉 OAuth 扫码登录，与现有用户名/密码登录共存。插件复用 LemonGrid 后端已有的钉钉 OAuth 基础设施，适配 UXP 环境的特殊限制。

**Depends on:** Phase 6

**Requirements:** D-01 through D-29 (decisions in 07-CONTEXT.md)

**Success Criteria** (what must be TRUE):
1. LoginModal 显示钉钉扫码登录按钮，用户可切换密码/扫码两种登录方式
2. UXP 模式通过 qrcode.react 渲染 OAuth URL 二维码（iframe 尝试 + 回退）
3. 浏览器模式使用标准 redirect OAuth 流程
4. 扫码后轮询后端获取 JWT，自动完成登录
5. authProvider 字段追踪登录方式，影响 token 刷新行为
6. Settings 页显示当前登录方式（密码登录/钉钉登录）
7. 钉钉用户 token 过期后自动弹出二维码视图
8. 所有错误在二维码视图内显示，提供重试按钮

**Plans:** 3 plans

Plans:
- [x] 07-01-PLAN.md — Store authProvider field + DingTalk OAuth service functions + ensureValidToken routing
- [x] 07-02-PLAN.md — DingTalkQRView component (iframe + qrcode.react) + LoginModal integration + CSS
- [x] 07-03-PLAN.md — Settings login method display + smart modal on mode switch + integration verification

---

*Roadmap created: 2026-03-11*
*Last updated: 2026-05-20 - Phase 09 planned (2 plans)*
