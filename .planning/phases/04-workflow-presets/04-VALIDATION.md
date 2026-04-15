---
phase: 4
slug: workflow-presets
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | code/webapp/vitest.config.ts |
| **Quick run command** | `cd code/webapp && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd code/webapp && npx vitest run --coverage` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd code/webapp && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd code/webapp && npx vitest run --coverage`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | SC-1 | T-4-01 | Sanitize preset filenames | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | ❌ W0 | ⬜ pending |
| 4-01-02 | 01 | 1 | SC-1 | — | Create preset file via Bridge | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | ❌ W0 | ⬜ pending |
| 4-02-01 | 02 | 1 | SC-2 | — | Update preset data | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | ❌ W0 | ⬜ pending |
| 4-02-02 | 02 | 1 | SC-3 | — | Delete preset with confirm | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | ❌ W0 | ⬜ pending |
| 4-03-01 | 03 | 2 | SC-4 | T-4-02 | Export preset file | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | ❌ W0 | ⬜ pending |
| 4-03-02 | 03 | 2 | SC-5 | T-4-03 | Import preset with conflict handling | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | ❌ W0 | ⬜ pending |
| 4-04-01 | 04 | 2 | SC-6 | — | Switch preset applies values | unit | `cd code/webapp && npx vitest run src/stores/presetStore.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `code/webapp/src/services/__tests__/preset.test.ts` — stubs for preset CRUD
- [ ] `code/webapp/src/stores/__tests__/presetStore.test.ts` — stubs for store actions
- [ ] Existing vitest infrastructure covers framework needs

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Preset dropdown renders correctly in Draw.tsx | SC-6 | Requires visual verification in Photoshop UXP | Select different presets, verify values update |
| Import file picker dialog opens | SC-5 | UXP native file picker behavior | Click import, select file, verify dialog appears |
| Unsaved changes confirmation dialog | SC-6/D-08 | Modal dialog interaction | Modify params, switch preset, verify confirmation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
