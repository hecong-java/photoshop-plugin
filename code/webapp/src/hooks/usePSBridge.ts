import { useCallback } from 'react';

export type PSImportMode = 'pixel' | 'smartObject';

export interface BridgeResponse {
  uuid: string;
  state: 'fulfilled' | 'rejected';
  data?: unknown;
  msg?: string;
  code?: string;
}

interface UXPHostBridge {
  postMessage: (message: unknown) => void;
}

declare global {
  interface Window {
    uxpHost?: UXPHostBridge;
  }
}

export interface PSImportPayload {
  imagePath: string;
  layerName?: string;
  mode?: PSImportMode;
  workflowName?: string;
}

export interface PSImportBase64Payload {
  base64Data: string;
  layerName?: string;
  mode?: PSImportMode;
  workflowName?: string;
  mimeType?: string;
}

const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}>();

let listenerAttached = false;

const ensureBridgeListener = () => {
  if (listenerAttached || typeof window === 'undefined') {
    return;
  }

  listenerAttached = true;
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
};

const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const sendBridgeMessage = async (action: string, payload?: unknown): Promise<unknown> => {
  ensureBridgeListener();
  const uuid = generateUUID();

  const promise = new Promise((resolve, reject) => {
    pendingRequests.set(uuid, { resolve, reject });

    const timeout = setTimeout(() => {
      pendingRequests.delete(uuid);
      reject(new Error(`Bridge timeout for action: ${action}`));
    }, 30000);

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
    } else if (window.parent) {
      window.parent.postMessage(message, '*');
    }
  }

  return promise;
};

export const usePSBridge = () => {
  const importImageAsLayer = useCallback(async (payload: PSImportPayload) => {
    return sendBridgeMessage('ps.importImageAsLayer', payload) as Promise<{
      success: boolean;
      mode: PSImportMode;
      layerName: string;
      documentId: number;
    }>;
  }, []);

  const exportActiveLayerPng = useCallback(async () => {
    return sendBridgeMessage('ps.exportActiveLayerPng') as Promise<{
      base64: string;
      filename: string;
      path?: string;
    }>;
  }, []);

  const importBase64AsLayer = useCallback(async (payload: PSImportBase64Payload) => {
    return sendBridgeMessage('ps.importBase64AsLayer', payload) as Promise<{
      success: boolean;
      mode: PSImportMode;
      layerName: string;
      documentId: number;
    }>;
  }, []);

  return {
    importImageAsLayer,
    exportActiveLayerPng,
    importBase64AsLayer
  };
};
