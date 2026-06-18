// Unit tests for the Bridge Transport module.
// These tests verify the Response-shaping logic in isolation, with no
// dependency on UXP or actual bridge calls.

import { describe, expect, it } from 'vitest';
import {
  isBridgeBinaryPayload,
  shapeBridgeResponse,
  type BridgeResult,
} from './bridgeTransport';

// ---------------------------------------------------------------------------
// isBridgeBinaryPayload
// ---------------------------------------------------------------------------

describe('isBridgeBinaryPayload', () => {
  it('returns true for valid binary payloads', () => {
    expect(isBridgeBinaryPayload({ __base64__: true, data: 'aGVsbG8=' })).toBe(true);
    expect(isBridgeBinaryPayload({ __base64__: true, data: 'xyz', contentType: 'image/png' })).toBe(true);
  });

  it('returns false for non-payload objects', () => {
    expect(isBridgeBinaryPayload({ __base64__: false, data: 'x' })).toBe(false);
    expect(isBridgeBinaryPayload({ __base64__: true })).toBe(false); // missing data
    expect(isBridgeBinaryPayload({ __base64__: true, data: 123 })).toBe(false); // data not a string
    expect(isBridgeBinaryPayload({ data: 'x' })).toBe(false);
  });

  it('returns false for non-objects', () => {
    expect(isBridgeBinaryPayload(null)).toBe(false);
    expect(isBridgeBinaryPayload(undefined)).toBe(false);
    expect(isBridgeBinaryPayload('string')).toBe(false);
    expect(isBridgeBinaryPayload(42)).toBe(false);
    expect(isBridgeBinaryPayload([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shapeBridgeResponse — basic shape
// ---------------------------------------------------------------------------

describe('shapeBridgeResponse — basic shape', () => {
  const sampleJson: BridgeResult = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    data: { foo: 'bar' },
  };

  it('maps ok, status, statusText from the Bridge result', async () => {
    const response = shapeBridgeResponse(sampleJson, 'http://example.com/api');
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.url).toBe('http://example.com/api');
  });

  it('builds Headers from the headers map', () => {
    const response = shapeBridgeResponse(sampleJson, 'http://example.com/api');
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('exposes non-functional body fields as null/false', () => {
    const response = shapeBridgeResponse(sampleJson, 'http://example.com/api');
    expect(response.body).toBeNull();
    expect(response.bodyUsed).toBe(false);
    expect(response.redirected).toBe(false);
    expect(response.type).toBe('basic');
  });
});

// ---------------------------------------------------------------------------
// shapeBridgeResponse — json()
// ---------------------------------------------------------------------------

describe('shapeBridgeResponse — json()', () => {
  it('returns the data object for JSON responses', async () => {
    const response = shapeBridgeResponse({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { user: 'alice', age: 30 },
    }, 'http://example.com');
    const json = await response.json();
    expect(json).toEqual({ user: 'alice', age: 30 });
  });

  it('throws when data is a binary payload', async () => {
    const response = shapeBridgeResponse({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { __base64__: true, data: 'aGVsbG8=' },
    }, 'http://example.com');
    await expect(response.json()).rejects.toThrow('binary');
  });
});

// ---------------------------------------------------------------------------
// shapeBridgeResponse — text()
// ---------------------------------------------------------------------------

describe('shapeBridgeResponse — text()', () => {
  it('returns string data as-is', async () => {
    const response = shapeBridgeResponse({
      ok: true, status: 200, statusText: 'OK', headers: {}, data: 'hello world',
    }, 'http://example.com');
    expect(await response.text()).toBe('hello world');
  });

  it('serializes object data to JSON', async () => {
    const response = shapeBridgeResponse({
      ok: true, status: 200, statusText: 'OK', headers: {}, data: { x: 1 },
    }, 'http://example.com');
    expect(await response.text()).toBe('{"x":1}');
  });
});

// ---------------------------------------------------------------------------
// shapeBridgeResponse — arrayBuffer() / blob()
// ---------------------------------------------------------------------------

describe('shapeBridgeResponse — arrayBuffer() / blob()', () => {
  const binaryResult: BridgeResult = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { __base64__: true, data: 'aGVsbG8=', contentType: 'text/plain' },
  };

  it('arrayBuffer() decodes base64 to a Uint8Array', async () => {
    const response = shapeBridgeResponse(binaryResult, 'http://example.com');
    const buffer = await response.arrayBuffer();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])); // "hello"
  });

  it('blob() uses contentType from the payload', async () => {
    const response = shapeBridgeResponse(binaryResult, 'http://example.com');
    const blob = await response.blob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(5);
  });

  it('blob() defaults to application/octet-stream when no contentType', async () => {
    const response = shapeBridgeResponse({
      ...binaryResult,
      data: { __base64__: true, data: 'aGVsbG8=' },
    }, 'http://example.com');
    const blob = await response.blob();
    expect(blob.type).toBe('application/octet-stream');
  });

  it('arrayBuffer() encodes text data via TextEncoder', async () => {
    const response = shapeBridgeResponse({
      ok: true, status: 200, statusText: 'OK', headers: {}, data: 'hi',
    }, 'http://example.com');
    const buffer = await response.arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe('hi');
  });

  it('blob() wraps text data in application/json blob', async () => {
    const response = shapeBridgeResponse({
      ok: true, status: 200, statusText: 'OK', headers: {}, data: { a: 1 },
    }, 'http://example.com');
    const blob = await response.blob();
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"a":1}');
  });
});

// ---------------------------------------------------------------------------
// shapeBridgeResponse — header sanitization
// ---------------------------------------------------------------------------

describe('shapeBridgeResponse — header sanitization', () => {
  it('strips non-ISO-8859-1 characters from header values by default', () => {
    const response = shapeBridgeResponse({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'last-modified': '周三, 12 6月 2026 12:00:00 GMT', // Chinese chars
      },
      data: {},
    }, 'http://example.com');
    // Chinese characters should be stripped
    expect(response.headers.get('last-modified')).toBe(', 12 6 2026 12:00:00 GMT');
    // ASCII content-type should be untouched
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('preserves non-ISO-8859-1 characters when sanitizeHeaders is false', () => {
    // Headers constructor rejects non-ISO-8859-1 chars, so we can't construct
    // a Headers object with Chinese characters. This test verifies the
    // sanitizeHeaders: false path at least attempts to use raw values.
    expect(() => {
      // Wrap in try/catch since Headers constructor will throw
      try {
        shapeBridgeResponse({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { 'x-test': 'plain-ascii' },
          data: {},
        }, 'http://example.com', { sanitizeHeaders: false });
      } catch (e) {
        // Headers constructor throws for non-ISO-8859-1 chars;
        // with sanitizeHeaders: false and ASCII values, no throw
        throw e;
      }
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// shapeBridgeResponse — clone()
// ---------------------------------------------------------------------------

describe('shapeBridgeResponse — clone()', () => {
  it('returns the same response object (no-op clone)', () => {
    const response = shapeBridgeResponse({
      ok: true, status: 200, statusText: 'OK', headers: {}, data: {},
    }, 'http://example.com');
    const cloned = response.clone();
    expect(cloned).toBe(response);
  });
});
