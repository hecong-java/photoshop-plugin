// LemonGrid authentication and API proxy service

import { sendBridgeMessage, isUXPWebView, hasBridgeTransport } from './upload';
import { shapeBridgeResponse } from './bridgeTransport';
import { useLemonGridStore } from '../stores/lemongridStore';

interface LemonGridLoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    username: string;
    role: string;
    [key: string]: unknown;
  };
}

interface LemonGridRefreshResponse {
  access_token: string;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type: string;
  expires_in: number;
}

interface LemonGridProfile {
  id: string;
  username: string;
  role: string;
  quota?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DingTalkPollResponse {
  status: 'pending' | 'completed' | 'error';
  data?: {
    access_token: string;
    refresh_token?: string;
    refresh_expires_in?: number;
    token_type: string;
    expires_in: number;
    user: {
      id: string;
      username: string;
      role: string;
      display_name?: string;
    };
  };
  error?: string;
}

// AES-GCM encryption constants per D-78
const ENCRYPTION_SALT = new TextEncoder().encode('LemonGrid-Encrypt-Salt-v2');
const ENCRYPTION_KEY_MATERIAL = 'LemonGrid-DeviceKey-v2';

// Check if Web Crypto API is available (requires secure context)
const hasSubtleCrypto = typeof crypto !== 'undefined' && !!crypto.subtle;

/**
 * Derive an AES-GCM key from a static device key material + salt.
 * Per D-78: AES-GCM encryption via Web Crypto API with device-derived key.
 * Falls back to simple encoding when crypto.subtle is unavailable (non-secure context).
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  if (!hasSubtleCrypto) {
    throw new Error('crypto.subtle unavailable — use fallback encoding');
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(ENCRYPTION_KEY_MATERIAL),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: ENCRYPTION_SALT,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt password using AES-GCM per D-78.
 * Returns base64 encoded string containing IV + ciphertext.
 */
export async function encryptPassword(password: string): Promise<string> {
  // Fallback: simple base64 encoding when crypto.subtle unavailable
  if (!hasSubtleCrypto) {
    console.warn('[Auth] crypto.subtle unavailable, using base64 encoding fallback');
    return btoa(unescape(encodeURIComponent(password)));
  }
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(password);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine IV + ciphertext into a single buffer
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Convert to base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt password using AES-GCM per D-78.
 */
export async function decryptPassword(encrypted: string): Promise<string> {
  // Fallback: simple base64 decoding when crypto.subtle unavailable
  if (!hasSubtleCrypto) {
    try {
      return decodeURIComponent(escape(atob(encrypted)));
    } catch {
      return encrypted;
    }
  }
  const key = await getEncryptionKey();
  const combined = new Uint8Array(
    atob(encrypted).split('').map((c) => c.charCodeAt(0))
  );

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * LemonGrid fetch - mirrors bridgeFetch pattern but uses lemongrid.fetch Bridge handler.
 * In UXP mode, the Bridge handler injects JWT Authorization header from settingsStorage.
 * In browser mode, reads token from lemongridStore and adds Authorization header manually.
 */
export async function lemongridFetch(
  url: string,
  options: RequestInit = {},
  timeout: number = 30000
): Promise<Response> {
  if (isUXPWebView() && hasBridgeTransport()) {
    // Use Bridge proxy - JWT header injected by main.js handler
    const method = options.method || 'GET';
    const headers: Record<string, string> = {};

    if (options.headers) {
      const headersObj = options.headers as Record<string, string>;
      for (const [key, value] of Object.entries(headersObj)) {
        headers[key] = value;
      }
    }

    const result = await sendBridgeMessage('lemongrid.fetch', {
      url,
      method,
      headers,
      body: options.body as string | undefined,
      timeout,
    }) as {
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      data: unknown;
    };

    // Shape response into Response-like object
    return shapeBridgeResponse(result, url);
  } else {
    // Browser mode - add Authorization header and handle 401 auto-retry
    const response = await doBrowserFetch(url, options, timeout);

    if (response.status === 401) {
      const refreshed = await tryRefreshOn401();
      if (refreshed) {
        return doBrowserFetch(url, options, timeout);
      }
    }
    return response;
  }
}

async function doBrowserFetch(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  const lgState = useLemonGridStore.getState();
  const headers = new Headers(options.headers);
  if (lgState.accessToken) {
    headers.set('Authorization', `Bearer ${lgState.accessToken}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

let isRefreshing = false;

async function tryRefreshOn401(): Promise<boolean> {
  if (isRefreshing) return false;

  const lgState = useLemonGridStore.getState();
  if (!lgState.refreshToken || !lgState.serverUrl) return false;

  isRefreshing = true;
  try {
    const refreshResult = await refreshAccessToken(lgState.serverUrl, lgState.refreshToken);
    useLemonGridStore.getState().setAuth({
      accessToken: refreshResult.access_token,
      refreshToken: refreshResult.refresh_token || lgState.refreshToken,
      expiresIn: refreshResult.expires_in,
      refreshExpiresIn: refreshResult.refresh_expires_in,
      username: lgState.username || '',
      role: lgState.userRole || '',
    });
    await syncAuthToBridge();
    startTokenRefreshTimer();
    return true;
  } catch {
    return false;
  } finally {
    isRefreshing = false;
  }
}

/**
 * Shape Bridge response data into a Response-like object.
 * Re-exported from bridgeTransport so this file's call sites can keep using
 * `shapeBridgeResponse` directly. The local copy has been removed.
 */

/**
 * Login to LemonGrid.
 * POST to {serverUrl}/api/v1/auth/login with { username, password }.
 * Per D-72: Returns token response, then syncs auth to Bridge.
 */
export async function loginToLemonGrid(
  serverUrl: string,
  username: string,
  password: string
): Promise<LemonGridLoginResponse> {
  const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/login`;

  const response = await lemongridFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('AUTH_INVALID_CREDENTIALS');
    }
    const errorText = await response.text();
    throw new Error(`Login failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as LemonGridLoginResponse;
  return data;
}

/**
 * Refresh access token using refresh token.
 * POST to {serverUrl}/api/v1/auth/refresh with { refresh_token }.
 * Per D-79: Returns new access token.
 */
export async function refreshAccessToken(
  serverUrl: string,
  refreshToken: string
): Promise<LemonGridRefreshResponse> {
  const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/refresh`;

  const response = await lemongridFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as LemonGridRefreshResponse;
  return data;
}

/**
 * Get user profile from /api/v1/auth/me.
 * Per D-91: Returns user profile with role, quota.
 */
export async function getUserProfile(
  serverUrl: string,
  token: string
): Promise<LemonGridProfile> {
  const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/me`;

  const response = await lemongridFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user profile: ${response.status}`);
  }

  return (await response.json()) as LemonGridProfile;
}

/**
 * Get DingTalk OAuth login URL from backend.
 * Per D-19: redirect_mode tells backend whether to use Web redirect or plugin poll mode.
 * Per D-20/D-21: Browser mode uses 'redirect', UXP mode uses 'poll'.
 */
export async function getDingTalkLoginUrl(
  serverUrl: string,
  redirectMode: 'redirect' | 'poll' = 'poll'
): Promise<{ auth_url: string; state: string }> {
  const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/dingtalk/login-url?redirect_mode=${redirectMode}`;
  const response = await lemongridFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get DingTalk login URL: ${response.status}`);
  }
  return (await response.json()) as { auth_url: string; state: string };
}

/**
 * Poll backend for DingTalk OAuth result.
 * Per D-11: Polling interval 2 seconds, total timeout 5 minutes (300000ms).
 * Per D-03/D-17: Polls backend endpoint which returns pending/completed/error.
 * Accepts optional AbortSignal for cancellation on component unmount.
 */
export async function pollDingTalkAuth(
  serverUrl: string,
  state: string,
  options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<DingTalkPollResponse> {
  const interval = options.intervalMs ?? 2000;
  const timeout = options.timeoutMs ?? 300000; // 5 min per D-11
  const startTime = Date.now();
  const pollUrl = `${serverUrl.replace(/\/+$/, '')}/api/v1/auth/dingtalk/poll?state=${encodeURIComponent(state)}`;

  while (Date.now() - startTime < timeout) {
    if (options.signal?.aborted) {
      throw new Error('POLL_CANCELLED');
    }

    const response = await lemongridFetch(pollUrl);
    if (!response.ok) {
      throw new Error(`Poll request failed: ${response.status}`);
    }
    const result = (await response.json()) as DingTalkPollResponse;

    if (result.status === 'completed') return result;
    if (result.status === 'error') {
      throw new Error(result.error || 'DingTalk auth failed');
    }
    // result.status === 'pending' -- continue polling

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval);
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('POLL_CANCELLED'));
        }, { once: true });
      }
    });
  }

  throw new Error('POLL_TIMEOUT');
}

