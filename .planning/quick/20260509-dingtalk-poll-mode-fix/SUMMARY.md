---
status: complete
created: 2026-05-09
---

# Fix: DingTalk poll mode detection

## What
Fixed DingTalk QR scan login — phone now correctly shows "授权成功" instead of redirecting to `/design`.

## Root Cause
`DingTalkCallback.tsx` used `document.referrer` to detect poll vs redirect mode. This heuristic is unreliable in DingTalk's built-in browser, causing false negatives that triggered unwanted redirect to `/design`.

## Fix
Backend already knows `redirect_mode` (from Redis state `LOGIN:POLL` or `LOGIN:REDIRECT`). Passed it through callback response to frontend, replacing the `document.referrer` heuristic.

## Files Changed
- `fluxcore-backend/app/services/dingtalk_service.py` — add `redirect_mode` to return dict
- `fluxcore-backend/app/api/v1/auth.py` — return `redirect_mode` in callback response
- `fluxcore-frontend/src/pages/auth/DingTalkCallback.tsx` — use `response.redirect_mode === 'poll'`
- `fluxcore-frontend/src/types/api.ts` — add `redirect_mode?: string` to `TokenResponse`
