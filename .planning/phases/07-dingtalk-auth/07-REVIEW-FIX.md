---
phase: "07-dingtalk-auth"
fixed_at: "2026-05-09T14:30:00Z"
review_path: ".planning/phases/07-dingtalk-auth/07-REVIEW.md"
iteration: 1
findings_in_scope: 4
fixed: 3
skipped: 1
status: partial
---

# Phase 07: Code Review Fix Report

**Fixed at:** 2026-05-09T14:30:00Z
**Source review:** .planning/phases/07-dingtalk-auth/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4
- Fixed: 3
- Skipped: 1

## Fixed Issues

### CR-02: iframe sandbox combines allow-scripts + allow-same-origin, negating sandbox protection

**Files modified:** `code/webapp/src/components/DingTalkQRView.tsx`
**Commit:** e716dd3
**Applied fix:** Removed `allow-same-origin` from the iframe sandbox attribute. The sandbox now reads `"allow-scripts allow-forms allow-popups"`, which prevents the embedded DingTalk OAuth page from escaping sandbox restrictions or accessing the parent context's DOM and localStorage.

### HI-01: setAuth always overwrites authProvider to 'password', causing race with setAuthProvider('dingtalk')

**Files modified:** `code/webapp/src/stores/lemongridStore.ts`, `code/webapp/src/services/lemongrid-auth.ts`
**Commit:** b93d1dc
**Applied fix:** Added an optional `provider` parameter to the `setAuth` action interface and implementation. The default value is `'password'` (backward compatible). Updated `loginWithDingTalk` in `lemongrid-auth.ts` to pass `'dingtalk'` as the provider directly to `setAuth`, eliminating the separate `setAuthProvider('dingtalk')` call. This ensures `authProvider` is set atomically during auth state updates and cannot be accidentally overwritten by `ensureValidToken` re-login or token refresh flows.

### HI-02: pollDingTalkAuth setTimeout not abort-aware

**Files modified:** `code/webapp/src/services/lemongrid-auth.ts`
**Commit:** b8cfa8c
**Applied fix:** Replaced the plain `setTimeout(resolve, interval)` with an abort-aware delay. The new implementation listens for the AbortSignal's `abort` event, clears the timeout timer, and rejects the promise with `'POLL_CANCELLED'`. This ensures the poll loop terminates immediately when the DingTalkQRView component unmounts, rather than waiting up to 2 seconds for the next loop iteration.

## Skipped Issues

### CR-01: Hardcoded encryption key material defeats purpose of password encryption

**File:** `code/webapp/src/services/lemongrid-auth.ts:49-50`
**Reason:** Pre-existing issue -- the hardcoded encryption salt and key material existed before phase 07. The REVIEW.md fix suggests architectural changes (OS keychain, per-device secret, storing refresh tokens instead of passwords) that are out of scope for a code review fix. Modifying the encryption approach requires a design decision and would affect all existing stored credentials. Acknowledged as a known limitation; should be addressed in a dedicated follow-up task.
**Original issue:** The "Remember Me" password encryption uses hardcoded salt and key material, meaning anyone with access to the source code or bundled JavaScript can decrypt stored passwords.

---

_Fixed: 2026-05-09T14:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
