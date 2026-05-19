// Bridge communication and upload service


export interface BridgeMessage {
  uuid: string;
  action: string;
  payload?: unknown;
}

export interface BridgeResponse {
  uuid: string;
  state: 'fulfilled' | 'rejected';
  data?: unknown;
  msg?: string;
  code?: string;
}

interface BridgeBinaryPayload {
  __base64__: true;
  data: string;
  contentType?: string;
}

interface UXPHostBridge {
  postMessage: (message: unknown) => void;
}

declare global {
  interface Window {
    uxpHost?: UXPHostBridge;
  }
}

function isBridgeBinaryPayload(value: unknown): value is BridgeBinaryPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.__base64__ === true && typeof candidate.data === 'string';
}

// Simple UUID generator for browser (crypto.getRandomValues)
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Bridge communication: Send message to UXP plugin and wait for response
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}>();

// Listen for bridge responses
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const response = event.data as BridgeResponse;
    if (!response || !response.uuid) return;
    if (response.state !== 'fulfilled' && response.state !== 'rejected') return;
    
    const pending = pendingRequests.get(response.uuid);
    if (!pending) return;
    
    pendingRequests.delete(response.uuid);
    
    if (response.state === 'fulfilled') {
      pending.resolve(response.data);
    } else {
      const errMsg = response.msg || `Bridge error: ${response.code || 'unknown'}`;
      console.error('[Bridge] Rejected response:', response);
      pending.reject(new Error(errMsg));
    }
  });
}

export async function sendBridgeMessage(action: string, payload?: unknown): Promise<unknown> {
  if (!hasBridgeTransport()) {
    throw new Error(`Bridge transport unavailable for action: ${action}`);
  }

  const uuid = generateUUID();
  
  const promise = new Promise((resolve, reject) => {
    pendingRequests.set(uuid, { resolve, reject });
    
    // Timeout: 90s for upload actions, 30s for others
    const timeoutMs = action === 'comfyui.uploadImage' ? 90000 : 30000;
    const timeout = setTimeout(() => {
      pendingRequests.delete(uuid);
      reject(new Error(`Bridge timeout for action: ${action}`));
    }, timeoutMs);
    
    // Store timeout ID for cleanup
    const oldResolve = resolve;
    pendingRequests.set(uuid, {
      resolve: (value) => {
        clearTimeout(timeout);
        oldResolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
  
  if (typeof window !== 'undefined') {
    const message = { uuid, action, payload };
    if (window.uxpHost && typeof window.uxpHost.postMessage === 'function') {
      window.uxpHost.postMessage(message);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*');
    }
  }
  return promise;
}

// Check if running in UXP WebView environment
export function isUXPWebView(): boolean {
  return hasBridgeTransport();
}

export function hasBridgeTransport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const hasUxpHost = !!window.uxpHost && typeof window.uxpHost.postMessage === 'function';
  const hasParentBridge = !!window.parent && window.parent !== window;
  return hasUxpHost || hasParentBridge;
}

// Bridge fetch - proxies network requests through UXP main.js
export async function bridgeFetch(
  url: string,
  options: RequestInit = {},
  timeout: number = 30000,
  bridgeOptions?: { retryOnAbort?: boolean }
): Promise<Response> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {};
  
  if (options.headers) {
    const headersObj = options.headers as Record<string, string>;
    for (const [key, value] of Object.entries(headersObj)) {
      headers[key] = value;
    }
  }

  const result = await sendBridgeMessage('comfyui.fetch', {
    url,
    method,
    headers,
    body: options.body as string | undefined,
    timeout,
    retryOnAbort: bridgeOptions?.retryOnAbort ?? true
  }) as {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: unknown;
  };

  // Sanitize headers: strip non-ISO-8859-1 characters (e.g. Chinese locale in Last-Modified)
  // The Headers constructor rejects any string with code points outside ISO-8859-1 range.
  const safeHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.headers)) {
    safeHeaders[key] = value.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  }

  // Convert bridge response back to fetch Response object
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
    clone: function() { return this as Response; },
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: url
  } as Response;
}

// Export active PS layer as PNG
export async function exportActiveLayerPng(): Promise<Blob> {
  try {
    const result = await sendBridgeMessage('ps.exportActiveLayerPng', {}) as {
      base64: string;
      filename: string;
      path?: string;
      sourceLayerName?: string;
      sourceLayerId?: number | null;
    };
    
    if (!result || !result.base64) {
      throw new Error('No image data returned from PS export');
    }
    
    // Convert base64 to Blob
    const binaryString = atob(result.base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'image/png' });
  } catch (error) {
    console.error('Failed to export layer from PS:', error);
    throw error;
  }
}

