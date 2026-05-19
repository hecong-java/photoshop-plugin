import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HistoryItem } from '../stores/historyStore';
import { ComfyUIClient } from '../services/comfyui';
import { useHistoryStore } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLemonGridStore } from '../stores/lemongridStore';
import { LemonGridClient } from '../services/lemongrid';
import { HistoryList } from '../components/history/HistoryList';
import { downloadAndSaveZip, generateDownloadFilename } from '../services/download';
import { PromptReverseFlow } from '../components/promptReverse/PromptReverseFlow';
import { usePSBridge } from '../hooks/usePSBridge';
import './History.css';

interface DownloadSuccess {
  path: string;
  timestamp: number;
}

export const History = () => {
  const navigate = useNavigate();
  const { items, clusterItems, deleteItem, isLoading, error, setClient, fetchFromComfyUI, fetchFromCluster, loadLocalDownloads, addLocalDownload } = useHistoryStore();
  const { comfyUI, connectionMode } = useSettingsStore();
  const { accessToken: lemonGridAccessToken, serverUrl: lemonGridServerUrl } = useLemonGridStore();
  const hasClusterAuth = !!(lemonGridAccessToken && lemonGridServerUrl);
  const { importBase64AsLayer } = usePSBridge();
  const [downloadSuccess, setDownloadSuccess] = useState<DownloadSuccess | null>(null);

  // Show items based on connection mode
  const displayItems = connectionMode === 'cluster' ? clusterItems : items;

  // Load history based on connection mode on mount
  useEffect(() => {
    const loadHistory = async () => {
      loadLocalDownloads();

      if (connectionMode === 'direct') {
        // Direct mode: fetch from ComfyUI only
        if (comfyUI.baseUrl && comfyUI.isConnected) {
          setClient(comfyUI.baseUrl, comfyUI.prefixMode ?? undefined);
          await fetchFromComfyUI();
        }
      } else {
        // Cluster mode: fetch from LemonGrid only
        if (hasClusterAuth) {
          await fetchFromCluster(lemonGridServerUrl);
        }
      }
    };

    loadHistory();
  }, [connectionMode, comfyUI.baseUrl, comfyUI.isConnected, hasClusterAuth, setClient, fetchFromComfyUI, fetchFromCluster, loadLocalDownloads]);

  // Auto-hide success message after 3 seconds
  useEffect(() => {
    if (downloadSuccess) {
      const timer = setTimeout(() => {
        setDownloadSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [downloadSuccess]);

  const handleSyncToPS = async (item: HistoryItem) => {
    if (!item.images || item.images.length === 0) {
      throw new Error('当前记录没有可同步的图片');
    }

    // Use the first image
    const image = item.images[0];
    let blob: Blob;

    if (item.source === 'cluster') {
      const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
      const assetId = image.filename;
      if (!assetId) throw new Error('集群图片缺少资源ID');
      blob = await client.downloadAsset(assetId);
    } else {
      const baseUrl = comfyUI.baseUrl;
      const client = new ComfyUIClient({ baseUrl });
      const url = client.getViewUrl({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: (image.type as 'output' | 'input' | 'temp') || 'output',
        preview: false,
      });
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`下载图片失败: ${resp.status}`);
      blob = await resp.blob();
    }

    // Convert blob to base64
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip data URL prefix (e.g. "data:image/png;base64,")
        const base64 = result.split(',')[1];
        if (!base64) {
          reject(new Error('Failed to convert image to base64'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read image blob'));
      reader.readAsDataURL(blob);
    });

    await importBase64AsLayer({
      base64Data,
      layerName: item.imageName || undefined,
      mode: 'pixel',
      workflowName: item.imageName || undefined,
    });
  };

  const handleDownload = async (item: HistoryItem) => {
    if (!item.images || item.images.length === 0) {
      throw new Error('当前记录没有可下载图片');
    }

    if (item.source === 'cluster') {
      // Cluster items: download assets via authenticated LemonGridClient
      const client = new LemonGridClient({ serverUrl: lemonGridServerUrl });
      const objectUrls: string[] = [];
      try {
        const urls = await Promise.all(item.images.map(async (image, index) => {
          const assetId = image.filename; // filename stores the asset ID for cluster items
          if (!assetId) return { url: '', filename: `image-${index + 1}.png`, index };
          const blob = await client.downloadAsset(assetId);
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          return { url: objectUrl, filename: `${item.imageName || 'cluster'}-${index + 1}.png`, index };
        }));
        const filename = generateDownloadFilename(item.imageName || 'cluster', 0).replace(/\.png$/i, '.zip');
        const result = await downloadAndSaveZip(urls, filename);
        addLocalDownload(item.promptId, result.savedPath);
        setDownloadSuccess({ path: result.savedPath, timestamp: Date.now() });
      } finally {
        objectUrls.forEach(URL.revokeObjectURL);
      }
      return;
    }

    // Direct mode: existing ComfyUI download logic
    const filename = generateDownloadFilename(item.imageName || 'comfyui', 0).replace(/\.png$/i, '.zip');
    const baseUrl = comfyUI.baseUrl;
    const client = new ComfyUIClient({ baseUrl });
    const urls = item.images.map((image, index) => ({
      url: client.getViewUrl({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: (image.type as 'output' | 'input' | 'temp') || 'output',
        preview: false,
      }),
      filename: image.filename,
      index,
    }));

    const result = await downloadAndSaveZip(urls, filename);
    addLocalDownload(item.promptId, result.savedPath);
    setDownloadSuccess({ path: result.savedPath, timestamp: Date.now() });
  };

  const handleCopyPath = async () => {
    if (downloadSuccess?.path) {
      try {
        await navigator.clipboard.writeText(downloadSuccess.path);
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = downloadSuccess.path;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    }
  };

  const handleDismissSuccess = () => {
    setDownloadSuccess(null);
  };

  const handleView = async (item: HistoryItem) => {
    await handleDownload(item);
  };

  const handleRerun = (item: HistoryItem) => {
    // Store the rerun item in sessionStorage temporarily
    sessionStorage.setItem('rerunItem', JSON.stringify(item));
    // Navigate to Draw page (would trigger generation with same params)
    navigate('/draw', { state: { rerunItem: item } });
  };

  const handleReEdit = (item: HistoryItem) => {
    // Store the item for editing in Draw page
    sessionStorage.setItem('editItem', JSON.stringify(item));
    // Navigate to Draw page with edit mode
    navigate('/draw', { state: { editItem: item } });
  };

  const handleDelete = (id: string) => {
    const target = displayItems.find((item) => item.id === id);
    if (!target) {
      return;
    }
    if (target.source === 'cluster') {
      // Cluster items cannot be deleted from here — they are managed server-side
      return;
    }
    if (!window.confirm(`确定要删除历史记录 "${target.imageName}" 吗？`)) {
      return;
    }
    deleteItem(id);
  };

  const handleRefresh = async () => {
    if (connectionMode === 'direct') {
      if (comfyUI.baseUrl) {
        setClient(comfyUI.baseUrl, comfyUI.prefixMode ?? undefined);
        await fetchFromComfyUI();
      }
    } else {
      if (hasClusterAuth) {
        await fetchFromCluster(lemonGridServerUrl);
      }
    }
  };

  // Show configuration prompt if current mode is not connected
  const isDirectConfigured = !!(comfyUI.baseUrl && comfyUI.isConnected);
  if (connectionMode === 'direct' && !isDirectConfigured) {
    return (
      <div className="history-page">
        <div className="history-not-configured">
          <h2>ComfyUI 未连接</h2>
          <p>请在设置页面配置并连接 ComfyUI 以查看历史记录。</p>
          <button onClick={() => navigate('/settings')} className="btn-primary">
            前往设置
          </button>
        </div>
      </div>
    );
  }
  if (connectionMode === 'cluster' && !hasClusterAuth) {
    return (
      <div className="history-page">
        <div className="history-not-configured">
          <h2>LemonGrid 未连接</h2>
          <p>请在设置页面登录 LemonGrid 以查看集群历史记录。</p>
          <button onClick={() => navigate('/settings')} className="btn-primary">
            前往设置
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>生成历史{connectionMode === 'cluster' ? '（集群）' : ''}</h2>
        <button onClick={handleRefresh} className="btn-refresh" disabled={isLoading}>
          {isLoading ? '加载中...' : '刷新'}
        </button>
      </div>

      {downloadSuccess && (
        <div className="download-success-toast">
          <div className="toast-content">
            <span className="toast-icon">✓</span>
            <div className="toast-message">
              <strong>下载成功！</strong>
              <p className="toast-path" title={downloadSuccess.path}>{downloadSuccess.path}</p>
            </div>
          </div>
          <div className="toast-actions">
            <button onClick={handleCopyPath} className="btn-copy">
              复制路径
            </button>
            <button onClick={handleDismissSuccess} className="btn-dismiss">
              ×
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="history-error">
          <p>错误: {error}</p>
          <button onClick={handleRefresh}>重试</button>
        </div>
      )}

      <HistoryList
        items={displayItems}
        onView={handleView}
        onRerun={handleRerun}
        onReEdit={handleReEdit}
        onDelete={handleDelete}
        onSyncToPS={handleSyncToPS}
        isLoading={isLoading}
      />
      <PromptReverseFlow />
    </div>
  );
};
