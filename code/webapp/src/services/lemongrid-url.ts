// LemonGrid server URL failover.
//
// Candidate URLs are evaluated in priority order:
//   1. User-provided URL (if any) — set via the login modal's settings dialog.
//   2. PRIMARY (IP).
//   3. FALLBACK (domain).
//
// On startup, `pickWorkingUrl` probes each candidate in order and locks the
// first reachable one. If a request to the locked URL fails (network error /
// timeout / 5xx), `withUrlFailover` switches to the next candidate (probing
// it first), verifies it, and retries the request exactly once. If the next
// candidate also fails, the original error/response is returned to the
// caller — we never silently loop through all three. The user is never
// shown the switching logic.

import { isUXPWebView, hasBridgeTransport, sendBridgeMessage } from './upload';

/** Primary (IP) and fallback (domain) LemonGrid server URLs. */
export const LEMONGRID_PRIMARY_URL = 'http://8.163.4.73';
export const LEMONGRID_FALLBACK_URL = 'http://www.lemongrid.cn';

/** 500ms timeout for any reachability probe. */
export const LEMONGRID_PROBE_TIMEOUT_MS = 500;

// ---------------------------------------------------------------------------
// Candidate list state.
// - `userProvidedUrl`: highest priority, set via ServerUrlSettingsModal and
//   persisted in localStorage by lemongridStore (zustand persist).
// - `lockedUrl`: the URL currently in use. After probe success or failover,
//   all requests route here until the next failure.
// ---------------------------------------------------------------------------

let userProvidedUrl: string | null = null;

/** Set the user-provided URL (highest priority). Pass null to clear it. */
export function setUserProvidedUrl(url: string | null): void {
  if (!url) {
    userProvidedUrl = null;
    return;
  }
  const trimmed = url.trim().replace(/\/+$/, '');
  userProvidedUrl = trimmed || null;
}

/** Return the user-provided URL (or null if none). */
export function getUserProvidedUrl(): string | null {
  return userProvidedUrl;
}

/** Clear the user-provided URL (equivalent to setUserProvidedUrl(null)). */
export function clearUserProvidedUrl(): void {
  userProvidedUrl = null;
}

let lockedUrl: string | null = null;

/** Return the currently locked URL (or null if no URL is locked yet). */
export function getLockedUrl(): string | null {
  return lockedUrl;
}

/** Force-set the locked URL. Used by `pickWorkingUrl` and `failover`. */
export function setLockedUrl(url: string): void {
  lockedUrl = url;
}

/** Clear the locked URL (e.g. on logout). */
export function clearLockedUrl(): void {
  lockedUrl = null;
}

/**
 * Return all candidate URLs in priority order:
 *   [user-provided?, primary, fallback].
 */
export function getEffectiveCandidates(): string[] {
  const candidates: string[] = [];
  if (userProvidedUrl) candidates.push(userProvidedUrl);
  candidates.push(LEMONGRID_PRIMARY_URL);
  candidates.push(LEMONGRID_FALLBACK_URL);
  return candidates;
}

/**
 * Return the next candidate URL after `current` in the priority list,
 * or null if `current` is the last one or not in the list.
 */
function nextCandidate(current: string): string | null {
  const candidates = getEffectiveCandidates();
  const idx = candidates.indexOf(current);
  if (idx === -1 || idx >= candidates.length - 1) return null;
  return candidates[idx + 1];
}

// ---------------------------------------------------------------------------
// Reachability probe.
// Treats "any response from the server" as reachable. The 500ms timeout is
// the whole point — we don't want to wait for slow servers when there are
// up to three candidates to try.
// ---------------------------------------------------------------------------

/**
 * Probe whether a URL is reachable within `timeoutMs`.
 * Returns true if the server responded (any HTTP status, including 404).
 * Returns false on network error, abort, or timeout.
 */
