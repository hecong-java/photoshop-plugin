import { describe, expect, it } from 'vitest';
import { ComfyUIClient, normalizeBaseUrl, type Fetcher } from './comfyui';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('normalizeBaseUrl', () => {
  it('strips trailing slash and keeps protocol', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188');
  });
});

describe('ComfyUIClient', () => {
  it('falls back to /api prefix when /prompt is unavailable on OSS endpoints', async () => {
    const fetcher: Fetcher = async (input) => {
      const url = String(input);

    if (url.endsWith('/api/prompt')) {
      return jsonResponse({ prompt_id: 'ok' });
    }
    if (url.endsWith('/prompt')) {
      return new Response(null, { status: 404 });
    }

      if (url.includes('/api/userdata?dir=ps-workflows')) {
        return jsonResponse([{ name: 'demo', path: 'workflows/demo.json' }]);
      }
      if (url.includes('/api/userdata/ps-workflows%2Fdemo.json')) {
        return jsonResponse({ nodes: {} });
      }
      if (url.endsWith('/api/system_stats')) {
        return jsonResponse({ version: '1.0.0' });
      }

      return jsonResponse({ ok: true });
    };

    const client = new ComfyUIClient({
      baseUrl: 'http://127.0.0.1:8188',
      fetcher,
      timeoutMs: 1000,
      totalProbeTimeoutMs: 5000,
    });

    const capabilities = await client.probeEndpoints();

    expect(capabilities.prefixMode).toBe('api');
    expect(capabilities.endpoints.prompt.status).toBe('ok');
    expect(capabilities.endpoints.workflowList.status).toBe('ok');
  });
});
