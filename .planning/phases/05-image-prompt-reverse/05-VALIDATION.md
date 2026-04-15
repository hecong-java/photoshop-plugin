---
phase: 05
slug: image-prompt-reverse
status: draft
nyquist_compliant: true
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

> Actual structure: 4 plans, 5 tasks. Plans 01-02 are fully TDD with unit tests.
> Plans 03-04 contain UI components (ContextMenu, PromptReverseProvider, PromptReverseFlow)
> verified by TypeScript compilation (`tsc --noEmit`) plus manual browser testing.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | D-04/D-05/D-06/D-07/D-09/D-14/D-15 | T-05-01/T-05-02/T-05-03 | API key not logged; base64 sanitized | unit (tdd) | `cd code/webapp && npx vitest run src/services/__tests__/dashscope.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | D-13 | T-05-04/T-05-05 | API key stored securely; type=password input | unit (tdd) | `cd code/webapp && npx vitest run src/stores/__tests__/settingsStore.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 2 | D-02/D-11/D-12 | — | State machine handles abort correctly | unit (tdd) | `cd code/webapp && npx vitest run src/stores/__tests__/promptReverseStore.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 05-03-02 | 03 | 2 | D-01/D-03 | — | Context menu renders on image right-click | type-check + manual | `cd code/webapp && npx tsc --noEmit --project tsconfig.json` | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 3 | D-08/D-15 | T-05-08 | Modal displays result; no XSS (no dangerouslySetInnerHTML) | type-check + manual | `cd code/webapp && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 05-04-02 | 04 | 3 | D-10 | — | onFillPrompt callback wired from Draw.tsx to PromptReverseFlow | type-check + manual | `cd code/webapp && npx tsc --noEmit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Nyquist Compliance Justification

`nyquist_compliant: true` — The phase has automated unit test coverage for all non-trivial logic:

- **Plan 01 (DashScope service):** 12 TDD unit tests covering API client, image conversion, prompt templates, security (API key not leaked)
- **Plan 02 (Settings store):** 4 TDD unit tests covering DashScope config state, persistence
- **Plan 03 Task 1 (promptReverseStore):** 10 TDD unit tests covering state machine transitions, abort behavior

The remaining 3 tasks (05-03-02, 05-04-01, 05-04-02) are UI components (ContextMenu, PromptReverseProvider, PromptReverseFlow) and page integration wiring. These are DOM-heavy components requiring jsdom mocking of contextmenu events, canvas API, and clipboard API. The value of unit tests for these is marginal because:

1. Their logic is trivially derived from tested stores and services
2. TypeScript compilation (`tsc --noEmit`) validates contract correctness between components
3. Manual browser verification is required regardless (right-click behavior, modal appearance, clipboard)
4. These are listed in Manual-Only Verifications below

---

## Wave 0 Requirements

- [ ] `code/webapp/src/services/__tests__/dashscope.test.ts` — stubs for DashScope API client
- [ ] `code/webapp/src/stores/__tests__/settingsStore.test.ts` — extend for DashScope settings
- [ ] `code/webapp/src/stores/__tests__/promptReverseStore.test.ts` — stubs for prompt reverse store

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Right-click context menu appears on images | D-01/D-03 | Requires browser DOM interaction (contextmenu event) | Right-click on image in Draw/History page, verify menu item appears |
| Context menu dismisses on click outside, Escape, scroll | D-01 | Requires browser interaction | Open context menu, click outside / press Escape / scroll, verify menu closes |
| PromptReverseProvider extracts image to base64 on menu action | D-11/D-12 | Requires browser canvas API | Right-click image, click "反推提示词", verify preview appears in modal |
| API call returns valid Chinese description | D-05/D-07 | Requires live API key | Set API key in Settings, trigger reverse on test image, verify Chinese output |
| Fill prompt inserts into Draw input | D-10 | Requires full page interaction | After reverse result, click "Fill prompt", verify text appears in Draw input |
| Copy button copies result to clipboard | D-08 | Requires browser clipboard API | After reverse result, click "复制到剪贴板", paste elsewhere to verify |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
