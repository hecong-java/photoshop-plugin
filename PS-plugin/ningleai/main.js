const ALLOWED_ORIGINS = [
  'http://123.207.74.28:8080',
];

const normalizeOrigin = (origin) => {
  if (!origin) return '';
  const trimmed = origin.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .replace(/^(https?:\/\/[^/]+).*/, '$1');
  }
};
const WEBVIEW_ID = 'ningleai-ps-plugin';

const { core, action, app } = require('photoshop');
const { localFileSystem, formats } = require('uxp').storage;
const { shell } = require('uxp');

const webviewEl = document.getElementById(WEBVIEW_ID);
console.log('[Plugin] webviewEl:', webviewEl ? 'found' : 'NOT FOUND');

// Auto cache-bust: append timestamp to webview URL
if (webviewEl) {
  const baseUrl = 'http://123.207.74.28:8080';
  const currentSrc = webviewEl.getAttribute('src') || '';
  if (currentSrc.startsWith(baseUrl)) {
    const timestamp = Date.now();
    webviewEl.setAttribute('src', `${baseUrl}?t=${timestamp}`);
  }
}

const getErrorMsg = (err) => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return JSON.stringify(err);
};

const toBridgeError = (code, message) => ({ code, message });

const settingsStorage = {
  data: {},
  get(key) {
    return this.data[key];
  },
  set(key, value) {
    this.data[key] = value;
  }
};

const trimTrailingSlashes = (s) => (typeof s === 'string' ? s.replace(/\/+$/, '') : s);

const getComfyBaseUrlFromSettings = () => {
  // Support a few likely keys from different UIs.
  const keys = [
    'comfyui.baseUrl',
    'comfyuiBaseUrl',
    'comfyui.url',
    'comfyuiUrl',
    'comfy.baseUrl',
    'comfyUrl',
  ];
  for (const k of keys) {
    const v = settingsStorage.get(k);
    if (typeof v === 'string' && v.trim()) return trimTrailingSlashes(v.trim());
  }
  return '';
};

const resolveComfyUploadUrl = (payload) => {
  const explicitUrl = payload?.url || payload?.uploadUrl;
  if (typeof explicitUrl === 'string' && explicitUrl.trim()) {
    return explicitUrl.trim();
  }

  const baseUrl = payload?.baseUrl || payload?.comfyuiBaseUrl || getComfyBaseUrlFromSettings();
  const normalizedBase = typeof baseUrl === 'string' && baseUrl.trim()
    ? trimTrailingSlashes(baseUrl.trim())
    : '';

  if (normalizedBase) return `${normalizedBase}/upload/image`;

  // Most common default when running ComfyUI locally.
  return 'http://127.0.0.1:8188/upload/image';
};

const getDefaultLayerName = (workflowName) => {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  return `${workflowName || 'workflow'}-${stamp}`;
};

const ensureDownloadsFolder = async () => {
  const dataFolder = await localFileSystem.getDataFolder();
  const entries = await dataFolder.getEntries();
  const existing = entries.find((entry) => entry.isFolder && entry.name === 'downloads');
  if (existing) {
    return existing;
  }
  return dataFolder.createFolder('downloads');
};

