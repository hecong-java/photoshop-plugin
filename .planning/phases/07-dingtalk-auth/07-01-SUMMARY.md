---
phase: 07-dingtalk-auth
plan: 01
subsystem: auth
tags: [dingtalk, oauth, zustand, jwt, polling]

# Dependency graph
requires:
  - phase: 06-lemongrid-integration
    provides: lemongridStore with auth state, lemongrid-auth service with ensureValidToken
provides:
  - authProvider field in lemongridStore with Zustand persist migration v1->v2
  - getDingTalkLoginUrl service function for backend OAuth URL retrieval
  - pollDingTalkAuth service function with 2s interval, 5min timeout, AbortSignal cancellation
  - loginWithDingTalk service function to store JWT and set authProvider='dingtalk'
  - AUTH_EXPIRED_DINGTALK error in ensureValidToken for dingtalk user routing
affects: [07-dingtalk-auth, lemongridStore, LoginModal, Settings]

# Tech tracking
tech-stack:
  added: []
  patterns: [auth-provider-tracking, dingtalk-oauth-poll, zustand-store-migration]

key-files:
  created: []
  modified:
    - code/webapp/src/stores/lemongridStore.ts
    - code/webapp/src/services/lemongrid-auth.ts

key-decisions:
  - "setAuth defaults authProvider to 'password' so existing callers are unaffected"
  - "v1->v2 migration infers authProvider from encryptedPassword presence"
  - "ensureValidToken inserts DingTalk check between refresh failure and password re-login"

patterns-established:
  - "AuthProvider tracking: 'password' | 'dingtalk' | null persisted in Zustand store"
  - "OAuth poll pattern: interval-based polling with AbortSignal cancellation and timeout"
  - "Auth-expired routing: AUTH_EXPIRED_DINGTALK error triggers QR code view in LoginModal"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-11, D-13, D-14, D-15, D-16, D-17, D-18, D-19, D-20, D-21, D-22]

# Metrics
duration: 5min
completed: 2026-05-08
---

# Phase 7 Plan 01: DingTalk OAuth Service Layer Summary

**DingTalk OAuth service functions with authProvider tracking in Zustand store and auth-aware token refresh routing**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-08T08:46:44Z
- **Completed:** 2026-05-08T08:51:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added authProvider field to lemongridStore with full Zustand persist migration from v1 to v2
- Created three DingTalk OAuth service functions (getDingTalkLoginUrl, pollDingTalkAuth, loginWithDingTalk)
- Extended ensureValidToken to route DingTalk users to QR code view on token expiry instead of password re-login

## Task Commits

Each task was committed atomically:

1. **Task 1: Add authProvider field to lemongridStore with migration** - `6742490` (feat)
2. **Task 2: Add DingTalk OAuth service functions and extend ensureValidToken** - `9d87a46` (feat)

## Files Created/Modified
- `code/webapp/src/stores/lemongridStore.ts` - Added authProvider field, setAuthProvider action, v1->v2 migration, partialize update
- `code/webapp/src/services/lemongrid-auth.ts` - Added DingTalkPollResponse interface, getDingTalkLoginUrl, pollDingTalkAuth, loginWithDingTalk functions, AUTH_EXPIRED_DINGTALK routing in ensureValidToken

## Decisions Made
- setAuth defaults authProvider to 'password' so existing password login callers need no changes
- v1->v2 migration infers authProvider from encryptedPassword presence (existing users with stored passwords get 'password')
- pollDingTalkAuth accepts optional AbortSignal for component unmount cancellation
- loginWithDingTalk follows same pattern as password login: setAuth -> syncAuthToBridge -> getUserProfile

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- lemongridStore authProvider field ready for LoginModal to read and conditionally show QR view
- DingTalk OAuth service functions ready for DingTalkQRView component to consume
- ensureValidToken AUTH_EXPIRED_DINGTALK error ready for callers to handle with QR modal
- Backend poll/callback/login-url endpoints still need implementation (separate backend repo)

---
*Phase: 07-dingtalk-auth*
*Completed: 2026-05-08*

## Self-Check: PASSED
- lemongridStore.ts: FOUND
- lemongrid-auth.ts: FOUND
- 07-01-SUMMARY.md: FOUND
- Task 1 commit 6742490: FOUND
- Task 2 commit 9d87a46: FOUND
