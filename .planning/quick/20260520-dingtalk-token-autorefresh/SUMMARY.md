---
status: complete
date: 2026-05-20
---

# Quick Task: DingTalk Token Auto-Refresh

## Root Cause
`loginWithDingTalk()` never stored the `refresh_token` from the backend poll response,
so `ensureValidToken()` always skipped the refresh step for DingTalk users and went
straight to showing the QR code modal.

## Changes

### `code/webapp/src/services/lemongrid-auth.ts`
1. **DingTalkPollResponse interface** — Added `refresh_token` and `refresh_expires_in` fields
2. **loginWithDingTalk()** — Now passes `refresh_token` to `setAuth()`
3. **LemonGridRefreshResponse** — Added optional `refresh_token` for rotation support
4. **startTokenRefreshTimer() / stopTokenRefreshTimer()** — Proactive refresh 5 min before expiry
5. **lemongridFetch() 401 retry** — Auto-refreshes on 401 and retries once
6. **tryRefreshOn401()** — Re-entrancy guard to prevent infinite loops
7. **ensureValidToken()** — Uses rotated refresh_token instead of stale one

### `code/webapp/src/stores/lemongridStore.ts`
1. **setAuth()** — Calls `startTokenRefreshTimer()` after setting auth state
2. **clearAuth()** — Calls `stopTokenRefreshTimer()` before clearing state
3. Uses lazy `import()` to avoid circular dependency with lemongrid-auth

## Result
- DingTalk users get silent token refresh in the background (every 25 min with 30-min token lifetime)
- 401 responses trigger automatic retry after refresh
- QR code only appears when refresh token itself expires (7 days of inactivity)
- No backend changes needed