const sanitizeFilename = (filename) => {
  if (!filename || typeof filename !== 'string') {
    return `download-${Date.now()}.bin`;
  }
  const safe = filename.replace(/[\\/:*?"<>|]/g, '_').trim();
  return safe || `download-${Date.now()}.bin`;
};

const importImageAsLayer = async ({ imagePath, layerName, mode = 'pixel', workflowName }) => {
  if (!imagePath || typeof imagePath !== 'string') {
    throw toBridgeError('INVALID_PAYLOAD', 'ps.importImageAsLayer: missing or invalid "imagePath" parameter');
  }

  if (mode !== 'pixel' && mode !== 'smartObject') {
    throw toBridgeError('INVALID_PAYLOAD', 'ps.importImageAsLayer: "mode" must be "pixel" or "smartObject"');
  }

  const activeDoc = app.activeDocument;
  if (!activeDoc) {
    throw toBridgeError('NO_ACTIVE_DOCUMENT', 'ps.importImageAsLayer: no active Photoshop document');
  }

  const finalLayerName = layerName && typeof layerName === 'string'
    ? layerName
    : getDefaultLayerName(workflowName);

  return core.executeAsModal(async () => {
    try {
      const imageEntry = await localFileSystem.getEntryWithUrl(imagePath);
      const imageToken = localFileSystem.createSessionToken(imageEntry);

      await action.batchPlay([
        {
          _obj: 'placeEvent',
          null: {
            _path: imageToken,
            _kind: 'local'
          },
          freeTransformCenterState: {
            _enum: 'quadCenterState',
            _value: 'QCSAverage'
          },
          offset: {
            _obj: 'offset',
            horizontal: {
              _unit: 'pixelsUnit',
              _value: 0
            },
            vertical: {
              _unit: 'pixelsUnit',
              _value: 0
            }
          }
        }
      ], { synchronousExecution: true, modalBehavior: 'execute' });

      if (mode === 'pixel') {
        await action.batchPlay([
          {
            _obj: 'rasterizeLayer',
            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
            what: { _enum: 'rasterizeItem', _value: 'placed' }
          }
        ], { synchronousExecution: true, modalBehavior: 'execute' });
      }

      await action.batchPlay([
        {
          _obj: 'set',
          _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
          to: {
            _obj: 'layer',
            name: finalLayerName
          }
        }
      ], { synchronousExecution: true, modalBehavior: 'execute' });

      return {
        success: true,
        mode,
        layerName: finalLayerName,
        documentId: activeDoc.id
      };
    } catch (error) {
      throw toBridgeError('PS_IMPORT_FAILED', `ps.importImageAsLayer failed: ${getErrorMsg(error)}`);
    }
  }, { commandName: 'Import Image As Layer' });
};

const exportActiveLayerPngInternal = async (activeDoc, activeLayer) => {
  const tempFolder = await localFileSystem.getTemporaryFolder();
  const exportFolderName = `ps-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const exportFolder = await tempFolder.createFolder(exportFolderName);
  const exportedFile = await exportFolder.createFile(`selected-layer-${Date.now()}.png`, { overwrite: true });

  const collectLayers = (layers, out = []) => {
    for (const layer of layers || []) {
      out.push(layer);
      if (layer.layers && layer.layers.length) {
        collectLayers(layer.layers, out);
      }
    }
    return out;
  };

  const allLayers = collectLayers(activeDoc.layers, []);
  const visibilityById = new Map();
  for (const layer of allLayers) {
    visibilityById.set(layer.id, layer.visible);
  }

  const keepVisibleLayerIds = new Set();
  keepVisibleLayerIds.add(activeLayer.id);
  let parent = activeLayer.parent;
  while (parent && parent.id !== activeDoc.id) {
    keepVisibleLayerIds.add(parent.id);
    parent = parent.parent;
  }

  for (const layer of allLayers) {
    const shouldBeVisible = keepVisibleLayerIds.has(layer.id);
    if (layer.visible !== shouldBeVisible) {
      layer.visible = shouldBeVisible;
    }
  }

  try {
    await activeDoc.saveAs.png(exportedFile, {}, true);
  } finally {
    for (const layer of allLayers) {
      const originalVisible = visibilityById.get(layer.id);
      if (typeof originalVisible === 'boolean' && layer.visible !== originalVisible) {
        layer.visible = originalVisible;
      }
    }
  }

  const fileData = await exportedFile.read({ format: formats.binary });

  let binary = '';
  const bytes = new Uint8Array(fileData);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }

  const base64 = btoa(binary);

  return {
    base64,
    path: `${exportFolder.nativePath}/${exportedFile.name}`,
    filename: exportedFile.name,
    sourceLayerName: activeLayer.name || '',
    sourceLayerId: activeLayer.id || null
  };
};

const exportActiveLayerPng = async () => {
  const activeDoc = app.activeDocument;
  if (!activeDoc) {
    throw toBridgeError('NO_ACTIVE_DOCUMENT', 'ps.exportActiveLayerPng: no active Photoshop document');
  }

  const activeLayer = activeDoc.activeLayers && activeDoc.activeLayers[0];
  if (!activeLayer) {
    throw toBridgeError('NO_ACTIVE_LAYER', 'ps.exportActiveLayerPng: no active selected layer');
  }
  if (!activeLayer.visible) {
    throw toBridgeError('ACTIVE_LAYER_HIDDEN', 'ps.exportActiveLayerPng: active selected layer is hidden; please make it visible');
  }

  return core.executeAsModal(async () => {
    try {
      return await exportActiveLayerPngInternal(activeDoc, activeLayer);
    } catch (error) {
      throw toBridgeError('PS_EXPORT_FAILED', `ps.exportActiveLayerPng failed: ${getErrorMsg(error)}`);
    }
  }, { commandName: 'Export Active Layer PNG' });
};

const exportSelectionPng = async () => {
  const activeDoc = app.activeDocument;
  if (!activeDoc) {
    throw toBridgeError('NO_ACTIVE_DOCUMENT', 'ps.exportSelectionPng: no active Photoshop document');
  }

  const activeLayer = activeDoc.activeLayers && activeDoc.activeLayers[0];
  if (!activeLayer) {
    throw toBridgeError('NO_ACTIVE_LAYER', 'ps.exportSelectionPng: no active selected layer');
  }

  return core.executeAsModal(async () => {
    try {
      const tempFolder = await localFileSystem.getTemporaryFolder();
      const exportFolderName = `ps-selection-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const exportFolder = await tempFolder.createFolder(exportFolderName);

      const fileNamePrefix = `selected-region-${Date.now()}`;
      const beforeEntries = await exportFolder.getEntries();
      const beforeNames = new Set(beforeEntries.map((entry) => entry.name));

      const runSelectionExport = async (targetRef) => {
        await action.batchPlay([
          {
            _obj: 'exportSelectionAsFileTypePressed',
            _target: targetRef,
            fileType: 'png',
            quality: 32,
            metadata: 0,
            sRGB: true,
            openWindow: false,
            fileNamePrefix,
            destFolder: exportFolder.nativePath
          }
        ], { synchronousExecution: true, modalBehavior: 'execute' });
      };

      try {
        await runSelectionExport([{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }]);
      } catch (error) {
        console.warn('[Bridge] Selection export with document target failed, retrying with layer target:', error);
        await runSelectionExport([{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }]);
      }

      let exportedFile = null;
      for (let attempt = 0; attempt < 10 && !exportedFile; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        const afterEntries = await exportFolder.getEntries();
        exportedFile = afterEntries.find(
          (entry) =>
            entry.isFile &&
            !beforeNames.has(entry.name) &&
            entry.name.startsWith(fileNamePrefix) &&
            entry.name.toLowerCase().endsWith('.png')
        );

        if (!exportedFile) {
          exportedFile = afterEntries.find(
            (entry) => entry.isFile && !beforeNames.has(entry.name) && entry.name.toLowerCase().endsWith('.png')
          );
        }
      }

      if (!exportedFile) {
        console.warn('[Bridge] Selection export command produced no file, fallback to copy-via-layer export');

        const duplicateResult = await action.batchPlay([
          {
            _obj: 'copyToLayer'
          }
        ], { synchronousExecution: true, modalBehavior: 'execute' });

        let copiedLayerId = null;
        const newLayerRef = duplicateResult?.[0]?.layer;
        if (Array.isArray(newLayerRef) && newLayerRef[0] && typeof newLayerRef[0]._id === 'number') {
          copiedLayerId = newLayerRef[0]._id;
        } else {
          const newestLayer = activeDoc.activeLayers && activeDoc.activeLayers[0];
          copiedLayerId = newestLayer?.id ?? null;
        }

        if (!copiedLayerId) {
          throw toBridgeError('NO_SELECTION_EXPORT', 'ps.exportSelectionPng: selection exists but failed to create export layer');
        }

        try {
          const copiedLayer = (activeDoc.layers || []).find((layer) => layer.id === copiedLayerId)
            || (activeDoc.activeLayers && activeDoc.activeLayers[0]);

          if (!copiedLayer) {
            throw toBridgeError('NO_SELECTION_EXPORT', 'ps.exportSelectionPng: could not resolve copied selection layer');
          }

          const exportedFromLayer = await exportActiveLayerPngInternal(activeDoc, copiedLayer);
          return {
            base64: exportedFromLayer.base64,
            path: exportedFromLayer.path,
            filename: exportedFromLayer.filename
          };
        } finally {
          try {
            await action.batchPlay([
              {
                _obj: 'delete',
                _target: [{ _ref: 'layer', _id: copiedLayerId }]
              }
            ], { synchronousExecution: true, modalBehavior: 'execute' });
          } catch (cleanupError) {
            console.warn('[Bridge] Failed to clean up copied selection layer:', cleanupError);
          }

          try {
            await action.batchPlay([
              {
                _obj: 'select',
                _target: [{ _ref: 'layer', _id: activeLayer.id }],
                makeVisible: false
              }
            ], { synchronousExecution: true, modalBehavior: 'execute' });
          } catch (restoreError) {
            console.warn('[Bridge] Failed to restore original active layer:', restoreError);
          }
        }
      }

      const fileData = await exportedFile.read({ format: formats.binary });

      let binary = '';
      const bytes = new Uint8Array(fileData);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }

      const base64 = btoa(binary);

      return {
        base64,
        path: `${exportFolder.nativePath}/${exportedFile.name}`,
        filename: exportedFile.name
      };
    } catch (error) {
      const message = getErrorMsg(error);
      if (typeof message === 'string' && message.includes('The command “Copy” is not currently available')) {
        throw toBridgeError('NO_SELECTION', 'ps.exportSelectionPng: no active pixel selection');
      }
      if (typeof message === 'string' && message.includes('No pixels are selected')) {
        throw toBridgeError('NO_SELECTION', 'ps.exportSelectionPng: no active pixel selection');
      }
      throw toBridgeError('PS_EXPORT_FAILED', `ps.exportSelectionPng failed: ${message}`);
    }
  }, { commandName: 'Export Selection PNG' });
};

