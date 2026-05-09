---
status: in-progress
created: 2026-05-09
---

# Fix: DingTalk poll mode detection uses unreliable document.referrer

## Problem
After scanning DingTalk QR code for login, the phone redirects to LemonGrid `/design` page instead of showing "授权成功". Root cause: `DingTalkCallback.tsx` uses `document.referrer` heuristic which is unreliable in DingTalk's built-in browser.

## Fix
Backend already knows `redirect_mode` (from Redis `LOGIN:POLL`). Pass it to frontend via callback response.

### Changes
1. **Backend** `dingtalk_service.py` — `handle_callback()` return dict add `redirect_mode`
2. **Backend** `auth.py` — `dingtalk_callback()` return `redirect_mode` in response (bypass TokenResponse schema)
3. **Frontend** `DingTalkCallback.tsx` — use `redirect_mode` from response instead of `document.referrer`

## Verification
- Poll mode (plugin scan): phone shows "授权成功，请返回插件继续操作"
- Redirect mode (web login): phone redirects to `/design` as before
