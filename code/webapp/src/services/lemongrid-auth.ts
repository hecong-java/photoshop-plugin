// LemonGrid authentication and API proxy service

import { sendBridgeMessage, isUXPWebView, hasBridgeTransport } from './upload';
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

// AES-GCM encryption constants per D-78
const ENCRYPTION_SALT = new TextEncoder().encode('Ningleai-LemonGrid-Encrypt-Salt');
const ENCRYPTION_KEY_MATERIAL = 'Ningleai-LG-DeviceKey-v1';

/**
 * Derive an AES-GCM key from a static device key material + salt.
 * Per D-78: AES-GCM encryption via Web Crypto API with device-derived key.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
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
    // Browser mode - add Authorization header manually from store
    const lgState = useLemonGridStore.getState();
    const headers = new Headers(options.headers);
    if (lgState.accessToken) {
      headers.set('Authorization', `Bearer ${lgState.accessToken}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Shape Bridge response data into a Response-like object.
 * Same pattern as bridgeFetch in upload.ts.
 */
function shapeBridgeResponse(
  result: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: unknown;
  },
  url: string
): Response {
  const isBinaryPayload = (
    value: unknown
  ): value is { __base64__: true; data: string; contentType?: string } => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return candidate.__base64__ === true && typeof candidate.data === 'string';
  };

  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    headers: new Headers(result.headers),
    json: async () => {
      if (isBinaryPayload(result.data)) {
        throw new Error('Response is binary, not JSON');
      }
      return result.data as Record<string, unknown>;
    },
    text: async () => {
      if (typeof result.data === 'string') return result.data;
      return JSON.stringify(result.data);
    },
    arrayBuffer: async () => {
      if (isBinaryPayload(result.data)) {
        const base64 = result.data.data;
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      }
      const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      return new TextEncoder().encode(text).buffer;
    },
    blob: async () => {
      if (isBinaryPayload(result.data)) {
        const base64 = result.data.data;
        const contentType = result.data.contentType || 'application/octet-stream';
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: contentType });
      }
      const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      return new Blob([text], { type: 'application/json' });
    },
    clone: function () {
      return this as Response;
    },
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: url,
  } as Response;
}

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
    try {
      const refreshResult = await refreshAccessToken(lgState.serverUrl, lgState.refreshToken);

      // Update store with new token
      useLemonGridStore.getState().setAuth({
        accessToken: refreshResult.access_token,
        refreshToken: lgState.refreshToken, // Keep existing refresh token
        expiresIn: refreshResult.expires_in,
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

  throw new Error('AUTH_EXPIRED');
}
