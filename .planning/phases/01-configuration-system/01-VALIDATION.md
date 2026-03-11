---
phase: 1
slug: configuration-system
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
updated: 2026-03-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | vite.config.ts (defaults) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-00-01 | 00 | 0 | WAVE-0 | scaffold | `npx vitest run config.test.ts --passWithNoTests` | W0 creates | pending |
| 1-00-02 | 00 | 0 | WAVE-0 | scaffold | `npx vitest run configStore.test.ts --passWithNoTests` | W0 creates | pending |
| 1-01-01 | 01 | 1 | CONF-02 | code-check | `grep -q "'fs.readPluginConfig'" PS-plugin/ningleai/main.js` | N/A | pending |
| 1-01-02 | 01 | 1 | CONF-03 | json-valid | `node -e "JSON.parse(...)"` | N/A | pending |
| 1-02-01 | 02 | 2 | CONF-01 | unit | `npx vitest run config.test.ts` | W0 creates | pending |
| 1-02-02 | 02 | 2 | INTG-01 | unit | `npx vitest run configStore.test.ts` | W0 creates | pending |
| 1-03-01 | 03 | 3 | CONF-04 | build | `npm run build` | N/A | pending |
| 1-03-02 | 03 | 3 | CONF-05 | build | `npm run build` | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `code/webapp/src/services/config.test.ts` — unit tests for config loading service (Wave 0 plan creates scaffold)
- [x] `code/webapp/src/stores/configStore.test.ts` — unit tests for Zustand store behavior (Wave 0 plan creates scaffold)
- [x] Mock bridge handler for testing — included in test scaffolds

*Existing infrastructure (Vitest, testing-library) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Config file read from plugin folder | CONF-02 | Requires UXP runtime | 1. Create node-config.json in plugin folder 2. Start plugin in Photoshop 3. Verify nodes are filtered |
| UI renders filtered inputs | CONF-04 | Visual verification | 1. Load workflow with multiple nodes 2. Verify only configured nodes show 3. Verify correct inputs displayed |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
