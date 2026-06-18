# Quick Task: DingTalk Token Auto-Refresh

## Problem
DingTalk login tokens expire every 30 minutes, forcing users to re-scan QR code.
Root cause: `loginWithDingTalk()` never stores the `refresh_token` from backend response,
so `ensureValidToken()` can't silently refresh — it falls straight to QR code for DingTalk users.

## Plan

### T1: Store refresh_token on DingTalk login
- Update `DingTalkPollResponse.data` interface to include `refresh_token` and `refresh_expires_in`
- Update `loginWithDingTalk()` to pass `refresh_token` to `setAuth()`
- Files: `code/webapp/src/services/lemongrid-auth.ts`

### T2: Add proactive token refresh timer
- Add `startTokenRefreshTimer()` / `stopTokenRefreshTimer()` functions
- Refresh token 5 minutes before expiry, not after
- Auto-restart timer on successful refresh
- Files: `code/webapp/src/services/lemongrid-auth.ts`

### T3: Add 401 auto-retry with refresh in lemongridFetch()
- Intercept 401 responses, try refresh, retry original request once
- Only retry once to avoid infinite loops
- Files: `code/webapp/src/services/lemongrid-auth.ts`

### T4: Integrate timer lifecycle
- Start timer on login, restart on refresh, stop on logout
- Files: `code/webapp/src/stores/lemongridStore.ts`, `code/webapp/src/services/lemongrid-auth.ts`

## Verification
- DingTalk login stores refresh_token
- Token refreshes silently in background before expiry
- 401 responses trigger automatic retry
- QR code only shows as last resort (refresh token also expired)
