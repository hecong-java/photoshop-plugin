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

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Configuration System | 4/5 | In progress | 01-00, 01-01, 01-02, 01-03 |
| 2. Local Caching | 0/1 | Not started | - |
| 3. Integration & Testing | 0/1 | Not started | - |
| 4. 工作流参数预设功能 | 0/3 | Not started | - |

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

**Coverage:** 21/21 requirements mapped (100%)

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
- [ ] 04-01-PLAN.md — Types, Bridge handlers, service layer, Zustand store, and tests
- [ ] 04-02-PLAN.md — UI components (PresetToolbar, ConfirmDialog) and Draw.tsx integration
- [ ] 04-03-PLAN.md — Human verification checkpoint

---

*Roadmap created: 2026-03-11*
*Last updated: 2026-04-15 - Phase 4 planned: 3 plans across 3 waves*
