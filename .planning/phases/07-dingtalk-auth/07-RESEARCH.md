# Phase 07: DingTalk Auth Integration - Research

**Researched:** 2026-05-08
**Domain:** DingTalk OAuth 2.0, UXP WebView iframe, QR code authentication, Redis poll pattern
**Confidence:** HIGH

## Summary

Phase 07 integrates DingTalk OAuth scan-to-login into the Photoshop UXP plugin's WebView, coexisting with the existing username/password login. The plugin reuses the LemonGrid backend's existing DingTalk OAuth infrastructure but must adapt the standard redirect-based OAuth flow for the UXP environment, which cannot perform browser redirects.

The critical architectural challenge is that DingTalk provides two distinct OAuth APIs: the **NEW OAuth2 API** (used by the backend, with auth URL at `login.dingtalk.com/oauth2/auth`), and the **OLD sns iframe embed API** (with `login.dingtalk.com/login/qrcode.htm`). These are incompatible flows. The backend already fully implements the NEW OAuth2 API including state management, token exchange, user matching, and JWT session creation. The plugin must bridge the gap by either loading the OAuth2 auth URL in an iframe (with uncertain UXP cross-origin support) or rendering it as a QR code image via `qrcode.react` (the likely primary path per D-04 risk mitigation).

The backend needs three targeted changes: a new `GET /auth/dingtalk/poll` endpoint, modification to the callback to store JWT in Redis for poll-mode retrieval, and a `redirect_mode` parameter on the login-url endpoint. The frontend needs a new QR code view in LoginModal, new OAuth service functions, an `authProvider` field in lemongridStore, and updated token refresh logic that routes DingTalk users back to the QR view instead of password re-login.