const importBase64AsLayer = async ({ base64Data, layerName, mode = 'pixel', workflowName, mimeType = 'image/png' }) => {
  if (!base64Data || typeof base64Data !== 'string') {
    throw toBridgeError('INVALID_PAYLOAD', 'ps.importBase64AsLayer: missing or invalid "base64Data" parameter');
  }

  const extension = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const tempFolder = await localFileSystem.getTemporaryFolder();
  const fileName = `ps-bridge-import-${Date.now()}.${extension}`;
  const tempFile = await tempFolder.createFile(fileName, { overwrite: true });

  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  await tempFile.write(bytes.buffer, { format: formats.binary });

  return importImageAsLayer({
    imagePath: tempFile.nativePath,
    layerName,
    mode,
    workflowName
  });
};

const handlers = {
  'settings.get': async (payload) => {
    const { key } = payload;
    if (!key || typeof key !== 'string') {
      throw new Error('settings.get: missing or invalid "key" parameter');
    }
    return settingsStorage.get(key);
  },

  'settings.set': async (payload) => {
    const { key, value } = payload;
    if (!key || typeof key !== 'string') {
      throw new Error('settings.set: missing or invalid "key" parameter');
    }
    settingsStorage.set(key, value);
    return { success: true };
  },

  'fs.saveDownload': async (payload) => {
    const { filename, data } = payload;
    if (!filename || typeof filename !== 'string') {
      throw new Error('fs.saveDownload: missing or invalid "filename" parameter');
    }
    if (!data) {
      throw new Error('fs.saveDownload: missing "data" parameter');
    }

    const bytes = Array.isArray(data) ? Uint8Array.from(data) : new Uint8Array(data);
    const downloadsFolder = await ensureDownloadsFolder();
    const safeFilename = sanitizeFilename(filename);
    const file = await downloadsFolder.createFile(safeFilename, { overwrite: true });
    await file.write(bytes.buffer, { format: formats.binary });

    return {
      path: file.nativePath || `${downloadsFolder.nativePath}/${safeFilename}`,
      success: true,
      filename: safeFilename
    };
  },

  'fs.listDownloads': async () => {
    const downloadsFolder = await ensureDownloadsFolder();
    const entries = await downloadsFolder.getEntries();
    const files = entries.filter((entry) => entry.isFile);
    const list = [];
    for (const file of files) {
      let size = 0;
      try {
        const content = await file.read({ format: formats.binary });
        size = content?.byteLength || 0;
      } catch {
        size = 0;
      }
      list.push({
        filename: file.name,
        path: file.nativePath || `${downloadsFolder.nativePath}/${file.name}`,
        size,
        modifiedTime: Date.now()
      });
    }
    return list;
  },

  'fs.deleteDownload': async (payload) => {
    const { path } = payload || {};
    if (!path || typeof path !== 'string') {
      throw new Error('fs.deleteDownload: missing or invalid "path" parameter');
    }

    const downloadsFolder = await ensureDownloadsFolder();
    const entries = await downloadsFolder.getEntries();
    const target = entries.find((entry) => entry.isFile && (entry.nativePath === path || path.endsWith(entry.name)));
    if (!target) {
      return { success: false };
    }
    await target.delete();
    return { success: true };
  },

  'fs.readPluginConfig': async (payload) => {
    const { filename = 'node-config.json' } = payload || {};
    try {
      const configFile = await localFileSystem.getEntryWithUrl(`plugin:/${filename}`);
      if (!configFile || !configFile.isFile) {
        return { exists: false, data: null };
      }
      const content = await configFile.read();
      const config = JSON.parse(content);
      return { exists: true, data: config };
    } catch (error) {
      return {
        exists: false,
        data: null,
        error: error.message || 'Failed to read config'
      };
    }
  },

  'fs.openDirectory': async () => {
    const downloadsFolder = await ensureDownloadsFolder();

    // Ensure we get string values
    const nativePath = typeof downloadsFolder.nativePath === 'string'
      ? downloadsFolder.nativePath
      : String(downloadsFolder.nativePath || '');
    const folderUrl = typeof downloadsFolder.url === 'string'
      ? downloadsFolder.url
      : String(downloadsFolder.url || '');

    let opened = false;
    let error = '';

    console.log('[fs.openDirectory] Folder info:', {
      nativePath,
      folderUrl,
      folderName: downloadsFolder.name,
      nativePathType: typeof downloadsFolder.nativePath,
      urlType: typeof downloadsFolder.url
    });

    // Approach 1: Try shell.openPath with the folder's URL property
    if (shell && typeof shell.openPath === 'function' && folderUrl && typeof folderUrl === 'string') {
      try {
        console.log('[fs.openDirectory] Trying shell.openPath with URL:', folderUrl);
        await shell.openPath(folderUrl);
        opened = true;
        console.log('[fs.openDirectory] shell.openPath with URL succeeded');
      } catch (shellError) {
        error = getErrorMsg(shellError);
        console.log('[fs.openDirectory] shell.openPath with URL failed:', error);
      }
    }

    // Approach 2: Try with native path
    if (!opened && shell && typeof shell.openPath === 'function' && nativePath && typeof nativePath === 'string') {
      try {
        console.log('[fs.openDirectory] Trying shell.openPath with nativePath:', nativePath);
        await shell.openPath(nativePath);
        opened = true;
        console.log('[fs.openDirectory] shell.openPath with nativePath succeeded');
      } catch (shellError) {
        error = error || getErrorMsg(shellError);
        console.log('[fs.openDirectory] shell.openPath with nativePath failed:', shellError);
      }
    }

    // Approach 3: Try creating a temp file and opening it to reveal folder
    if (!opened && shell && typeof shell.openPath === 'function') {
      try {
        console.log('[fs.openDirectory] Trying temp file approach');
        const tempFile = await downloadsFolder.createFile(`.reveal_${Date.now()}.txt`, { overwrite: true });
        await tempFile.write('This file can be deleted');

        const tempUrl = typeof tempFile.url === 'string' ? tempFile.url : String(tempFile.url || '');
        console.log('[fs.openDirectory] Created temp file:', tempUrl);

        if (tempUrl && typeof tempUrl === 'string') {
          await shell.openPath(tempUrl);
          opened = true;
          console.log('[fs.openDirectory] Opening temp file succeeded (should reveal folder)');
        }
      } catch (tempError) {
        error = error || getErrorMsg(tempError);
        console.log('[fs.openDirectory] Temp file approach failed:', tempError);
      }
    }

    return {
      success: true,
      path: nativePath,
      url: folderUrl,
      opened,
      error
    };
  },

  'ps.importImageAsLayer': async (payload) => importImageAsLayer(payload || {}),

  'ps.importBase64AsLayer': async (payload) => importBase64AsLayer(payload || {}),

  'ps.exportActiveLayerPng': async () => exportActiveLayerPng(),

  'ps.exportSelectionPng': async () => exportSelectionPng(),

  'upload.toComfyUI': async (payload) => {
    const { filename, base64Data, mimeType = 'image/png' } = payload || {};
    if (!filename || typeof filename !== 'string') {
      throw new Error('upload.toComfyUI: missing or invalid "filename" parameter');
    }
    if (!base64Data) {
      throw new Error('upload.toComfyUI: missing "base64Data" parameter');
    }

    const url = resolveComfyUploadUrl(payload);
    console.log('[Upload] Uploading to ComfyUI:', filename, '->', url);

    // Delegate to the multipart uploader for compatibility with existing UIs.
    const result = await handlers['comfyui.uploadImage']({
      url,
      filename,
      base64Data,
      mimeType
    });

    return {
      success: true,
      filename,
      url,
      response: result
    };
  },

  // ComfyUI 网络代理 - 解决 UXP WebView 网络隔离问题
  'comfyui.fetch': async (payload) => {
    const { url, method = 'GET', headers = {}, body, timeout = 30000, retryOnAbort = true } = payload;
    
    if (!url || typeof url !== 'string') {
      throw new Error('comfyui.fetch: missing or invalid "url" parameter');
    }

    console.log('[Bridge] ComfyUI fetch:', method, url);

    try {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
      };

      if (body && method !== 'GET') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const performFetchWithTimeout = async (requestTimeout) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), requestTimeout);
        try {
          return await fetch(url, {
            ...fetchOptions,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let response;
      try {
        response = await performFetchWithTimeout(timeout);
      } catch (error) {
        if (retryOnAbort && error && error._name === 'AbortError') {
          const retryTimeout = Math.min(Math.max(timeout * 2, 15000), 60000);
          console.warn('[Bridge] ComfyUI fetch aborted, retrying once with longer timeout:', retryTimeout);
          response = await performFetchWithTimeout(retryTimeout);
        } else {
          throw error;
        }
      }

      const contentType = response.headers.get('content-type') || '';
      let responseData;
      
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const b64 = btoa(binary);
        responseData = {
          __base64__: true,
          data: b64,
          contentType,
          // Convenience field for <img src="..."> preview in the WebView UI.
          dataUrl: `data:${contentType || 'application/octet-stream'};base64,${b64}`,
          byteLength: bytes.byteLength
        };
      } else {
        responseData = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData
      };
    } catch (error) {
      console.error('[Bridge] ComfyUI fetch error:', error);
      const isAbortError = error && (error._name === 'AbortError' || error.name === 'AbortError');
      throw {
        code: isAbortError ? 'TIMEOUT' : 'FETCH_ERROR',
        message: isAbortError
          ? `Request timed out after ${timeout}ms (or retry timeout)`
          : (error.message || error._message || 'Network request failed'),
        url
      };
    }
  },

  // ComfyUI 文件上传 - 专门处理 multipart/form-data
  'comfyui.uploadImage': async (payload) => {
    const { url, filename, base64Data, mimeType = 'image/png' } = payload;
    
    if (!url || typeof url !== 'string') {
      throw new Error('comfyui.uploadImage: missing or invalid "url" parameter');
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('comfyui.uploadImage: missing or invalid "filename" parameter');
    }
    if (!base64Data) {
      throw new Error('comfyui.uploadImage: missing "base64Data" parameter');
    }

    console.log('[Bridge] ComfyUI upload image:', filename, 'to', url);

    try {
      // 将 base64 转换为二进制数据
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 构建 multipart/form-data
      const boundary = '----FormBoundary' + Date.now();
      const parts = [];
      
      // 添加文件部分
      parts.push(`--${boundary}\r\n`);
      parts.push(`Content-Disposition: form-data; name="image"; filename="${filename}"\r\n`);
      parts.push(`Content-Type: ${mimeType}\r\n\r\n`);
      
      const headerBlob = new Blob([parts.join('')]);
      const footerBlob = new Blob(['\r\n--' + boundary + '--\r\n']);
      const formDataBlob = new Blob([headerBlob, bytes, footerBlob]);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formDataBlob
      });

      const responseData = await response.json();

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: responseData
      };
    } catch (error) {
      console.error('[Bridge] ComfyUI upload error:', error);
      throw {
        code: 'UPLOAD_ERROR',
        message: error.message || 'Upload failed',
        url
      };
    }
  }
};

