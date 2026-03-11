# Requirements: Photoshop ComfyUI Plugin

**Defined:** 2026-03-11
**Core Value:** 让用户在 Photoshop 中无缝使用 ComfyUI 的 AI 图像生成能力

## v1 Requirements

### Configuration

- [x] **CONF-01**: 用户可以通过 JSON 配置文件指定要显示的节点
- [x] **CONF-02**: 配置文件与插件安装文件放在一起
- [x] **CONF-03**: 用户在配置文件中指定节点名称（class_type）
- [ ] **CONF-04**: 插件根据配置动态渲染节点的参数输入组件
- [ ] **CONF-05**: 未配置的节点使用工作流中的默认值

### Caching

- [ ] **CACH-01**: 用户修改的参数值自动缓存到本地文件
- [ ] **CACH-02**: 缓存按工作流分别存储（每个工作流独立的参数缓存）
- [ ] **CACH-03**: 用户打开工作流时自动加载上次缓存的参数值
- [ ] **CACH-04**: 缓存文件通过 Bridge API 写入本地文件系统
- [ ] **CACH-05**: 缓存数据包含节点参数的完整状态

### Integration

- [x] **INTG-01**: 配置解析与现有 ComfyUI 客户端集成
- [ ] **INTG-02**: 缓存机制与现有 Zustand store 集成
- [ ] **INTG-03**: Bridge 层扩展支持文件读写操作

## v2 Requirements

(Deferred to future release)

- **CONF-06**: UI 界面配置节点（无需手动编辑 JSON）
- **CACH-06**: 缓存版本管理与迁移

## Out of Scope

| Feature | Reason |
|---------|--------|
| OAuth 认证 | ComfyUI 依赖网络级访问控制 |
| 移动端支持 | 仅支持 Photoshop 桌面版 |
| 云端同步缓存 | 增加复杂度，本地文件足够 |
| 多用户配置 | 插件为单用户场景 |

## Traceability

(Updated during roadmap creation)

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

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0
- Complete: 4 (CONF-01, CONF-02, CONF-03, INTG-01)

---
*Requirements defined: 2026-03-11*
*Last updated: 2026-03-11 after plan 01-02 completion*