/**
 * Complete DingTalk login: store JWT and set authProvider to dingtalk.
 * Per D-22: Store display_name as username if available, fallback to username.
 * Per D-13: Set auth provider to dingtalk.
 */
export async function loginWithDingTalk(
  serverUrl: string,
  pollData: DingTalkPollResponse['data']
): Promise<void> {
  if (!pollData) throw new Error('No poll data received');

  const store = useLemonGridStore.getState();

  // Per D-22: Store display_name as username if available, fallback to username
  const displayName = pollData.user.display_name || pollData.user.username || 'DingTalk User';

  store.setAuth({
    accessToken: pollData.access_token,
    refreshToken: pollData.refresh_token,
    expiresIn: pollData.expires_in,
    refreshExpiresIn: pollData.refresh_expires_in,
    username: displayName,
    role: pollData.user.role,
  }, 'dingtalk');

  // Per D-13: Auth provider already set to dingtalk via setAuth parameter

  // DingTalk users don't need stored passwords
  store.setEncryptedPassword(null);
  store.setRememberMe(false);

  // Sync auth to Bridge (same pattern as password login)
  await syncAuthToBridge();

  // Fetch full user profile (same pattern as password login)
  try {
    await getUserProfile(serverUrl, pollData.access_token);
  } catch {
    // Profile fetch failure should not block login
  }
}