console.log('[Bridge] Setting up message listener...');

const processBridgeMessage = async (rawMessage, channel, source) => {
  console.log(`[Bridge] Message received via ${channel}:`, rawMessage);

  if (!rawMessage || typeof rawMessage !== 'object' || !rawMessage.uuid) {
    return;
  }

  const { uuid, action: actionName, payload } = rawMessage;
  if (!actionName || typeof actionName !== 'string') {
    return;
  }

  try {
    if (!(actionName in handlers)) {
      throw {
        code: 'UNKNOWN_ACTION',
        message: `Unknown action: ${actionName}. Allowed: ${Object.keys(handlers).join(', ')}`
      };
    }

    const handler = handlers[actionName];
    const responseData = await handler(payload || {});

    const replyTarget = source && typeof source.postMessage === 'function' ? source : webviewEl;
    if (replyTarget && typeof replyTarget.postMessage === 'function') {
      replyTarget.postMessage({
        uuid,
        state: 'fulfilled',
        data: responseData
      });
    } else {
      console.error('[Bridge] No valid reply target for fulfilled response');
    }
  } catch (error) {
    const errorMsg = getErrorMsg(error);
    const errorCode = error?.code || 'INTERNAL_ERROR';
    console.error('[Bridge] Handler error:', error, 'errorMsg:', errorMsg, 'code:', errorCode);

    const replyTarget = source && typeof source.postMessage === 'function' ? source : webviewEl;
    if (replyTarget && typeof replyTarget.postMessage === 'function') {
      replyTarget.postMessage({
        uuid,
        state: 'rejected',
        data: null,
        msg: errorMsg,
        code: errorCode
      });
    } else {
      console.error('[Bridge] No valid reply target for rejected response');
    }
  }
};

window.addEventListener('message', async (event) => {
  const origin = normalizeOrigin(event.origin || '');
  const allowedOrigins = ALLOWED_ORIGINS.map(normalizeOrigin);
  if (origin && !allowedOrigins.includes(origin)) {
    console.error('[Bridge] Rejected message from unauthorized origin:', origin, 'Allowed:', ALLOWED_ORIGINS);
    return;
  }
  await processBridgeMessage(event.data, 'window', event.source);
});

console.log('[Plugin] Initialized hardened UXP bridge', {
  allowedOrigins: ALLOWED_ORIGINS,
  handlers: Object.keys(handlers)
});
