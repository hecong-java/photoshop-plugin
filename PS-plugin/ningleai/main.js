const ALLOWED_ORIGINS = [
  'http://192.168.0.124:5173',
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

// Auto cache-bust: append timestamp to webview URL
if (webviewEl) {
  const baseUrl = 'http://192.168.0.124:5173';
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

/**
 * Convert ArrayBuffer to base64 string asynchronously, yielding to the
 * event loop between chunks. This prevents the UXP main thread from
 * freezing during large image conversions.
 * Per D-03: replaces synchronous String.fromCharCode.apply pattern.
 */
const arrayBufferToBase64 = async (buffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks -- same as original
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    // Yield to event loop between chunks to keep PS UI responsive
    if (i + chunkSize < bytes.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return btoa(binary);
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

const ensurePresetsFolder = async () => {
  const dataFolder = await localFileSystem.getDataFolder();
  const entries = await dataFolder.getEntries();
  const existing = entries.find((entry) => entry.isFolder && entry.name === 'presets');
  if (existing) return existing;
  return dataFolder.createFolder('presets');
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
    // Duplicate document for safe cropping - avoids modifying original
    const duplicatedDoc = await activeDoc.duplicate();

    try {
      // Step 1: Get the actual layer bounds using batchPlay
      const boundsResult = await action.batchPlay([
        {
          _obj: 'get',
          _target: [{ _ref: 'layer', _id: activeLayer.id }],
          _property: 'bounds'
        }
      ], { synchronousExecution: true });

      // Extract bounds values
      // batchPlay returns bounds as object with nested _value properties:
      // { top: { _unit: "pixelsUnit", _value: 375 }, left: { ... }, ... }
      const bounds = boundsResult[0]?.bounds;
      if (!bounds) {
        throw new Error('Could not get layer bounds');
      }

      // Extract values from nested objects
      const left = bounds.left?._value;
      const top = bounds.top?._value;
      const right = bounds.right?._value;
      const bottom = bounds.bottom?._value;

      // Calculate width and height
      const layerWidth = right - left;
      const layerHeight = bottom - top;

      // Step 2: Crop to the layer bounds using DOM API
      // The DOM API crop() method takes a simple bounds array [left, top, right, bottom]
      // Skip crop if layer bounds equal document dimensions - Photoshop throws error when crop area equals entire document
      const docWidth = duplicatedDoc.width;
      const docHeight = duplicatedDoc.height;
      const needsCrop = !(left === 0 && top === 0 && right === docWidth && bottom === docHeight);

      if (needsCrop) {
        // DOM API crop expects an object with left, top, right, bottom properties
        await duplicatedDoc.crop({ left, top, right, bottom });
      }

      // Step 3: Apply size limit if needed (max 2048 pixels on either side)
      const MAX_SIZE = 2048;
      let finalWidth = duplicatedDoc.width;
      let finalHeight = duplicatedDoc.height;

      if (finalWidth > MAX_SIZE || finalHeight > MAX_SIZE) {
        // Calculate scale factor to fit within max size
        const scaleFactor = Math.min(MAX_SIZE / finalWidth, MAX_SIZE / finalHeight);
        finalWidth = Math.floor(finalWidth * scaleFactor);
        finalHeight = Math.floor(finalHeight * scaleFactor);

        // Resize the document
        await action.batchPlay([
          {
            _obj: 'imageSize',
            _target: [{ _ref: 'document', _id: duplicatedDoc.id }],
            width: { _unit: 'pixelsUnit', _value: finalWidth },
            height: { _unit: 'pixelsUnit', _value: finalHeight },
            constrainProportions: true,
            interfaceIconFrameDimmed: false
          }
        ], { synchronousExecution: true, modalBehavior: 'execute' });
      }

      // Export from the cropped (and possibly scaled) duplicate
      await duplicatedDoc.saveAs.png(exportedFile, {}, true);
    } finally {
      // Close duplicate without saving
      await duplicatedDoc.closeWithoutSaving();
    }
  } finally {
    for (const layer of allLayers) {
      const originalVisible = visibilityById.get(layer.id);
      if (typeof originalVisible === 'boolean' && layer.visible !== originalVisible) {
        layer.visible = originalVisible;
      }
    }
  }

  // Return the exported file reference -- caller reads and converts base64 OUTSIDE modal
  return {
    _exportedFile: exportedFile,
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

  // Phase 1: Modal -- run all PS-mutating operations (dup, crop, resize, save, cleanup)
  const internalResult = await core.executeAsModal(async () => {
    try {
      return await exportActiveLayerPngInternal(activeDoc, activeLayer);
    } catch (error) {
      throw toBridgeError('PS_EXPORT_FAILED', `ps.exportActiveLayerPng failed: ${getErrorMsg(error)}`);
    }
  }, { commandName: 'Export Active Layer PNG' });

  // Phase 2: File I/O and base64 conversion
  // Try outside modal scope first (optimized), fall back to modal scope for older PS versions
  // where file tokens may not persist outside executeAsModal
  try {
    if (internalResult._exportedFile) {
      let fileData;
      try {
        // Optimized path: read outside modal scope
        fileData = await internalResult._exportedFile.read({ format: formats.binary });
      } catch (readErr) {
        // Fallback: re-read inside modal scope for PS v24.x compatibility
        console.warn('[Bridge] File read outside modal failed, retrying inside modal scope:', getErrorMsg(readErr));
        const fileRef = internalResult._exportedFile;
        fileData = await core.executeAsModal(async () => {
          return await fileRef.read({ format: formats.binary });
        }, { commandName: 'Read Exported File' });
      }
      const base64 = await arrayBufferToBase64(fileData);
      return {
        base64,
        path: internalResult.path,
        filename: internalResult.filename,
        sourceLayerName: internalResult.sourceLayerName,
        sourceLayerId: internalResult.sourceLayerId
      };
    }

    return internalResult;
  } finally {
    // Per D-07: Clean up temp export folder
    try {
      if (internalResult._exportedFile) {
        const parent = internalResult._exportedFile.parent;
        if (parent && typeof parent.delete === 'function') {
          await parent.delete();
        }
      }
    } catch (cleanupErr) {
      // Non-critical -- temp files are in OS temp dir
    }
  }
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

  const result = await core.executeAsModal(async () => {
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
          // Pass through the internal result (contains _exportedFile) for outer handling
          return exportedFromLayer;
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

      // Return file reference -- caller reads and converts OUTSIDE modal (per D-04)
      return {
        _exportedFile: exportedFile,
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

  // Per D-04: File I/O and base64 conversion outside modal scope
  // Fallback to modal scope for PS v24.x compatibility
  try {
    if (result && result._exportedFile) {
      let fileData;
      try {
        fileData = await result._exportedFile.read({ format: formats.binary });
      } catch (readErr) {
        console.warn('[Bridge] Selection file read outside modal failed, retrying inside modal scope:', getErrorMsg(readErr));
        const fileRef = result._exportedFile;
        fileData = await core.executeAsModal(async () => {
          return await fileRef.read({ format: formats.binary });
        }, { commandName: 'Read Selection Export File' });
      }
      const base64 = await arrayBufferToBase64(fileData);
      return {
        base64,
        path: result.path,
        filename: result.filename
      };
    }

    return result;
  } finally {
    // Per D-07: Clean up temp export folder
    try {
      if (result && result._exportedFile) {
        const parent = result._exportedFile.parent;
        if (parent && typeof parent.delete === 'function') {
          await parent.delete();
        }
      }
    } catch (cleanupErr) {
      // Non-critical
    }
  }
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
      // Per D-07: Skip reading entire file content -- UXP entries do not expose size directly.
      // Setting size to 0 is acceptable since the webapp primarily needs filename and path.
      list.push({
        filename: file.name,
        path: file.nativePath || `${downloadsFolder.nativePath}/${file.name}`,
        size: 0,
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

    // Approach 1: Try shell.openPath with the folder's URL property
    if (shell && typeof shell.openPath === 'function' && folderUrl && typeof folderUrl === 'string') {
      try {
        await shell.openPath(folderUrl);
        opened = true;
      } catch (shellError) {
        error = getErrorMsg(shellError);
      }
    }

    // Approach 2: Try with native path
    if (!opened && shell && typeof shell.openPath === 'function' && nativePath && typeof nativePath === 'string') {
      try {
        await shell.openPath(nativePath);
        opened = true;
      } catch (shellError) {
        error = error || getErrorMsg(shellError);
      }
    }

    // Approach 3: Try creating a temp file and opening it to reveal folder
    if (!opened && shell && typeof shell.openPath === 'function') {
      try {
        const tempFile = await downloadsFolder.createFile(`.reveal_${Date.now()}.txt`, { overwrite: true });
        await tempFile.write('This file can be deleted');

        const tempUrl = typeof tempFile.url === 'string' ? tempFile.url : String(tempFile.url || '');

        if (tempUrl && typeof tempUrl === 'string') {
          await shell.openPath(tempUrl);
          opened = true;
        }
      } catch (tempError) {
        error = error || getErrorMsg(tempError);
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

    const MAX_ATTEMPTS = 2;
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let response;
        try {
          const requestTimeout = attempt > 1 ? Math.min(Math.max(timeout * 2, 15000), 90000) : timeout;
          response = await performFetchWithTimeout(requestTimeout);
        } catch (fetchError) {
          const isAbort = fetchError && (fetchError._name === 'AbortError' || fetchError.name === 'AbortError');
          if (retryOnAbort && isAbort) {
            const retryTimeout = Math.min(Math.max(timeout * 2, 15000), 60000);
            console.warn('[Bridge] ComfyUI fetch aborted, retrying once with longer timeout:', retryTimeout);
            response = await performFetchWithTimeout(retryTimeout);
          } else {
            throw fetchError;
          }
        }

        const contentType = response.headers.get('content-type') || '';
        let responseData;

        if (contentType.includes('application/json')) {
          responseData = await response.json();
        } else if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
          const arrayBuffer = await response.arrayBuffer();
          const b64 = await arrayBufferToBase64(arrayBuffer);
          responseData = {
            __base64__: true,
            data: b64,
            contentType,
            dataUrl: `data:${contentType || 'application/octet-stream'};base64,${b64}`,
            byteLength: arrayBuffer.byteLength
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
        lastError = error;
        const isAbort = error && (error._name === 'AbortError' || error.name === 'AbortError');
        console.warn(`[Bridge] ComfyUI fetch attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
          isAbort ? 'TIMEOUT' : (error.message || error._message || 'Network request failed'));

        if (attempt < MAX_ATTEMPTS) {
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    console.error('[Bridge] ComfyUI fetch error after ${MAX_ATTEMPTS} attempts:', lastError);
    const isAbortError = lastError && (lastError._name === 'AbortError' || lastError.name === 'AbortError');
    throw {
      code: isAbortError ? 'TIMEOUT' : 'FETCH_ERROR',
      message: isAbortError
        ? `Request timed out after ${timeout}ms (all retries exhausted)`
        : (lastError.message || lastError._message || 'Network request failed'),
      url
    };
  },

  // ComfyUI 文件上传 - 专门处理 multipart/form-data
  // Uses ArrayBuffer instead of Blob for UXP compatibility across PS v24.x+
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

    try {
      // Convert base64 to binary Uint8Array
      const binaryString = atob(base64Data);
      const fileBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        fileBytes[i] = binaryString.charCodeAt(i);
      }

      // Build multipart/form-data using ArrayBuffer (not Blob)
      // Blob body in fetch is unreliable in UXP v7.x (PS v24.x)
      const boundary = '----FormBoundary' + Date.now();
      const headerStr = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const footerStr = `\r\n--${boundary}--\r\n`;

      // Encode header and footer to bytes, then combine with file bytes into single ArrayBuffer
      const headerBytes = new Uint8Array(Array.from(headerStr).map(c => c.charCodeAt(0)));
      const footerBytes = new Uint8Array(Array.from(footerStr).map(c => c.charCodeAt(0)));

      const totalLen = headerBytes.length + fileBytes.length + footerBytes.length;
      const bodyBytes = new Uint8Array(totalLen);
      bodyBytes.set(headerBytes, 0);
      bodyBytes.set(fileBytes, headerBytes.length);
      bodyBytes.set(footerBytes, headerBytes.length + fileBytes.length);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: bodyBytes.buffer
      });

      let responseData;
      const responseText = await response.text();
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`ComfyUI upload returned non-JSON response (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(`ComfyUI upload failed (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
      }

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
  },

  // Preset CRUD handlers
  'preset.list': async (payload) => {
    const { workflowName } = payload || {};
    const presetsFolder = await ensurePresetsFolder();
    const entries = await presetsFolder.getEntries();
    const jsonFiles = entries.filter((entry) => entry.isFile && entry.name.endsWith('.json'));

    const results = [];
    for (const file of jsonFiles) {
      try {
        // If workflowName provided, filter by filename prefix
        if (workflowName && typeof workflowName === 'string') {
          const prefix = workflowName + '-';
          if (!file.name.startsWith(prefix)) continue;
        }
        const content = await file.read();
        const data = JSON.parse(content);
        results.push({
          filename: file.name,
          name: data.name || file.name.replace(/\.json$/, ''),
          workflowName: data.workflowName || '',
          updatedAt: data.updatedAt || '',
          createdAt: data.createdAt || ''
        });
      } catch (err) {
        console.warn('[preset.list] Skipping broken preset file:', file.name, err);
      }
    }

    // Sort by updatedAt descending (most recent first)
    results.sort((a, b) => {
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    return results;
  },

  'preset.read': async (payload) => {
    const { filename } = payload || {};
    if (!filename || typeof filename !== 'string') {
      throw new Error('preset.read: missing or invalid "filename" parameter');
    }
    const presetsFolder = await ensurePresetsFolder();
    const entries = await presetsFolder.getEntries();
    const target = entries.find((entry) => entry.isFile && entry.name === filename);
    if (!target) {
      throw new Error('preset.read: preset file not found');
    }
    try {
      const content = await target.read();
      return JSON.parse(content);
    } catch (err) {
      throw new Error('preset.read: failed to parse preset file - ' + (err.message || err));
    }
  },

  'preset.write': async (payload) => {
    const { filename, data } = payload || {};
    if (!filename || typeof filename !== 'string') {
      throw new Error('preset.write: missing or invalid "filename" parameter');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('preset.write: missing or invalid "data" parameter');
    }
    const presetsFolder = await ensurePresetsFolder();
    const safeFilename = sanitizeFilename(filename);
    // Ensure .json extension
    const finalFilename = safeFilename.endsWith('.json') ? safeFilename : safeFilename + '.json';
    const file = await presetsFolder.createFile(finalFilename, { overwrite: true });
    const content = JSON.stringify(data, null, 2);
    await file.write(content);
    return { success: true, filename: finalFilename };
  },

  'preset.delete': async (payload) => {
    const { filename } = payload || {};
    if (!filename || typeof filename !== 'string') {
      throw new Error('preset.delete: missing or invalid "filename" parameter');
    }
    const presetsFolder = await ensurePresetsFolder();
    const entries = await presetsFolder.getEntries();
    const target = entries.find((entry) => entry.isFile && entry.name === filename);
    if (!target) {
      return { success: false };
    }
    await target.delete();
    return { success: true };
  },

  'preset.import': async () => {
    try {
      const file = await localFileSystem.getFileForOpening({ types: ['json'] });
      if (!file) {
        return { cancelled: true };
      }
      const content = await file.read();
      const parsedData = JSON.parse(content);
      return { cancelled: false, data: parsedData, sourceFilename: file.name };
    } catch (err) {
      throw new Error('preset.import: failed to read or parse file - ' + (err.message || err));
    }
  },

  'preset.export': async (payload) => {
    const { filename, data } = payload || {};
    if (!filename || typeof filename !== 'string') {
      throw new Error('preset.export: missing or invalid "filename" parameter');
    }
    const file = await localFileSystem.getFileForSaving(filename, { types: ['json'] });
    if (!file) {
      return { cancelled: true };
    }
    const content = JSON.stringify(data, null, 2);
    await file.write(content);
    return { success: true };
  },

  // Keyboard shortcut passthrough - forwards webapp shortcuts to Photoshop
  // LemonGrid WebSocket connection tracking
  // Key = connectionId, Value = WebSocket instance
  // Declared as lazy property on handlers so it is module-level accessible.

  'lemongrid.fetch': async (payload) => {
    const { url, method = 'GET', headers = {}, body, timeout = 30000 } = payload;

    if (!url || typeof url !== 'string') {
      throw new Error('lemongrid.fetch: missing or invalid "url" parameter');
    }

    // Inject JWT Authorization header from settingsStorage
    const lgSettings = settingsStorage.get('lemongrid') || {};
    const token = lgSettings.accessToken || '';

    try {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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

      const response = await performFetchWithTimeout(timeout);

      const contentType = response.headers.get('content-type') || '';
      let responseData;

      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
        const arrayBuffer = await response.arrayBuffer();
        const b64 = await arrayBufferToBase64(arrayBuffer);
        responseData = {
          __base64__: true,
          data: b64,
          contentType,
          dataUrl: `data:${contentType || 'application/octet-stream'};base64,${b64}`,
          byteLength: arrayBuffer.byteLength
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
      console.error('[Bridge] LemonGrid fetch error:', error);
      const isAbortError = error && (error._name === 'AbortError' || error.name === 'AbortError');
      throw {
        code: isAbortError ? 'TIMEOUT' : 'FETCH_ERROR',
        message: isAbortError
          ? `Request timed out after ${timeout}ms`
          : (error.message || error._message || 'Network request failed'),
        url
      };
    }
  },

  'lemongrid.websocket': async (payload) => {
    const { taskId } = payload;

    if (!taskId || typeof taskId !== 'string') {
      throw new Error('lemongrid.websocket: missing or invalid "taskId" parameter');
    }

    const lgSettings = settingsStorage.get('lemongrid') || {};
    if (!lgSettings.serverUrl || !lgSettings.accessToken) {
      throw new Error('lemongrid.websocket: not authenticated or server URL not configured');
    }

    // Build WebSocket URL from LemonGrid server URL
    const wsUrl = lgSettings.serverUrl.replace(/^http/i, 'ws') + '/ws/v1/realtime?token=' + lgSettings.accessToken;

    // Initialize connection tracking map if not exists
    if (!handlers._lgWsConnections) {
      handlers._lgWsConnections = new Map();
    }

    const connectionId = 'lg-ws-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          // Resolve the Bridge call with connection ID once WS is open
          resolve({ connectionId });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Relay message to webview
            if (webviewEl && typeof webviewEl.postMessage === 'function') {
              webviewEl.postMessage({
                type: 'lemongrid.ws.message',
                taskId,
                connectionId,
                data
              });
            }
          } catch (parseError) {
            console.warn('[Bridge] LemonGrid WS message parse error:', parseError);
          }
        };

        ws.onerror = (event) => {
          console.error('[Bridge] LemonGrid WS error:', event);
          if (webviewEl && typeof webviewEl.postMessage === 'function') {
            webviewEl.postMessage({
              type: 'lemongrid.ws.close',
              taskId,
              connectionId,
              code: 'ERROR',
              reason: 'WebSocket error'
            });
          }
          // Clean up from map
          if (handlers._lgWsConnections) {
            handlers._lgWsConnections.delete(connectionId);
          }
        };

        ws.onclose = (event) => {
          if (webviewEl && typeof webviewEl.postMessage === 'function') {
            webviewEl.postMessage({
              type: 'lemongrid.ws.close',
              taskId,
              connectionId,
              code: event.code,
              reason: event.reason || 'Connection closed'
            });
          }
          // Clean up from map
          if (handlers._lgWsConnections) {
            handlers._lgWsConnections.delete(connectionId);
          }
        };

        // Store in connection map for cleanup
        handlers._lgWsConnections.set(connectionId, ws);

      } catch (error) {
        reject({
          code: 'WS_ERROR',
          message: error.message || 'Failed to create WebSocket connection',
          taskId
        });
      }
    });
  },

  'lemongrid.websocket.close': async (payload) => {
    const { connectionId } = payload;

    if (!connectionId || typeof connectionId !== 'string') {
      throw new Error('lemongrid.websocket.close: missing or invalid "connectionId" parameter');
    }

    if (!handlers._lgWsConnections) {
      return { success: true, reason: 'no active connections' };
    }

    const ws = handlers._lgWsConnections.get(connectionId);
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        // Ignore close errors
      }
      handlers._lgWsConnections.delete(connectionId);
      return { success: true };
    }

    return { success: true, reason: 'connection not found' };
  },

  'lemongrid.uploadAsset': async (payload) => {
    const { url, filename, base64Data, mimeType = 'image/png', libraryType = 'REFERENCE' } = payload;

    if (!url || typeof url !== 'string') {
      throw new Error('lemongrid.uploadAsset: missing or invalid "url" parameter');
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('lemongrid.uploadAsset: missing or invalid "filename" parameter');
    }
    if (!base64Data) {
      throw new Error('lemongrid.uploadAsset: missing "base64Data" parameter');
    }

    // Inject JWT Authorization header from settingsStorage
    const lgSettings = settingsStorage.get('lemongrid') || {};
    const token = lgSettings.accessToken || '';

    try {
      // Convert base64 to binary Uint8Array
      const binaryString = atob(base64Data);
      const fileBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        fileBytes[i] = binaryString.charCodeAt(i);
      }

      // Build multipart/form-data using ArrayBuffer (not Blob)
      // Blob body in fetch is unreliable in UXP v7.x (PS v24.x)
      const boundary = '----FormBoundary' + Date.now();

      // Header part: library_type field + file field header
      const headerStr = `--${boundary}\r\nContent-Disposition: form-data; name="library_type"\r\n\r\n${libraryType}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const footerStr = `\r\n--${boundary}--\r\n`;

      const headerBytes = new Uint8Array(Array.from(headerStr).map(c => c.charCodeAt(0)));
      const footerBytes = new Uint8Array(Array.from(footerStr).map(c => c.charCodeAt(0)));

      const totalLen = headerBytes.length + fileBytes.length + footerBytes.length;
      const bodyBytes = new Uint8Array(totalLen);
      bodyBytes.set(headerBytes, 0);
      bodyBytes.set(fileBytes, headerBytes.length);
      bodyBytes.set(footerBytes, headerBytes.length + fileBytes.length);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: bodyBytes.buffer
      });

      let responseData;
      const responseText = await response.text();
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`LemonGrid upload returned non-JSON response (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(`LemonGrid upload failed (HTTP ${response.status}): ${responseText.substring(0, 200)}`);
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: responseData
      };
    } catch (error) {
      console.error('[Bridge] LemonGrid upload error:', error);
      throw {
        code: 'UPLOAD_ERROR',
        message: error.message || 'Upload failed',
        url
      };
    }
  },

  'ps.executeShortcut': async (payload) => {
    const { key, ctrl, shift, alt } = payload || {};

    // Build the shortcut key string matching webapp-side format
    const parts = [];
    if (ctrl) parts.push('Ctrl');
    if (shift) parts.push('Shift');
    if (alt) parts.push('Alt');
    parts.push(key);
    const shortcutKey = parts.join('+');

    // Map shortcut combinations to batchPlay action descriptors
    const actionMap = {
      'Delete': [{ _obj: 'delete', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }] }],
      'Backspace': [{ _obj: 'delete', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }] }],
      'Ctrl+z': [{ _obj: 'undo' }],
      'Ctrl+Shift+z': [{ _obj: 'redo' }],
      'Ctrl+s': [{ _obj: 'save' }],
      'Ctrl+c': [{ _obj: 'copy' }],
      'Ctrl+v': [{ _obj: 'paste' }],
      'Ctrl+a': [{ _obj: 'selectAll' }],
      'Ctrl+d': [{ _obj: 'deselect' }],
      'Ctrl+t': [{ _obj: 'freeTransform' }],
      'ArrowUp': [{ _obj: 'move', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: -1 } } }],
      'ArrowDown': [{ _obj: 'move', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 1 } } }],
      'ArrowLeft': [{ _obj: 'move', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: -1 }, vertical: { _unit: 'pixelsUnit', _value: 0 } } }],
      'ArrowRight': [{ _obj: 'move', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 1 }, vertical: { _unit: 'pixelsUnit', _value: 0 } } }],
      'BracketLeft': [{ _obj: 'decreaseBrushSize' }],
      'BracketRight': [{ _obj: 'increaseBrushSize' }],
    };

    const actions = actionMap[shortcutKey];
    if (!actions) return { executed: false, reason: 'No action mapping for: ' + shortcutKey };

    try {
      return await core.executeAsModal(async () => {
        await action.batchPlay(actions, { synchronousExecution: true });
        return { executed: true };
      }, { commandName: `Shortcut: ${shortcutKey}` });
    } catch (error) {
      // Shortcuts may fail if context is wrong (e.g., no selection for deselect)
      // Return gracefully instead of throwing
      console.warn('[Bridge] Shortcut execution failed:', shortcutKey, error);
      return { executed: false, reason: getErrorMsg(error) };
    }
  }
};


const processBridgeMessage = async (rawMessage, channel, source) => {

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
