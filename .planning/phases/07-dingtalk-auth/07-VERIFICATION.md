---
phase: 07-dingtalk-auth
verified: 2026-05-09T12:00:00Z
status: human_needed
score: 15/15 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open plugin in Photoshop UXP, click DingTalk button, verify QR code renders and scanning completes login"
    expected: "QR code appears in LoginModal, scanning with DingTalk app completes OAuth and logs in user"
    why_human: "Requires running UXP environment with backend connectivity"
  - test: "Open plugin in browser (non-UXP), click DingTalk button, verify browser redirects to DingTalk OAuth"
    expected: "Browser redirects to DingTalk login page, then back to app callback"
    why_human: "Requires running backend server with DingTalk OAuth configured"
  - test: "Let DingTalk user session expire, verify modal opens with QR view instead of password form"
    expected: "LoginModal opens directly to DingTalk QR view, not password form"
    why_human: "Requires active session with token expiry in real environment"
  - test: "Verify Settings page shows login method badge after DingTalk login"
    expected: "Settings shows '钉钉登录' badge next to username when logged in via DingTalk"
    why_human: "Visual verification requires running application"
---

# Phase 7: DingTalk Auth Integration Verification Report

**Phase Goal:** Integrate DingTalk OAuth login as a second authentication method alongside existing password login, supporting both browser (redirect) and UXP plugin (QR code) environments.
**Verified:** 2026-05-09T12:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