export async function exportSelectionPng(): Promise<Blob> {
  try {
    const result = await sendBridgeMessage('ps.exportSelectionPng', {}) as {
      base64: string;
      filename: string;
      path?: string;
    };

    if (!result || !result.base64) {
      throw new Error('No image data returned from PS selection export');
    }

    const binaryString = atob(result.base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'image/png' });
  } catch (error) {
    console.error('Failed to export selection from PS:', error);
    throw error;
  }
}

export async function importBase64ToPsLayer(payload: {
  base64Data: string;
  layerName?: string;
  mode?: 'pixel' | 'smartObject';
  workflowName?: string;
  mimeType?: string;
}): Promise<{
  success: boolean;
  mode: 'pixel' | 'smartObject';
  layerName: string;
  documentId: number;
}> {
  const result = await sendBridgeMessage('ps.importBase64AsLayer', payload) as {
    success: boolean;
    mode: 'pixel' | 'smartObject';
    layerName: string;
    documentId: number;
  };
  return result;
}

// Upload image to ComfyUI with automatic fallback and retry
export async function uploadToComfyUI(
  file: File,
  comfyuiUrl = 'http://127.0.0.1:8188',
  prefixMode: 'api' | 'oss' = 'oss'
): Promise<string> {
  const primaryPath = prefixMode === 'api' ? '/api/upload/image' : '/upload/image';
  const fallbackPath = prefixMode === 'api' ? '/upload/image' : '/api/upload/image';
  const MAX_RETRIES = 1;

  const attemptWithRetry = async (path: string, retries: number): Promise<string> => {
    try {
      return await attemptUpload(file, comfyuiUrl, path);
    } catch (error) {
      if (retries > 0) {
        console.warn(`[Upload] Path ${path} failed, retrying... (${retries} left)`, error instanceof Error ? error.message : error);
        return attemptWithRetry(path, retries - 1);
      }
      throw error;
    }
  };

  try {
    return await attemptWithRetry(primaryPath, MAX_RETRIES);
  } catch (primaryError) {
    console.warn(`[Upload] Primary path ${primaryPath} failed, trying fallback ${fallbackPath}`);
    try {
      const result = await attemptWithRetry(fallbackPath, MAX_RETRIES);
      console.log(`[Upload] Fallback path ${fallbackPath} succeeded, prefix mode may need update`);
      return result;
    } catch (fallbackError) {
      console.error(`[Upload] All attempts failed. Primary: ${primaryPath}, Fallback: ${fallbackPath}`);
      throw fallbackError;
    }
  }
}

async function attemptUpload(
  file: File,
  comfyuiUrl: string,
  uploadPath: string
): Promise<string> {
  const uploadUrl = `${comfyuiUrl.replace(/\/+$/, '')}${uploadPath}`;

  if (isUXPWebView()) {
    console.log(`[Upload] Bridge proxy: ${file.name} (${(file.size / 1024).toFixed(1)}KB) -> ${uploadUrl}`);

    let base64Data: string;
    try {
      base64Data = await fileToBase64(file);
    } catch (b64Err) {
      throw new Error(`Failed to read file for upload: ${b64Err instanceof Error ? b64Err.message : b64Err}`);
    }

    try {
      const result = await sendBridgeMessage('comfyui.uploadImage', {
        url: uploadUrl,
        filename: file.name,
        base64Data,
        mimeType: file.type
      }) as { ok: boolean; status?: number; data: { name: string } };

      if (!result.ok) {
        const statusMsg = result.status ? ` (HTTP ${result.status})` : '';
        throw new Error(`ComfyUI upload failed via Bridge${statusMsg}`);
      }

      return result.data.name;
    } catch (bridgeErr) {
      const msg = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
      console.error(`[Upload] Bridge upload failed: ${msg}, URL: ${uploadUrl}`);
      throw new Error(`Upload to ComfyUI failed: ${msg}`);
    }
  } else {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch.call(window, uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`ComfyUI upload failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { name: string };
    return result.name;
  }
}

// Utility: Convert File to base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 part after comma
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Utility: Validate image file
export function isValidImageFile(file: File): boolean {
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  return validTypes.includes(file.type) && file.size > 0 && file.size < 50 * 1024 * 1024; // 50MB limit
}
