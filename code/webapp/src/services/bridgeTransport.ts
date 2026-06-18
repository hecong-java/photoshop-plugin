// Bridge Transport — shared response shaping for UXP Bridge fetches.
//
// The UXP Bridge serializes fetch responses as a plain JSON object:
//   { ok, status, statusText, headers: { [k]: string }, data: unknown }
//
// Binary payloads are base64-encoded with a sentinel:
//   { __base64__: true, data: string, contentType?: string }
//
// This module converts that shape into a fetch Response-compatible object.
// Previously this 50-line block was duplicated in `upload.ts` (as part of
// `bridgeFetch`) and `lemongrid-auth.ts` (as `shapeBridgeResponse`).
// Extracted here so both call sites stay in sync.

export interface BridgeResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
}

export interface BridgeBinaryPayload {
  __base64__: true;
  data: string;
  contentType?: string;
}

export interface ShapeOptions {
  /** Strip non-ISO-8859-1 characters from header values. Defaults to true.
   *  The Headers constructor rejects any string with code points outside the
   *  ISO-8859-1 range, which breaks on Chinese/Unicode-locale header values
   *  like "Last-Modified: 周三, 12 6月 2026 12:00:00 GMT". */
  sanitizeHeaders?: boolean;
}

export const isBridgeBinaryPayload = (value: unknown): value is BridgeBinaryPayload => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.__base64__ === true && typeof candidate.data === 'string';
};

/**
 * Sanitize header values by stripping characters outside the ISO-8859-1 range.
 */
const sanitizeHeaderValues = (headers: Record<string, string>): Record<string, string> => {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = value.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  }
  return safe;
};

/**
 * Convert a Bridge response payload into a fetch Response-compatible object.
 * Use this whenever you receive a result from `sendBridgeMessage('*.fetch', ...)`.
 */
export function shapeBridgeResponse(
  result: BridgeResult,
  url: string,
  options: ShapeOptions = {}
): Response {
  const { sanitizeHeaders = true } = options;
  const safeHeaders = sanitizeHeaders ? sanitizeHeaderValues(result.headers) : result.headers;

  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    headers: new Headers(safeHeaders),
    json: async () => {
      if (isBridgeBinaryPayload(result.data)) {
        throw new Error('Response is binary, not JSON');
      }
      return result.data as Record<string, unknown>;
    },
    text: async () => {
      if (typeof result.data === 'string') return result.data;
      return JSON.stringify(result.data);
    },
    arrayBuffer: async () => {
      if (isBridgeBinaryPayload(result.data)) {
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
      if (isBridgeBinaryPayload(result.data)) {
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
    clone() { return this as Response; },
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url,
  } as Response;
}