export async function verifyServerUrl(url: string, timeoutMs = LEMONGRID_PROBE_TIMEOUT_MS): Promise<boolean> {
  const normalized = url.replace(/\/+$/, '');
  const target = `${normalized}/`;

  try {
    if (isUXPWebView() && hasBridgeTransport()) {
      // Bridge probe — relies on lemongrid.fetch bridge handler.
      // If the bridge itself is not present, fail fast.
      const result = await sendBridgeMessage('lemongrid.fetch', {
        url: target,
        method: 'HEAD',
        timeout: timeoutMs,
      }) as { ok: boolean; status: number };

      // Any non-zero status means the server spoke to us.
      // Network error / timeout would have thrown from the bridge.
      return typeof result?.status === 'number' && result.status > 0;
    }

    // Browser mode — direct fetch with AbortController.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, { method: 'HEAD', signal: controller.signal });
      // Any status code (even 4xx/5xx) means the server is reachable.
      return res.status > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * Probe each candidate (user-provided → primary → fallback) and lock the
 * first reachable one. Returns the locked URL on success, or null if none
 * are reachable.
 *
 * Worst-case latency is ~3 × LEMONGRID_PROBE_TIMEOUT_MS (1.5s with the new
 * 500ms timeout) when all three fail. Callers should not invoke this on the
 * hot path; it's intended for startup / settings-save flows.
 */
export async function pickWorkingUrl(): Promise<string | null> {
  const candidates = getEffectiveCandidates();
  for (const url of candidates) {
    if (await verifyServerUrl(url)) {
      setLockedUrl(url);
      return url;
    }
  }
  // None reachable — leave lockedUrl unchanged (caller can fall through
  // to the existing login modal flow).
  return null;
}

// ---------------------------------------------------------------------------
// Per-request failover wrapper.
// Use this around any LemonGrid request. On infrastructure-level failure
// (network / timeout / 5xx), it switches the locked URL to the next
// candidate (probing it first) and retries the request exactly once.
// ---------------------------------------------------------------------------

/**
 * Classifies a thrown error as "infrastructure failure" (worth retrying on
 * another URL) vs. a caller error. Infrastructure: TypeError, AbortError.
 */
function isInfraError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const name = (err as { name?: string })?.name;
  if (name === 'AbortError') return true;
  // Some implementations use _name
  const _name = (err as { _name?: string })?._name;
  if (_name === 'AbortError') return true;
  return false;
}

/** Returns true for HTTP 5xx and 0 (network) responses — worth retrying. */
function isInfraStatus(status: number | undefined): boolean {
  if (status === undefined || status === null) return true; // bridge failure often lacks status
  if (status === 0) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

/**
 * Switch to the next candidate URL (by priority order), verify it, and lock
 * it. Returns the new locked URL on success, or null on failure.
 */
async function failover(): Promise<string | null> {
  const current = lockedUrl ?? LEMONGRID_PRIMARY_URL;
  const candidate = nextCandidate(current);
  if (!candidate) return null;
  if (await verifyServerUrl(candidate)) {
    setLockedUrl(candidate);
    return candidate;
  }
  return null;
}

/**
 * Run a LemonGrid request with automatic silent failover.
 *
 * - If `lockedUrl` is null, calls `pickWorkingUrl` first.
 * - If the request throws an infra error OR returns a 5xx/0 response,
 *   switches to the next candidate (probing it first) and retries the
 *   request exactly once.
 * - If the retry also fails, the original error/response is thrown back.
 *
 * Caller passes a `doFetch` function that performs the actual request given
 * the URL to use. This keeps the wrapper agnostic of bridge vs. browser mode.
 */
export async function withUrlFailover<T>(doFetch: (url: string) => Promise<T>): Promise<T> {
  // Lazy-init: probe candidates on first use.
  if (!lockedUrl) {
    await pickWorkingUrl();
  }

  const firstAttemptUrl = lockedUrl ?? LEMONGRID_PRIMARY_URL;
  try {
    return await doFetch(firstAttemptUrl);
  } catch (err) {
    if (!isInfraError(err)) throw err;
    // infra error → try the next candidate
    const newUrl = await failover();
    if (!newUrl) throw err;
    return await doFetch(newUrl);
  }
}

/**
 * Same as `withUrlFailover`, but for callers that already have a Response
 * object and want to retry on 5xx/0 status without throwing.
 *
 * The provided `doFetch` returns a Response (or a response-like object with
 * `ok` / `status`).
 */
export async function withUrlFailoverResponse<R extends { ok: boolean; status: number }>(
  doFetch: (url: string) => Promise<R>
): Promise<R> {
  if (!lockedUrl) {
    await pickWorkingUrl();
  }
  const firstAttemptUrl = lockedUrl ?? LEMONGRID_PRIMARY_URL;
  const first = await doFetch(firstAttemptUrl);
  if (first.ok || !isInfraStatus(first.status)) {
    return first;
  }
  const newUrl = await failover();
  if (!newUrl) return first;
  return await doFetch(newUrl);
}