/**
 * Sync auth state to Bridge so main.js handlers can inject JWT.
 * Per plan: Called automatically after login/refresh.
 */
export async function syncAuthToBridge(): Promise<void> {
  const lgState = useLemonGridStore.getState();
  await sendBridgeMessage('settings.set', {
    key: 'lemongrid',
    value: {
      accessToken: lgState.accessToken,
      refreshToken: lgState.refreshToken,
      serverUrl: lgState.serverUrl,
    },
  });
}

/**
 * Validate stored auth on app startup.
 * If access token is still valid, just restore the refresh timer.
 * If expired but refresh token is valid, attempt refresh.
 * If refresh also fails or is expired, mark disconnected.
 */
export async function validateStoredAuth(): Promise<void> {
  const lgState = useLemonGridStore.getState();
  console.log('[Auth] validateStoredAuth:', {
    hasAccessToken: !!lgState.accessToken,
    serverUrl: lgState.serverUrl,
    tokenExpiresAt: lgState.tokenExpiresAt,
    refreshTokenExpiresAt: lgState.refreshTokenExpiresAt,
    hasRefreshToken: !!lgState.refreshToken,
    isConnected: lgState.isConnected,
    now: Date.now(),
    authProvider: lgState.authProvider,
  });

  if (!lgState.accessToken || !lgState.serverUrl) {
    console.log('[Auth] validateStoredAuth: no token or serverUrl, skipping');
    return;
  }

  // Access token still valid — restore refresh timer and connected state
  if (lgState.tokenExpiresAt && lgState.tokenExpiresAt > Date.now() + 120000) {
    console.log('[Auth] validateStoredAuth: access token still valid, restoring connection');
    startTokenRefreshTimer();
    if (!lgState.isConnected) {
      useLemonGridStore.getState().setConnected(true);
    }
    // Re-sync tokens to Bridge (may have been lost on restart)
    try { await syncAuthToBridge(); } catch { /* Bridge may not be ready yet */ }
    return;
  }

  // Access token expired — try refresh if refresh token is still valid
  const refreshStillValid = !lgState.refreshTokenExpiresAt || lgState.refreshTokenExpiresAt > Date.now();
  console.log('[Auth] validateStoredAuth: access token expired, refreshStillValid:', refreshStillValid);
  if (lgState.refreshToken && refreshStillValid) {
    try {
      console.log('[Auth] validateStoredAuth: attempting token refresh...');
      const refreshResult = await refreshAccessToken(lgState.serverUrl, lgState.refreshToken);
      console.log('[Auth] validateStoredAuth: refresh succeeded');
      useLemonGridStore.getState().setAuth({
        accessToken: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token || lgState.refreshToken,
        expiresIn: refreshResult.expires_in,
        refreshExpiresIn: refreshResult.refresh_expires_in,
        username: lgState.username || '',
        role: lgState.userRole || '',
      });
      try { await syncAuthToBridge(); } catch { /* Bridge may not be ready yet */ }
      return;
    } catch (err) {
      console.error('[Auth] validateStoredAuth: refresh failed:', err);
    }
  }

  // All tokens expired — clear auth so UI shows login modal
  console.log('[Auth] validateStoredAuth: all tokens expired, marking disconnected');
  useLemonGridStore.getState().setConnected(false);
}

// Proactive token refresh timer
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Start a proactive token refresh timer.
 * Refreshes 5 minutes before token expiry to avoid interrupting the user.
 */
