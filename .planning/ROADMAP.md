# Roadmap: Photoshop ComfyUI Plugin

**Created:** 2026-03-11
**Granularity:** Standard
**Core Value:** 让用户在 Photoshop 中无缝使用 ComfyUI 的 AI 图像生成能力

---

## Phases

- [ ] **Phase 1: Configuration System** - JSON config parsing and dynamic node display
- [ ] **Phase 2: Local Caching** - Parameter caching to local files
- [ ] **Phase 3: Integration & Testing** - Full integration testing and refinement

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
- [ ] 01-03-PLAN.md — UI integration in Draw.tsx
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
| 1. Configuration System | 3/5 | In progress | 01-00, 01-01, 01-02 |
| 2. Local Caching | 0/1 | Not started | - |
| 3. Integration & Testing | 0/1 | Not started | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 1 | Complete |
| CONF-03 | Phase 1 | Complete |
| CONF-04 | Phase 1 | Pending |
| CONF-05 | Phase 1 | Pending |
| CACH-01 | Phase 2 | Pending |
| CACH-02 | Phase 2 | Pending |
| CACH-03 | Phase 2 | Pending |
| CACH-04 | Phase 2 | Pending |
| CACH-05 | Phase 2 | Pending |
| INTG-01 | Phase 1 | Complete |
| INTG-02 | Phase 2 | Pending |
| INTG-03 | Phase 2 | Pending |

**Coverage:** 13/13 requirements mapped (100%)

---

*Roadmap created: 2026-03-11*
*Last updated: 2026-03-11 - Plans 01-00, 01-01, 01-02 complete*