**Primary recommendation:** Plan for the qrcode.react path as the primary UXP implementation (high confidence it works), with iframe as a secondary optimization that gets tested first per D-04. The backend changes are small and well-scoped -- reuse the existing `handle_callback` flow, just add a Redis write-then-poll layer.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Plugin loads DingTalk QR scan page via iframe (`https://login.dingtalk.com/login/qrcode.htm?appid=xxx&redirect_uri=xxx`)
- **D-02:** DingTalk callback goes to backend (not plugin), backend processes authCode and stores JWT in Redis keyed by state
- **D-03:** Plugin polls backend poll endpoint for JWT: `GET /api/v1/auth/dingtalk/poll?state=xxx`
- **D-04:** Risk mitigation: test iframe first; if blocked, fallback to qrcode.react rendering OAuth URL as QR code image
- **D-05:** iframe network requests loaded by UXP WebView directly (not via Bridge proxy)
- **D-06:** Reuse LoginModal, add divider "--- or ---" below password form, then DingTalk button (blue, #0089FF, DingTalk icon)
- **D-07:** Click DingTalk button replaces password form with iframe QR code view. QR view has "return to password login" link at top
- **D-08:** New users see full LoginModal (password form + DingTalk button), no extra guidance
- **D-09:** iframe width 100%, height ~320px
- **D-10:** QR code auto-refresh after ~3 min expiry by reloading iframe
- **D-11:** Polling interval 2 seconds, total timeout 5 minutes
- **D-12:** After poll timeout show "QR code expired, click to refresh" message
- **D-13:** lemongridStore new field `authProvider: 'password' | 'dingtalk' | null`
- **D-14:** OAuth user refresh token expired -> auto-popup LoginModal with QR code view (not password form)
- **D-15:** `ensureValidToken()` routes by authProvider: password -> re-login, dingtalk -> show QR view
- **D-16:** Logout clears local state only (JWT, token, user info), no DingTalk session cleanup
- **D-17:** New endpoint `GET /api/v1/auth/dingtalk/poll?state=xxx` returns pending/completed/error
- **D-18:** Modify `POST /api/v1/auth/dingtalk/callback` to store JWT in Redis (`dingtalk:poll:{state}`, TTL 5 min)
- **D-19:** `GET /api/v1/auth/dingtalk/login-url` supports `redirect_mode` param: `redirect` (Web) vs `poll` (plugin)
- **D-20:** Dual-mode: browser uses standard redirect OAuth, UXP uses iframe + polling
- **D-21:** Browser mode DingTalk login does not use Bridge, uses native fetch and window.location
- **D-22:** DingTalk users reuse existing user info display (username + role), backend's display_name stored as username
- **D-23:** Settings page shows login method ("password login" or "DingTalk login"), display only, no unbind
- **D-24:** Switch to Cluster Mode: if authProvider is dingtalk and token expired, auto-show QR view
- **D-25:** DingTalk unavailable -> "DingTalk service temporarily unavailable, please try again later"
- **D-26:** User cancelled -> "Authorization cancelled"
- **D-27:** Network error -> "Network connection failed" + retry button
- **D-28:** Poll timeout -> "Login timed out, please try again"
- **D-29:** All errors in QR code view with retry button, do not auto-switch to password form

### Claude's Discretion
- iframe loading spinner style
- DingTalk button exact style (color #0089FF, icon source)
- Polling request cancellation logic (cleanup on component unmount)
- Redis poll data TTL and cleanup strategy
- QR code auto-refresh timer implementation

### Deferred Ideas (OUT OF SCOPE)
- DingTalk bind/unbind management -- done in LemonGrid Web admin
- DingTalk avatar display -- reuse existing user info UI
- First-use guidance -- show full LoginModal directly
- DingTalk session cleanup -- logout clears local state only
- Multi DingTalk app/tenant support -- single app config only
- Extend refresh token lifetime -- backend config adjustment
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | iframe loads DingTalk QR scan page | DingTalk OAuth2 auth URL analysis, UXP iframe constraints |
| D-02 | Backend processes callback, stores JWT in Redis | Backend dingtalk_service.py flow analysis, Redis key pattern |
| D-03 | Plugin polls for JWT | New poll endpoint design, polling interval/timing |
| D-04 | iframe fallback to qrcode.react | qrcode.react 4.2.0 API, UXP cross-origin analysis |
| D-05 | iframe loads directly via WebView | UXP WebView network architecture |
| D-06 | LoginModal DingTalk button UI | LoginModal.tsx structure analysis, CSS patterns |
| D-07 | QR code view replaces password form | LoginModal state management pattern |
| D-09 | iframe dimensions | DingTalk QR page minimum size requirements |
| D-10 | QR auto-refresh after 3 min | Timer patterns in React, iframe reload |
| D-11 | Polling 2s interval, 5 min timeout | Polling patterns, AbortController cleanup |
| D-13 | authProvider field in store | Zustand persist store analysis, migration |
| D-14 | OAuth user refresh expiry -> QR popup | ensureValidToken() flow analysis |
| D-15 | ensureValidToken routes by authProvider | lemongrid-auth.ts ensureValidToken() analysis |
| D-17 | New poll endpoint | FastAPI endpoint patterns in auth.py |
| D-18 | Modified callback with Redis storage | dingtalk_service.py handle_callback analysis |
| D-19 | login-url redirect_mode parameter | generate_login_url() analysis |
| D-20 | Dual-mode browser/UXP | isUXPWebView() pattern analysis |
| D-22 | User info display | Backend UserResponse schema |
| D-23 | Settings shows login method | Settings.tsx structure analysis |
| D-24 | Smart modal on mode switch | handleModeChange() analysis |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DingTalk OAuth URL generation | API / Backend | -- | Backend generates state, stores in Redis, constructs auth URL with app credentials |
| QR code display (iframe or image) | Browser / Client | -- | UXP WebView renders the QR code; iframe loading or qrcode.react rendering |
| Auth polling | Browser / Client | API / Backend | Client initiates 2s poll loop; backend serves poll endpoint |
| JWT storage & retrieval | API / Backend | -- | Backend creates JWT via AuthService.create_session, stores in Redis for poll |
| Login UI state (password vs QR) | Browser / Client | -- | LoginModal local state manages which view to display |
| Token refresh with auth routing | Browser / Client | API / Backend | Client-side ensureValidToken() decides action; backend serves refresh endpoint |
| Auth provider tracking | Browser / Client | -- | Zustand persist store tracks authProvider across sessions |
| Settings display | Browser / Client | -- | Read-only display from store state |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| qrcode.react | 4.2.0 (not yet installed) | Render OAuth URL as QR code image | Fallback per D-04 when iframe blocked; lightweight, React-native component [VERIFIED: npm registry] |
| zustand | ^5.0.11 | State management with persist | Already in use for lemongridStore; add authProvider field [VERIFIED: package.json] |
| react | ^19.2.0 | UI framework | Already in use [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| httpx (Python) | (backend) | Async HTTP client for DingTalk API | Already in backend dingtalk_service.py for token exchange |
| redis (Python) | (backend) | State storage and poll data | Already used for OAuth state in dingtalk_service.py |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| qrcode.react | html5-qrcode | qrcode.react is render-only (just displays QR); html5-qrcode also scans which is unnecessary |
| qrcode.react | qrcode (npm) | qrcode.react wraps qrcode with React component; using qrcode.react avoids manual canvas/SVG management |
| iframe approach | Always qrcode.react | iframe provides native DingTalk branding and UX; qrcode.react is fallback when iframe blocked per D-04 |

**Installation:**
```bash
cd code/webapp && npm install qrcode.react
```

**Version verification:**
- qrcode.react: 4.2.0 [VERIFIED: npm registry via `npm view qrcode.react version`]
- zustand: ^5.0.11 [VERIFIED: package.json]
- react: ^19.2.0 [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```
                    PLUGIN (UXP WebView)
                    ┌─────────────────────────────────────────┐
                    │           LoginModal.tsx                 │
                    │  ┌─────────────┐  ┌──────────────────┐  │
                    │  │ Password    │  │ QR Code View     │  │
                    │  │ Form        │  │ (iframe OR       │  │
                    │  │             │  │  qrcode.react)   │  │
                    │  └──────┬──────┘  └────────┬─────────┘  │
                    │         │                  │             │
                    │         ▼                  ▼             │
                    │  ┌──────────────────────────────────┐   │
                    │  │    lemongrid-auth.ts              │   │
                    │  │  loginToLemonGrid()               │   │
                    │  │  getDingTalkLoginUrl() [NEW]      │   │
                    │  │  pollDingTalkAuth()  [NEW]        │   │
                    │  │  loginWithDingTalk() [NEW]        │   │
                    │  └──────────┬───────────────────────┘   │
                    │             │                            │
                    │             ▼                            │
                    │  ┌──────────────────────────────────┐   │
                    │  │    lemongridStore.ts              │   │
                    │  │  + authProvider field [NEW]       │   │
                    │  │  + setAuthProvider()    [NEW]     │   │
                    │  └──────────┬───────────────────────┘   │
                    └─────────────┼────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────────┐
              │  UXP mode         │       Browser mode     │
              │  Bridge proxy     │       Direct fetch     │
              │  (lemongridFetch) │                        │
              └───────────────────┼───────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │    LEMONGRID BACKEND         │
                    │                             │
                    │  GET /auth/dingtalk/         │
                    │       login-url              │──→ generate_login_url()
                    │       ?redirect_mode=poll    │    (NEW: poll mode flag)
                    │                             │
                    │  POST /auth/dingtalk/        │
                    │       callback               │──→ handle_callback()
                    │                             │    + Redis SET poll data
                    │                             │    [MODIFIED per D-18]
                    │                             │
                    │  GET /auth/dingtalk/         │
                    │       poll?state=xxx         │──→ GETDEL Redis key
                    │                             │    [NEW per D-17]
                    │                             │
                    │  ┌─────────────────────┐     │
                    │  │  Redis               │     │
                    │  │  dingtalk:oauth_state │     │
                    │  │  dingtalk:poll:{state}│     │
                    │  └─────────────────────┘     │
                    └─────────────────────────────┘
                                  │
                                  ▼ (callback redirect)
                    ┌─────────────────────────────┐
                    │    DINGTALK SERVER            │
                    │  login.dingtalk.com/oauth2/   │
                    │  auth?redirect_uri=...        │
                    │  &response_type=code          │
                    │  &client_id=APP_KEY           │
                    │  &scope=openid                │
                    │  &state=RANDOM                │
                    │  &prompt=consent               │
                    └─────────────────────────────┘
```

### Recommended Project Structure
```
code/webapp/src/
├── components/
│   ├── LoginModal.tsx          # [MODIFY] Add DingTalk button + QR view state
│   ├── LoginModal.css          # [MODIFY] Add DingTalk button + QR view styles
│   └── DingTalkQRView.tsx      # [NEW] QR code view component (iframe + qrcode.react)
├── services/
│   └── lemongrid-auth.ts       # [MODIFY] Add getDingTalkLoginUrl, pollDingTalkAuth, loginWithDingTalk
├── stores/
│   └── lemongridStore.ts       # [MODIFY] Add authProvider field + setAuthProvider
└── pages/
    └── Settings.tsx            # [MODIFY] Show login method per D-23
```

### Pattern 1: OAuth Poll Flow (Primary UXP Pattern)
**What:** Plugin renders QR code, user scans with DingTalk app, backend receives callback, plugin polls for JWT
**When to use:** UXP WebView environment where standard redirect OAuth is impossible

**Flow:**
1. Plugin calls `GET /auth/dingtalk/login-url?redirect_mode=poll`
2. Backend generates state, stores in Redis, returns `{ auth_url, state }`
3. Plugin renders auth_url as QR code (via iframe or qrcode.react)
4. User scans QR with DingTalk mobile app, approves
5. DingTalk redirects to backend callback URL with `authCode` + `state`
6. Backend processes callback (validate state, exchange token, match user, create JWT)
7. Backend stores JWT result in Redis at `dingtalk:poll:{state}` with 5-min TTL
8. Plugin polls `GET /auth/dingtalk/poll?state=xxx` every 2 seconds
9. Poll returns `{ status: "completed", data: { access_token, user } }`
10. Plugin stores JWT and authProvider='dingtalk' in lemongridStore

```typescript
// Source: [ASSUMED] based on CONTEXT.md D-03, D-17, D-18
// Pattern: Poll until completed or timeout

interface DingTalkPollResponse {
  status: 'pending' | 'completed' | 'error';
  data?: {
    access_token: string;
    token_type: string;
    expires_in: number;
    user: { id: string; username: string; role: string; display_name?: string };
  };
  error?: string;
}

async function pollDingTalkAuth(
  serverUrl: string,
  state: string,
  options: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<DingTalkPollResponse> {
  const interval = options.intervalMs ?? 2000;
  const timeout = options.timeoutMs ?? 300000; // 5 min
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const url = `${serverUrl}/api/v1/auth/dingtalk/poll?state=${state}`;
    const response = await lemongridFetch(url);
    const result: DingTalkPollResponse = await response.json();

    if (result.status === 'completed') return result;
    if (result.status === 'error') throw new Error(result.error || 'DingTalk auth failed');

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error('POLL_TIMEOUT');
}
```

### Pattern 2: Browser Redirect Flow (Secondary / Browser Mode)
**What:** Standard OAuth redirect for browser debugging mode
**When to use:** `isUXPWebView() === false` -- normal browser environment

**Flow:**
1. Plugin calls `GET /auth/dingtalk/login-url?redirect_mode=redirect`
2. Backend returns `{ auth_url, state }` (same as existing)
3. Plugin redirects `window.location.href = auth_url`
4. DingTalk auth page loads, user scans/approves
5. DingTalk redirects to backend callback URL
6. Backend processes callback, creates JWT, redirects to frontend callback page
7. Frontend callback page extracts JWT, stores in auth state

```typescript
// Source: [CITED: fluxcore-frontend/src/pages/auth/DingTalkCallback.tsx]
// Reference implementation from LemonGrid Web frontend

// Browser mode: direct redirect
if (!isUXPWebView()) {
  const { auth_url } = await getDingTalkLoginUrl(serverUrl, 'redirect');
  window.location.href = auth_url;
}
```

### Pattern 3: authProvider-Aware Token Refresh
**What:** `ensureValidToken()` routes differently based on authProvider
**When to use:** When OAuth user's token needs refresh

```typescript
// Source: [ASSUMED] based on CONTEXT.md D-14, D-15
// Extension of existing ensureValidToken() in lemongrid-auth.ts

export async function ensureValidToken(): Promise<string> {
  const lgState = useLemonGridStore.getState();

  if (!lgState.accessToken) {
    throw new Error('Not authenticated');
  }

  // Check if token is still valid (2 min buffer)
  if (lgState.tokenExpiresAt && lgState.tokenExpiresAt > Date.now() + 120000) {
    return lgState.accessToken;
  }

  // Try refresh token first
  if (lgState.refreshToken && lgState.serverUrl) {
    try {
      const refreshResult = await refreshAccessToken(lgState.serverUrl, lgState.refreshToken);
      useLemonGridStore.getState().setAuth({ /* ... */ });
      await syncAuthToBridge();
      return refreshResult.access_token;
    } catch { /* refresh failed */ }
  }

  // Route by authProvider per D-15
  if (lgState.authProvider === 'dingtalk') {
    // D-14: Show QR code view, not password form
    useLemonGridStore.getState().setShowLoginModal(true);
    // LoginModal reads authProvider and shows QR view directly
    throw new Error('AUTH_EXPIRED_DINGTALK');
  }

  // Password users: try re-login with stored credentials
  if (lgState.rememberMe && lgState.encryptedPassword && lgState.username && lgState.serverUrl) {
    try {
      const password = await decryptPassword(lgState.encryptedPassword);
      const loginResult = await loginToLemonGrid(lgState.serverUrl, lgState.username, password);
      useLemonGridStore.getState().setAuth({ /* ... */ });
      await syncAuthToBridge();
      return loginResult.access_token;
    } catch { /* re-login failed */ }
  }

  useLemonGridStore.getState().setConnected(false);
  useLemonGridStore.getState().setShowLoginModal(true);
  throw new Error('AUTH_EXPIRED');
}
```

### Anti-Patterns to Avoid
- **Mixing OLD sns API with NEW OAuth2 API:** The DingTalk iframe embed page (`login.dingtalk.com/login/qrcode.htm`) uses the OLD sns API flow which returns `loginTmpCode` and requires `oapi.dingtalk.com/connect/oauth2/sns_authorize`. The backend uses the NEW OAuth2 API (`api.dingtalk.com/v1.0/oauth2/userAccessToken`). Do NOT try to combine these. The plugin should use the NEW OAuth2 auth URL (`login.dingtalk.com/oauth2/auth`) rendered as a QR code, which will redirect the user's browser to the backend callback with the correct `authCode` format.
- **Passing JWT through URL params:** Never pass JWT tokens via URL query parameters. The poll endpoint returns JWT in the response body.
- **Storing authProvider in Bridge:** The Bridge `settings.set` for lemongrid only needs JWT/serverUrl. authProvider is a frontend concern stored in lemongridStore.
- **Polling without cleanup:** Always clean up polling intervals and timers on component unmount to prevent memory leaks and stale requests.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR code rendering | Custom canvas drawing or SVG generation | qrcode.react 4.2.0 | Handles error correction levels, sizing, module patterns; edge cases with Unicode |
| OAuth state generation | Custom random string generator | Backend's `secrets.token_urlsafe(32)` | Cryptographic randomness, already implemented |
| Token exchange | Custom HTTP to DingTalk API | Backend's `_exchange_token()` | Handles DingTalk-specific headers, error codes, timeout |
| User matching | Custom user lookup in frontend | Backend's `_handle_login()` | Complex matching logic: open_id -> phone -> create new user with dept sync |
| AES-GCM encryption | New encryption for OAuth tokens | Existing `encryptPassword`/`decryptPassword` pattern | OAuth does not need password storage -- users re-scan QR |

**Key insight:** The backend already implements the entire DingTalk OAuth flow (state generation, token exchange, user info, user matching, JWT creation). The plugin only needs: (1) get the auth URL, (2) display it as a QR code, (3) poll for the result. The backend changes are minimal -- just add a Redis write in the callback and a poll endpoint.

## Common Pitfalls

### Pitfall 1: DingTalk OAuth API Version Mismatch
**What goes wrong:** Using the OLD sns iframe embed URL (`login.dingtalk.com/login/qrcode.htm`) which produces `loginTmpCode` that the NEW backend API cannot process.
**Why it happens:** DingTalk documentation mixes old and new API references. The iframe QR embed page historically used the sns flow. The backend's `handle_callback` expects an `auth_code` from the NEW OAuth2 API.
**How to avoid:** Always use the NEW OAuth2 auth URL (`login.dingtalk.com/oauth2/auth?...`) generated by the backend's `generate_login_url()`. This URL already has the correct `client_id` (APP_KEY), `redirect_uri`, and `state` parameter. Render THIS URL as a QR code; do not try to embed the DingTalk iframe QR page.
**Warning signs:** If the callback receives parameters named `loginTmpCode` instead of `authCode`, the wrong OAuth API is being used.

### Pitfall 2: UXP WebView iframe Cross-Origin Blocking
**What goes wrong:** UXP WebView blocks cross-origin iframe loads of `login.dingtalk.com`.
**Why it happens:** UXP WebView has security restrictions that may prevent loading external domains in iframes. Additionally, DingTalk's auth page sets `X-Frame-Options` or `Content-Security-Policy` headers that restrict embedding.
**How to avoid:** Per D-04: implement iframe approach first but have qrcode.react ready as fallback. The QR code approach renders the OAuth URL as a static image in the plugin -- no cross-origin requests needed. The user scans the QR with their phone camera, which opens a browser to complete auth.
**Warning signs:** Iframe shows blank content, console errors about `X-Frame-Options` or CSP violations.

### Pitfall 3: Poll Endpoint Race Condition
**What goes wrong:** Backend callback and poll endpoint both try to read the same Redis key, causing the JWT to be consumed before the poll reads it, or the poll to read stale data.
**Why it happens:** Using `GET` then `DEL` as separate operations is not atomic.
**How to avoid:** The callback writes JWT to `dingtalk:poll:{state}` (NOT `dingtalk:oauth_state:{state}`). The poll endpoint reads and deletes using atomic `GETDEL` command. The state validation in callback uses `GETDEL` on `dingtalk:oauth_state:{state}` -- a different key. This separation prevents race conditions.
**Warning signs:** Poll returns `pending` indefinitely even after user scanned, or returns `completed` but with empty data.

### Pitfall 4: QR Code URL Expires Before Scan
**What goes wrong:** DingTalk OAuth state expires (5-min TTL in Redis) before the user finishes scanning.
**Why it happens:** User takes too long to scan, or the QR is displayed but user is distracted.
**How to avoid:** Per D-10: auto-refresh QR after 3 minutes (before the 5-min state TTL). Per D-12: show explicit "QR expired, click to refresh" after 5 minutes. On refresh, generate a new auth URL with a new state.
**Warning signs:** User scans but gets "state expired" error; poll returns `error` with state invalid message.

### Pitfall 5: Zustand Store Migration Breaks Existing Users
**What goes wrong:** Adding `authProvider` field causes Zustand persist migration to fail for existing users who have version 1 data without the field.
**Why it happens:** Zustand persist `version` is currently 1. Adding a new field requires bumping to version 2 and handling migration.
**How to avoid:** Set `authProvider` default to `null` in the store, and add a migration from version 1 -> 2 that sets `authProvider: null` (or `'password'` if `encryptedPassword` exists). The `partialize` function must include `authProvider`.
**Warning signs:** Existing users see blank state or errors after upgrade; localStorage data is cleared.

### Pitfall 6: LoginModal Props Don't Support Initial View Selection
**What goes wrong:** When `ensureValidToken()` detects dingtalk user with expired token, it opens LoginModal but the modal always starts on the password form view.
**Why it happens:** LoginModal currently has no prop to control which view (password vs QR) to show initially.
**How to avoid:** Add an optional prop like `initialView?: 'password' | 'dingtalk'` to LoginModal. When D-14 or D-24 trigger the modal for dingtalk users, pass `initialView='dingtalk'`. Also read `authProvider` from store on mount.
**Warning signs:** DingTalk users see password form when their token expires, confusing them.

## Code Examples

### getDingTalkLoginUrl -- New Service Function
```typescript
// Source: [ASSUMED] based on backend auth.py analysis
// Mirrors existing loginToLemonGrid pattern in lemongrid-auth.ts

export async function getDingTalkLoginUrl(
  serverUrl: string,
  redirectMode: 'redirect' | 'poll' = 'poll'
): Promise<{ auth_url: string; state: string }> {
  const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/dingtalk/login-url?redirect_mode=${redirectMode}`;

  const response = await lemongridFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to get DingTalk login URL: ${response.status}`);
  }

  return await response.json() as { auth_url: string; state: string };
}
```

### loginWithDingTalk -- Store JWT from Poll Result
```typescript
// Source: [ASSUMED] based on existing loginToLemonGrid + syncAuthToBridge patterns
// Follows the same setAuth -> syncAuthToBridge -> getUserProfile flow

export async function loginWithDingTalk(
  serverUrl: string,
  pollResult: { access_token: string; expires_in: number; user: { id: string; username: string; role: string } }
): Promise<void> {
  const store = useLemonGridStore.getState();

  store.setAuth({
    accessToken: pollResult.access_token,
    expiresIn: pollResult.expires_in,
    username: pollResult.user.username || pollResult.user.display_name || 'DingTalk User',
    role: pollResult.user.role,
  });

  // Per D-13: Set auth provider
  store.setAuthProvider('dingtalk');

  // Clear any stored password (not needed for DingTalk users)
  store.setEncryptedPassword(null);
  store.setRememberMe(false);

  // Sync auth to Bridge (same as password login)
  await syncAuthToBridge();

  // Fetch full user profile (same as password login)
  try {
    await getUserProfile(serverUrl, pollResult.access_token);
  } catch {
    // Profile fetch failure should not block login
  }
}
```

### Zustand Store authProvider Field Addition
```typescript
// Source: [VERIFIED: lemongridStore.ts current code]
// Changes needed to add authProvider field

// In interface LemonGridState, add:
authProvider: 'password' | 'dingtalk' | null;
setAuthProvider: (provider: 'password' | 'dingtalk' | null) => void;

// In store defaults, add:
authProvider: null,

// In actions, add:
setAuthProvider: (provider) => set({ authProvider: provider }),

// In setAuth action, detect provider:
setAuth: (data) =>
  set({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? null,
    tokenExpiresAt: Date.now() + data.expiresIn * 1000,
    username: data.username,
    userRole: data.role,
    isConnected: true,
    authProvider: data.authProvider ?? 'password', // NEW: default to password
  }),

// In clearAuth action, reset:
clearAuth: () =>
  set({
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    userRole: null,
    isConnected: false,
    encryptedPassword: null,
    authProvider: null, // NEW
    tasks: {},
    clusterOutputImages: [],
  }),

// In partialize, add:
partialize: (state) => ({
  serverUrl: state.serverUrl,
  accessToken: state.accessToken,
  refreshToken: state.refreshToken,
  tokenExpiresAt: state.tokenExpiresAt,
  username: state.username,
  userRole: state.userRole,
  encryptedPassword: state.encryptedPassword,
  rememberMe: state.rememberMe,
  authProvider: state.authProvider, // NEW
}),

// Migration from version 1 to 2:
version: 2,
migrate: (persisted: Record<string, unknown>, version: number) => {
  if (version === 0) {
    return {
      serverUrl: '', accessToken: null, /* ... existing v0 fields */
    };
  }
  if (version === 1) {
    // v1 -> v2: add authProvider
    return {
      ...persisted,
      authProvider: persisted.encryptedPassword ? 'password' : null,
    };
  }
  return persisted;
},
```

### Backend Poll Endpoint (Python/FastAPI)
```python
# Source: [VERIFIED: auth.py existing patterns + dingtalk_service.py Redis usage]
# New endpoint to add to auth.py

@router.get("/dingtalk/poll", summary="轮询钉钉OAuth结果")
async def dingtalk_poll(
    state: str,
):
    """轮询钉钉 OAuth 授权结果 (per D-17)

    Returns:
        pending: 授权进行中
        completed: 授权成功，返回 JWT
        error: 授权失败
    """
    from app.main import redis_pool
    import json

    if not redis_pool:
        raise HTTPException(status_code=500, detail="Redis not available")

    poll_key = f"dingtalk:poll:{state}"

    # Check if poll data exists
    poll_data = await redis_pool.get(poll_key)
    if poll_data is None:
        # Check if the OAuth state is still pending (not yet processed by callback)
        state_exists = await redis_pool.exists(f"dingtalk:oauth_state:{state}")
        if state_exists:
            return {"status": "pending"}
        # Neither poll data nor state exists -> expired or invalid
        return {"status": "error", "error": "授权已过期，请重新扫码"}

    # Poll data found -- parse and return (do NOT delete yet, let client confirm)
    # Actually per D-17: use atomic GETDEL to prevent re-read
    poll_data = await redis_pool.getdel(poll_key)
    if poll_data is None:
        # Race condition: another poll consumed it
        return {"status": "pending"}

    result = json.loads(poll_data)

    if result.get("status") == "error":
        return {"status": "error", "error": result.get("error", "授权失败")}

    return {
        "status": "completed",
        "data": result.get("data"),
    }
```

### Backend Modified Callback with Redis Poll Storage
```python
# Source: [VERIFIED: dingtalk_service.py handle_callback analysis]
# Modification to existing callback in auth.py

# In dingtalk_callback endpoint, AFTER successful token creation:

# Store poll data in Redis for plugin polling (per D-18)
# Only when redirect_mode is 'poll'
from app.main import redis_pool
if redis_pool and data.state:
    # Check if this state was created in poll mode
    # (We need to store the mode alongside the state)
    import json
    poll_data = json.dumps({
        "status": "completed",
        "data": {
            "access_token": result["access_token"],
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "user": UserResponse.model_validate(result["user"]).model_dump(),
        }
    })
    await redis_pool.setex(
        f"dingtalk:poll:{data.state}",
        300,  # 5 min TTL
        poll_data
    )
```

### Backend Modified login-url with redirect_mode
```python
# Source: [VERIFIED: dingtalk_service.py generate_login_url analysis]
# Modification to store redirect_mode alongside state

# Option: Store redirect_mode in Redis alongside state value
# Current: redis.setex(f"dingtalk:oauth_state:{state}", 300, "LOGIN")
# Modified: redis.setex(f"dingtalk:oauth_state:{state}", 300, "LOGIN:POLL") or "LOGIN:REDIRECT"

# In auth.py:
@router.get("/dingtalk/login-url", response_model=DingTalkLoginUrlResponse)
async def dingtalk_login_url(
    redirect_mode: str = "redirect",  # NEW: "redirect" or "poll"
    db: AsyncSession = Depends(get_db),
):
    result = await DingTalkService.generate_login_url(
        db,
        redirect_mode=redirect_mode  # Pass to service
    )
    return DingTalkLoginUrlResponse(**result)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DingTalk sns API (`oapi.dingtalk.com/connect/oauth2/sns_authorize`) | DingTalk OAuth2 API (`api.dingtalk.com/v1.0/oauth2/userAccessToken`) | 2022+ | Backend already uses new API; do not use old sns iframe embed |
| iframe-only QR code display | qrcode.react rendering OAuth URL as image | -- | More reliable in restricted WebView environments |
| Separate DingTalk auth page | Embedded QR in existing LoginModal | -- | Seamless UX, no page navigation |

**Deprecated/outdated:**
- DingTalk sns API endpoints (`/connect/oauth2/sns_authorize`, `sns/getuserinfo_bycode`): Replaced by OAuth2 API. Do not use.
- `login.dingtalk.com/login/qrcode.htm`: OLD iframe embed page for sns flow. Incompatible with NEW OAuth2 backend.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | DingTalk NEW OAuth2 auth URL (`login.dingtalk.com/oauth2/auth`) produces a scannable QR code page when loaded directly in a mobile browser | Architecture Patterns | QR code approach fails; need to find alternative URL format |
| A2 | The OAuth2 auth URL can be rendered as a static QR code and scanned by phone camera to open the auth flow in the phone's browser | Architecture Patterns | Core approach fails; must find different auth mechanism |
| A3 | UXP WebView will block cross-origin iframe loading of `login.dingtalk.com` | Common Pitfalls | If it works, iframe approach is viable (simpler UX for users who have DingTalk desktop) |
| A4 | DingTalk's OAuth2 auth page does not set `X-Frame-Options: DENY` that would block iframe embedding | Common Pitfalls | Same as A3 -- if headers allow iframe, use iframe approach |
| A5 | The backend's `generate_login_url` can be modified to accept `redirect_mode` without breaking existing Web frontend calls (which use `redirect_mode=redirect`) | Backend Changes | Web frontend DingTalk login breaks; must ensure backward compatibility |
| A6 | Redis `GETDEL` command is available on the backend's Redis instance | Backend Changes | Must use separate GET + DEL with transaction, slightly less safe |
| A7 | qrcode.react 4.2.0 works correctly in UXP WebView environment | Standard Stack | Must test; if not, need alternative QR rendering approach |

## Open Questions

1. **Does DingTalk OAuth2 auth URL work as a scannable QR code?**
   - What we know: The URL `https://login.dingtalk.com/oauth2/auth?...` opens a login page in browser. When rendered as QR and scanned by phone camera, the phone browser should open this page.
   - What's unclear: Does the DingTalk mobile app intercept this URL scheme and handle it in-app? Or does it require the user to then open DingTalk app separately?
   - Recommendation: Test this during implementation. If DingTalk app intercepts the URL, the flow is seamless. If not, the user scans QR -> opens browser -> sees DingTalk auth page -> approves -> redirected to backend callback.

2. **Will iframe approach work in UXP WebView at all?**
   - What we know: UXP WebView has some cross-origin restrictions. D-04 explicitly requires testing this.
   - What's unclear: Exact UXP WebView iframe policy for `login.dingtalk.com`.
   - Recommendation: Test iframe loading of DingTalk auth URL as first implementation step. If blocked, proceed with qrcode.react.

3. **Should poll data use GETDEL or GET+DEL?**
   - What we know: Redis GETDEL is atomic (Redis 6.2+). Backend appears to already use GETDEL in `handle_callback` for state validation.
   - What's unclear: Exact Redis version on backend server.
   - Recommendation: Check Redis version. If >= 6.2, use GETDEL. Otherwise use Redis transaction (MULTI/EXEC with GET + DEL).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build/dev | -- | -- | -- |
| qrcode.react | QR code rendering | Not installed | 4.2.0 (npm) | npm install required |
| zustand | State management | Installed | ^5.0.11 | -- |
| Redis (backend) | Poll state storage | Available (backend) | -- | -- |
| LemonGrid backend | Auth API endpoints | Running | -- | Must be accessible for testing |

**Missing dependencies with no fallback:**
- qrcode.react: Must be installed via `npm install qrcode.react` before implementation begins

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None configured -- vitest not set up |
| Config file | None found |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-13 | authProvider field persists correctly | unit | Manual verification | N/A |
| D-17 | poll endpoint returns correct states | unit (backend) | Manual verification | N/A |
| D-04 | iframe blocked -> fallback to qrcode.react | manual | Visual testing in UXP | N/A |
| D-06 | DingTalk button renders in LoginModal | manual | Visual testing | N/A |
| D-11 | Poll interval 2s, timeout 5 min | unit | Manual verification | N/A |
| D-14 | OAuth expired -> shows QR view | manual | Visual testing | N/A |
| D-20 | Dual-mode browser/UXP | manual | Browser + UXP testing | N/A |

### Sampling Rate
- **Per task commit:** Manual verification (no automated test framework)
- **Per wave merge:** Manual verification
- **Phase gate:** Manual testing in both browser and UXP environments

### Wave 0 Gaps
- [ ] No test framework configured -- vitest setup needed if automated tests desired
- [ ] No test files for lemongrid-auth.ts or lemongridStore.ts
- Note: Given this phase is primarily UI + integration work with external OAuth dependencies, automated testing is limited. Manual testing in UXP + browser environments is the primary validation approach.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OAuth2 via DingTalk + existing JWT auth |
| V3 Session Management | yes | JWT tokens with refresh, same as existing |
| V4 Access Control | yes | Existing backend role-based access control |
| V5 Input Validation | yes | FastAPI Pydantic schemas on backend; React form validation on frontend |
| V6 Cryptography | yes | AES-GCM for stored passwords (existing); HTTPS for OAuth URLs |

### Known Threat Patterns for OAuth Integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSRF on OAuth callback | Tampering | State parameter validated via Redis GETDEL (already implemented) |
| Token interception | Information Disclosure | HTTPS for all OAuth URLs; JWT in response body not URL params |
| Open redirect via state param | Tampering | State is random token, not user-controlled URL |
| Poll data race condition | Tampering | Atomic GETDEL on Redis; state consumed once |
| QR code phishing (fake QR) | Spoofing | QR code generated from backend-returned URL; user sees DingTalk domain |

## Sources

### Primary (HIGH confidence)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\dingtalk_service.py` - Full DingTalk OAuth flow implementation (state generation, token exchange, user matching)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\auth.py` - Existing DingTalk endpoints (login-url, callback, bind-url, unbind)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\core\config.py` - DingTalk config (APP_KEY, APP_SECRET, REDIRECT_URI)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-frontend\src\pages\auth\DingTalkCallback.tsx` - Web frontend reference implementation
- `code/webapp/src/services/lemongrid-auth.ts` - Existing auth service (login, refresh, ensureValidToken, syncAuthToBridge)
- `code/webapp/src/stores/lemongridStore.ts` - Existing Zustand store with persist
- `code/webapp/src/components/LoginModal.tsx` - Existing login UI
- `code/webapp/src/components/LoginModal.css` - Existing login styles
- `code/webapp/src/pages/Settings.tsx` - Settings page with auth display
- `code/webapp/src/services/upload.ts` - isUXPWebView(), bridgeFetch patterns

### Secondary (MEDIUM confidence)
- npm registry: qrcode.react 4.2.0 verified via `npm view qrcode.react version`
- `.planning/codebase/ARCHITECTURE.md` - Bridge communication pattern, UXP WebView architecture
- `.planning/phases/07-dingtalk-auth/07-CONTEXT.md` - User decisions D-01 through D-29

### Tertiary (LOW confidence)
- DingTalk OAuth2 API behavior when auth URL is rendered as QR code [ASSUMED: A1, A2]
- UXP WebView iframe cross-origin policy for login.dingtalk.com [ASSUMED: A3, A4]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - qrcode.react verified on npm; existing packages verified in package.json
- Architecture: HIGH - all integration points verified by reading source files; backend flow fully understood
- Pitfalls: MEDIUM - iframe/UXP restrictions assumed based on platform behavior; needs runtime verification
- Backend changes: HIGH - existing code patterns well understood; changes are small and follow existing patterns

**Research date:** 2026-05-08
**Valid until:** 2026-06-08 (stable; DingTalk OAuth API and UXP platform unlikely to change significantly)
