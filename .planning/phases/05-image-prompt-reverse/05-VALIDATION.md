---
phase: 05
slug: image-prompt-reverse
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `code/webapp/vitest.config.ts` |
| **Quick run command** | `cd code/webapp && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd code/webapp && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd code/webapp && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd code/webapp && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | D-04/D-05 | T-05-01 | API key not logged; base64 sanitized | unit | `cd code/webapp && npx vitest run` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | D-06/D-07 | — | Response format validated | unit | `cd code/webapp && npx vitest run` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | D-13 | — | API key stored securely | unit | `cd code/webapp && npx vitest run` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 1 | D-01/D-02/D-03 | — | Context menu renders on image right-click | unit | `cd code/webapp && npx vitest run` | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 2 | D-08/D-09/D-10 | — | Modal displays result; copy/fill buttons work | unit | `cd code/webapp && npx vitest run` | ❌ W0 | ⬜ pending |
| 05-05-01 | 05 | 2 | D-15 | — | Template selection applies correct prompt | unit | `cd code/webapp && npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `code/webapp/src/services/__tests__/dashscope.test.ts` — stubs for DashScope API client
- [ ] `code/webapp/src/stores/__tests__/settingsStore.test.ts` — extend for DashScope settings
- [ ] `code/webapp/src/components/__tests__/PromptReverseModal.test.tsx` — stubs for modal component

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Right-click context menu appears on images | D-01 | Requires browser interaction | Right-click on image in Draw/History page, verify menu item appears |
| API call returns valid Chinese description | D-05/D-07 | Requires live API key | Set API key in Settings, trigger reverse on test image, verify Chinese output |
| Fill prompt inserts into Draw input | D-10 | Requires full page interaction | After reverse result, click "Fill prompt", verify text appears in Draw input |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