Derived from ROADMAP.md Success Criteria (8 items) + PLAN must_haves (15 items merged, deduplicated):

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | LoginModal displays DingTalk scan login button with view switching between password/QR modes (ROADMAP SC-1) | VERIFIED | `LoginModal.tsx:29-30` loginView state, `LoginModal.tsx:293-303` DingTalk button, `LoginModal.tsx:307-329` QR view conditional rendering |
| 2 | UXP mode renders OAuth URL as QR code via iframe attempt + qrcode.react fallback (ROADMAP SC-2) | VERIFIED | `DingTalkQRView.tsx:205-221` iframe rendering with sandbox, `DingTalkQRView.tsx:152-165` 5s iframe timeout, `DingTalkQRView.tsx:224-237` QRCodeSVG fallback |
| 3 | Browser mode uses standard redirect OAuth flow (ROADMAP SC-3) | VERIFIED | `LoginModal.tsx:87-97` isUXPWebView() check, `LoginModal.tsx:90-91` getDingTalkLoginUrl('redirect') + window.location.href redirect |
| 4 | Scanning triggers polling for JWT and auto-completes login (ROADMAP SC-4) | VERIFIED | `DingTalkQRView.tsx:60-74` pollDingTalkAuth called, `DingTalkQRView.tsx:66-68` loginWithDingTalk on success, `lemongrid-auth.ts:397-431` loginWithDingTalk stores JWT |
| 5 | authProvider field tracks login method and affects token refresh behavior (ROADMAP SC-5) | VERIFIED | `lemongridStore.ts:51` authProvider field, `lemongridStore.ts:98` default null, `lemongridStore.ts:109` setAuth defaults to 'password', `lemongrid-auth.ts:492-495` ensureValidToken dingtalk routing |
| 6 | Settings page displays current login method (ROADMAP SC-6) | VERIFIED | `Settings.tsx:27` lgAuthProvider selector, `Settings.tsx:308-312` conditional badge rendering with Chinese text |
| 7 | DingTalk user token expiry auto-opens QR code view (ROADMAP SC-7) | VERIFIED | `lemongrid-auth.ts:492-494` AUTH_EXPIRED_DINGTALK thrown, `lemongrid-auth.ts:493` setShowLoginModal(true), `LoginModal.tsx:44-49` auto-sets dingtalk view when authProvider is dingtalk and token expired |
| 8 | All errors display inside QR view with retry button (ROADMAP SC-8) | VERIFIED | `DingTalkQRView.tsx:82-99` error handling in poll catch, `DingTalkQRView.tsx:187-203` error phase renders retry button, `LoginModal.tsx:323-325` onError callback only logs |
| 9 | lemongridStore authProvider field persists across sessions via Zustand migration (PLAN 01 must-have) | VERIFIED | `lemongridStore.ts:177-212` persist config with partialize including authProvider, `lemongridStore.ts:180-199` migrate function handles v1->v2 |
| 10 | getDingTalkLoginUrl returns auth_url and state from backend (PLAN 01 must-have) | VERIFIED | `lemongrid-auth.ts:341-351` function implemented with lemongridFetch to /api/v1/auth/dingtalk/login-url |
| 11 | pollDingTalkAuth polls every 2s with 5-min timeout (PLAN 01 must-have) | VERIFIED | `lemongrid-auth.ts:364` intervalMs default 2000, `lemongrid-auth.ts:365` timeoutMs default 300000 |
| 12 | loginWithDingTalk stores JWT and sets authProvider to dingtalk (PLAN 01 must-have) | VERIFIED | `lemongrid-auth.ts:408-416` setAuth + setAuthProvider('dingtalk'), clears password storage |
| 13 | clearAuth resets authProvider to null (PLAN 01 must-have) | VERIFIED | `lemongridStore.ts:120` authProvider: null in clearAuth |
| 14 | DingTalk button below password form with divider, QR view has back link (PLAN 02 must-have) | VERIFIED | `LoginModal.tsx:290-303` divider + button, `LoginModal.tsx:309-318` back link to password form |
| 15 | QR code auto-refreshes after 3 minutes (PLAN 02 must-have) | VERIFIED | `DingTalkQRView.tsx:103-108` setTimeout 180000ms triggers refreshKey increment |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `code/webapp/src/stores/lemongridStore.ts` | authProvider field with v1->v2 migration | VERIFIED | Lines 51, 98, 109, 120, 175, 179, 196, 211 -- field, default, setAuth default, clearAuth, action, version, migration, partialize |
| `code/webapp/src/services/lemongrid-auth.ts` | DingTalk OAuth service functions + auth-aware ensureValidToken | VERIFIED | Lines 341-351 getDingTalkLoginUrl, 359-390 pollDingTalkAuth, 397-431 loginWithDingTalk, 492-495 AUTH_EXPIRED_DINGTALK routing |
| `code/webapp/src/components/DingTalkQRView.tsx` | QR code display with iframe + qrcode.react fallback | VERIFIED | 241 lines, substantive implementation with all phases (loading/iframe/qrcode/error/success), polling lifecycle, auto-refresh |
| `code/webapp/src/components/LoginModal.tsx` | Login modal with view switching | VERIFIED | Lines 29-30 loginView state, 44-49 auto dingtalk view, 80-102 DingTalk handler, 290-329 DingTalk UI elements |
| `code/webapp/src/components/LoginModal.css` | DingTalk-specific styles | VERIFIED | Lines 132-201 -- dingtalk-divider, dingtalk-btn (#0089FF), dingtalk-icon, dingtalk-qrcode-view, dingtalk-back-link |
| `code/webapp/src/pages/Settings.tsx` | Login method display | VERIFIED | Line 27 lgAuthProvider selector, lines 308-312 conditional badge rendering |
| `code/webapp/src/pages/Settings.css` | Auth method badge styling | VERIFIED | Lines 451-458 .lg-auth-method CSS class |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| LoginModal.tsx | DingTalkQRView.tsx | import and render | WIRED | `import { DingTalkQRView } from './DingTalkQRView'` at line 4, rendered at line 319 |
| DingTalkQRView.tsx | lemongrid-auth.ts | getDingTalkLoginUrl, pollDingTalkAuth, loginWithDingTalk | WIRED | Lines 3-7 imports all three functions, used in useEffect and handlers |
| lemongrid-auth.ts | lemongridStore.ts | useLemonGridStore.getState().authProvider | WIRED | Line 4 imports store, line 492 reads authProvider, line 403 reads state, lines 408-416 call actions |
| LoginModal.tsx | lemongridStore.ts | authProvider state read | WIRED | Line 30 reads authProvider, line 31 reads tokenExpiresAt for auto-view logic |
| Settings.tsx | lemongridStore.ts | authProvider state read | WIRED | Line 27 lgAuthProvider selector, line 32 setShowLoginModal |
| ensureValidToken | LoginModal | AUTH_EXPIRED_DINGTALK + setShowLoginModal | WIRED | lemongrid-auth.ts:493 setShowLoginModal(true), LoginModal.tsx:44-49 reads authProvider to set dingtalk view |
| Settings.tsx | LoginModal.tsx | showLoginModal prop | WIRED | Lines 31-32 read showLoginModal/setShowLoginModal, line 413-417 render LoginModal with props |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| DingTalkQRView.tsx | authUrl, authState | getDingTalkLoginUrl API response | Dynamic from backend | FLOWING (pending backend) |
| DingTalkQRView.tsx | pollResult | pollDingTalkAuth API response | Dynamic from backend | FLOWING (pending backend) |
| Settings.tsx | lgAuthProvider | lemongridStore.authProvider | Persisted store state | FLOWING |
| LoginModal.tsx | loginView | Derived from authProvider + tokenExpiresAt | Store-driven | FLOWING |
| lemongrid-auth.ts | AUTH_EXPIRED_DINGTALK | ensureValidToken check on authProvider | Store-driven | FLOWING |

Note: DingTalk OAuth functions depend on backend endpoints (login-url, poll, callback) that are documented in 07-RESEARCH.md for implementation in the separate LemonGrid backend repo. The frontend code is correctly wired to call these endpoints.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compilation | `cd code/webapp && npx tsc --noEmit` | Clean, no errors | PASS |
| qrcode.react in dependencies | `grep "qrcode.react" package.json` | "qrcode.react": "^4.2.0" found | PASS |
| authProvider occurrences in store | `grep -c "authProvider" lemongridStore.ts` | 8 occurrences | PASS |
| DingTalk service exports | `grep -c "export async function" lemongrid-auth.ts` | Multiple exports including 3 DingTalk functions | PASS |
| AUTH_EXPIRED_DINGTALK in auth | `grep -c "AUTH_EXPIRED_DINGTALK" lemongrid-auth.ts` | 1 occurrence | PASS |
| Store version 2 | `grep "version: 2" lemongridStore.ts` | Found | PASS |
| Commit 6742490 exists | `git log --oneline \| grep 6742490` | Found | PASS |
| Commit 9d87a46 exists | `git log --oneline \| grep 9d87a46` | Found | PASS |
| Commit 809ce96 exists | `git log --oneline \| grep 809ce96` | Found | PASS |
| Commit 9945b3f exists | `git log --oneline \| grep 9945b3f` | Found | PASS |
| Commit 742a830 exists | `git log --oneline \| grep 742a830` | Found | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| D-01 | 07-01 | iframe loads DingTalk QR login page | VERIFIED (deviation) | DingTalkQRView.tsx loads backend-generated OAuth2 auth URL in iframe. Deviation: uses NEW OAuth2 URL instead of old sns iframe page. Justified in RESEARCH.md and 07-02-PLAN.md |
| D-02 | 07-01 | DingTalk callback to backend, backend stores JWT in Redis | VERIFIED (frontend) | Backend responsibility. Frontend calls /api/v1/auth/dingtalk/poll correctly |
| D-03 | 07-01 | Plugin polls backend poll endpoint for JWT | VERIFIED | lemongrid-auth.ts:359-390 pollDingTalkAuth polls GET /api/v1/auth/dingtalk/poll?state=xxx |
| D-04 | 07-01, 07-02 | Risk mitigation: iframe fallback to qrcode.react | VERIFIED | DingTalkQRView.tsx:152-165 5s iframe timeout, line 148 fallback to qrcode phase, lines 224-237 QRCodeSVG rendering |
| D-05 | 07-01 | iframe loads via UXP WebView directly (HTTPS) | VERIFIED | DingTalkQRView.tsx:208-218 iframe with src={authUrl}, no Bridge proxy |
| D-06 | 07-02 | LoginModal: divider + DingTalk button below password form | VERIFIED | LoginModal.tsx:290-303 dingtalk-divider with "或" span + dingtalk-btn with SVG icon |
| D-07 | 07-02 | Click DingTalk -> replace password form with QR view; back link | VERIFIED | LoginModal.tsx:99-100 setLoginView('dingtalk'), lines 309-318 back link |
| D-08 | 07-02 | New users see full LoginModal (password + DingTalk button) | VERIFIED | LoginModal.tsx:48-49 default to 'password' view, DingTalk button always visible in password view |
| D-09 | 07-02 | iframe width 100%, height 320px | VERIFIED | DingTalkQRView.tsx:210-211 width="100%" height="320px" |
| D-10 | 07-02 | QR auto-refresh after 3 minutes | VERIFIED | DingTalkQRView.tsx:103-108 setTimeout(180000) triggers refreshKey increment |
| D-11 | 07-01 | Poll interval 2s, timeout 5min | VERIFIED | lemongrid-auth.ts:364 interval 2000, line 365 timeout 300000 |
| D-12 | 07-02 | Poll timeout shows expiry message with refresh | VERIFIED | DingTalkQRView.tsx:83-84 POLL_TIMEOUT shows "登录超时，请重试", line 199 retry button "重新获取". D-12 says "二维码已过期" but D-28 says "登录超时，请重试" -- implementation follows D-28 with retry action satisfying D-12 intent |
| D-13 | 07-01 | authProvider field: 'password' \| 'dingtalk' \| null | VERIFIED | lemongridStore.ts:51 type definition, line 98 default null |
| D-14 | 07-01, 07-02 | OAuth user expired token -> auto show QR view | VERIFIED | lemongrid-auth.ts:492-494 AUTH_EXPIRED_DINGTALK, LoginModal.tsx:44-49 auto-set dingtalk view |
| D-15 | 07-01 | ensureValidToken routes dingtalk users to QR, password to re-login | VERIFIED | lemongrid-auth.ts:492-495 dingtalk check before password re-login block |
| D-16 | 07-01 | Logout clears local state only, not DingTalk session | VERIFIED | lemongridStore.ts:112-123 clearAuth resets all auth fields including authProvider, no DingTalk API call |
| D-17 | 07-01 | Backend GET /api/v1/auth/dingtalk/poll endpoint | VERIFIED (frontend) | Frontend calls this endpoint correctly at lemongrid-auth.ts:367. Backend implementation is separate repo responsibility |
| D-18 | 07-01 | Backend callback stores JWT in Redis | VERIFIED (frontend) | Backend responsibility. Frontend flow correctly polls for result |
| D-19 | 07-01 | Backend login-url supports redirect_mode parameter | VERIFIED (frontend) | lemongrid-auth.ts:345 passes redirect_mode in query param |
| D-20 | 07-01, 07-02 | Dual mode: browser redirect, UXP QR code | VERIFIED | LoginModal.tsx:87-97 isUXPWebView() branches: browser -> redirect, UXP -> QR view |
| D-21 | 07-02 | Browser mode uses native fetch and window.location | VERIFIED | LoginModal.tsx:90-91 getDingTalkLoginUrl('redirect') then window.location.href = auth_url |
| D-22 | 07-01 | DingTalk login stores display_name as username | VERIFIED | lemongrid-auth.ts:406 display_name || username fallback |
| D-23 | 07-03 | Settings shows login method (display only, no unbind) | VERIFIED | Settings.tsx:308-312 conditional badge, no unbind button found |
| D-24 | 07-03 | Mode switch: dingtalk expired -> smart modal with QR view | VERIFIED | Settings.tsx:139-143 handleModeChange calls ensureValidToken, catch opens LoginModal, LoginModal reads authProvider to show QR view |
| D-25 | 07-02 | DingTalk service unavailable error | VERIFIED | DingTalkQRView.tsx:94-97 general error case shows backend error message |
| D-26 | 07-02 | User cancelled authorization error | VERIFIED | DingTalkQRView.tsx:94-97 general error case, backend returns error message for cancelled auth |
| D-27 | 07-02 | Network error -> retry button | VERIFIED | DingTalkQRView.tsx:87-93 NetworkError/Failed to fetch detection -> "网络连接失败", line 199 retry button |
| D-28 | 07-02 | Poll timeout -> "登录超时，请重试" | VERIFIED | DingTalkQRView.tsx:83-84 POLL_TIMEOUT -> "登录超时，请重试" |
| D-29 | 07-02 | All errors in QR view, not password form | VERIFIED | DingTalkQRView.tsx:82-99 errors set phase='error' with message, LoginModal.tsx:323-325 onError only console.warn |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| DingTalkQRView.tsx | 239 | `return null` fallback | Info | Defensive fallback when authUrl is empty before first fetch completes. Not a stub -- all phases have substantive rendering |
| DingTalkQRView.tsx | 132 | eslint-disable comment | Info | Disabled react-hooks/exhaustive-deps for useEffect with startAuth callback. Acceptable -- startAuth is not a stable reference |

No blocker or warning anti-patterns found. No TODO/FIXME/PLACEHOLDER markers in any modified files. No empty implementations or hardcoded empty data flows.

### Human Verification Required

### 1. DingTalk QR Login in UXP Environment

**Test:** Open plugin in Photoshop, navigate to Settings, switch to Cluster Mode, click "钉钉扫码登录" button
**Expected:** LoginModal opens, DingTalk QR code renders (either via iframe or qrcode.react fallback), user scans with DingTalk app, login completes
**Why human:** Requires running Photoshop UXP environment with backend connectivity

### 2. Browser Redirect OAuth Flow

**Test:** Open plugin in browser (non-UXP), click DingTalk button
**Expected:** Browser redirects to DingTalk OAuth page, user authorizes, redirected back to app with JWT
**Why human:** Requires running backend server with DingTalk OAuth app configured

### 3. Token Expiry Auto-Show QR View

**Test:** Log in via DingTalk, wait for token to expire (or simulate), trigger an authenticated action
**Expected:** LoginModal opens directly showing DingTalk QR code view, not password form
**Why human:** Requires real session with token expiry in running environment

### 4. Settings Login Method Badge

**Test:** Log in via DingTalk, navigate to Settings page in Cluster Mode
**Expected:** Settings shows username, role, and "钉钉登录" badge
**Why human:** Visual verification requires running application

### Gaps Summary

No code gaps found. All 15 must-have truths are verified through codebase evidence. All 29 requirements (D-01 through D-29) have corresponding implementation evidence in the frontend codebase.

Key notes:
- D-01 has a documented deviation: implementation uses the NEW OAuth2 auth URL from the backend instead of the old sns iframe URL specified in D-01. This is justified by RESEARCH.md finding that the old URL is incompatible with the backend's new OAuth2 API. The intent (display DingTalk QR in plugin) is preserved.
- D-12/D-28 wording: D-12 says "二维码已过期" but D-28 says "登录超时，请重试". Implementation follows D-28 wording with a retry button satisfying D-12's "click to refresh" intent.
- D-17, D-18, D-19 are backend requirements. Frontend correctly calls these endpoints; backend implementation is out of scope (separate repo).
- Human verification is required for 4 items that need a running environment (UXP Photoshop, backend server, DingTalk OAuth configuration).

---

_Verified: 2026-05-09T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