export function startTokenRefreshTimer(): void {
  stopTokenRefreshTimer();

  const lgState = useLemonGridStore.getState();
  if (!lgState.tokenExpiresAt || !lgState.refreshToken || !lgState.serverUrl) return;

  // Refresh 5 minutes before expiry
  const refreshAt = lgState.tokenExpiresAt - 5 * 60 * 1000;
  const delay = refreshAt - Date.now();

  if (delay <= 0) {
    // Already within 5 min of expiry or already expired — refresh immediately
    doProactiveRefresh();
    return;
  }

  refreshTimerId = setTimeout(doProactiveRefresh, delay);
}

export function stopTokenRefreshTimer(): void {
  if (refreshTimerId !== null) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
}

async function doProactiveRefresh(): Promise<void> {
  const lgState = useLemonGridStore.getState();
  if (!lgState.refreshToken || !lgState.serverUrl) {
    stopTokenRefreshTimer();
    return;
  }

  try {
    const refreshResult = await refreshAccessToken(lgState.serverUrl, lgState.refreshToken);
    useLemonGridStore.getState().setAuth({
      accessToken: refreshResult.access_token,
      refreshToken: refreshResult.refresh_token || lgState.refreshToken,
      expiresIn: refreshResult.expires_in,
      refreshExpiresIn: refreshResult.refresh_expires_in,
      username: lgState.username || '',
      role: lgState.userRole || '',
    });
    await syncAuthToBridge();
    // Restart timer for the new token
    startTokenRefreshTimer();
  } catch {
    stopTokenRefreshTimer();
    // Next API call will hit ensureValidToken() which handles the failure
  }
}

/**
 * Ensure we have a valid token. Per D-42, D-86, D-72:
 * 1. If token is still valid (>2 min remaining), return it.
 * 2. Try refreshAccessToken first.
 * 3. If refresh fails AND rememberMe AND encryptedPassword exists, re-login.
 * 4. If all fail, throw auth error.
 */
export async function ensureValidToken(): Promise<string> {
  const lgState = useLemonGridStore.getState();

  if (!lgState.accessToken) {
    throw new Error('Not authenticated');
  }

  // Check if token is still valid (with 2 minute buffer per D-42)
  if (lgState.tokenExpiresAt && lgState.tokenExpiresAt > Date.now() + 120000) {
    return lgState.accessToken;
  }

  // Try refresh token first (per D-79)
  if (lgState.refreshToken && lgState.serverUrl) {
    // If refresh token itself is expired, skip refresh attempt
    const refreshStillValid = !lgState.refreshTokenExpiresAt || lgState.refreshTokenExpiresAt > Date.now();
    if (refreshStillValid) {
      try {
        const refreshResult = await refreshAccessToken(lgState.serverUrl, lgState.refreshToken);

        // Update store with new token
        useLemonGridStore.getState().setAuth({
          accessToken: refreshResult.access_token,
          refreshToken: refreshResult.refresh_token || lgState.refreshToken,
          expiresIn: refreshResult.expires_in,
          refreshExpiresIn: refreshResult.refresh_expires_in,
          username: lgState.username || '',
          role: lgState.userRole || '',
        });

        // Sync to Bridge
        await syncAuthToBridge();

        return refreshResult.access_token;
      } catch {
        // Refresh failed, try re-login if possible
      }
    }
  }

  // Per D-14, D-15: DingTalk users should see QR code view, not password re-login
  if (lgState.authProvider === 'dingtalk') {
    useLemonGridStore.getState().setShowLoginModal(true);
    throw new Error('AUTH_EXPIRED_DINGTALK');
  }

  // Try re-login with stored credentials (per D-77, D-72)
  if (lgState.rememberMe && lgState.encryptedPassword && lgState.username && lgState.serverUrl) {
    try {
      const password = await decryptPassword(lgState.encryptedPassword);
      const loginResult = await loginToLemonGrid(lgState.serverUrl, lgState.username, password);

      useLemonGridStore.getState().setAuth({
        accessToken: loginResult.access_token,
        refreshToken: loginResult.token_type === 'bearer' ? lgState.refreshToken || undefined : undefined,
        expiresIn: loginResult.expires_in,
        username: loginResult.user.username,
        role: loginResult.user.role,
      });

      await syncAuthToBridge();

      return loginResult.access_token;
    } catch {
      // Re-login failed
    }
  }

  // All auth methods failed — update store so UI reflects expired state
  useLemonGridStore.getState().setConnected(false);
  useLemonGridStore.getState().setShowLoginModal(true);

  throw new Error('AUTH_EXPIRED');
}
