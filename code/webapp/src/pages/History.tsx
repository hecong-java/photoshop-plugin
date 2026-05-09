import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HistoryItem } from '../stores/historyStore';
import { ComfyUIClient } from '../services/comfyui';
import { useHistoryStore } from '../stores/historyStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLemonGridStore } from '../stores/lemongridStore';
import { HistoryList } from '../components/history/HistoryList';
import { downloadAndSaveZip, generateDownloadFilename } from '../services/download';
import { PromptReverseFlow } from '../components/promptReverse/PromptReverseFlow';
import './History.css';

interface DownloadSuccess {
  path: string;
  timestamp: number;
}

export const History = () => {
  const navigate = useNavigate();
  const { items, clusterItems, deleteItem, isLoading, error, setClient, fetchFromComfyUI, fetchFromCluster, loadLocalDownloads, addLocalDownload } = useHistoryStore();
  const { comfyUI } = useSettingsStore();
  const { isConnected: isLemonGridConnected, serverUrl: lemonGridServerUrl } = useLemonGridStore();
  const [downloadSuccess, setDownloadSuccess] = useState<DownloadSuccess | null>(null);

  // Merge direct and cluster items, sorted by timestamp descending
  const allItems = [...items, ...clusterItems].sort((a, b) => b.timestamp - a.timestamp);

  // Load from ComfyUI and LemonGrid on mount
  useEffect(() => {
    const loadHistory = async () => {
      // First load local downloads
      loadLocalDownloads();

      // Then fetch from ComfyUI if configured
      if (comfyUI.baseUrl && comfyUI.isConnected) {
        setClient(comfyUI.baseUrl, comfyUI.prefixMode ?? undefined);
        await fetchFromComfyUI();
      }

      // Fetch cluster history if LemonGrid is connected
      if (isLemonGridConnected && lemonGridServerUrl) {
        await fetchFromCluster(lemonGridServerUrl);
      }
    };

    loadHistory();
  }, [comfyUI.baseUrl, comfyUI.isConnected, isLemonGridConnected, lemonGridServerUrl, setClient, fetchFromComfyUI, fetchFromCluster, loadLocalDownloads]);

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

  const handleDownload = async (item: HistoryItem) => {
    if (!item.images || item.images.length === 0) {
      throw new Error('当前记录没有可下载图片');
    }

    if (item.source === 'cluster') {
      // Cluster items: download directly from LemonGrid asset URLs
      const urls = item.images.map((image, index) => ({
        url: image.imageUrl || image.thumbnailUrl || '',
        filename: image.filename,
        index,
      }));
      const filename = generateDownloadFilename(item.imageName || 'cluster', 0).replace(/\.png$/i, '.zip');
      const result = await downloadAndSaveZip(urls, filename);
      addLocalDownload(item.promptId, result.savedPath);
      setDownloadSuccess({ path: result.savedPath, timestamp: Date.now() });
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
    const target = allItems.find((item) => item.id === id);
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
    if (comfyUI.baseUrl) {
      setClient(comfyUI.baseUrl, comfyUI.prefixMode ?? undefined);
      await fetchFromComfyUI();
    }
    if (isLemonGridConnected && lemonGridServerUrl) {
      await fetchFromCluster(lemonGridServerUrl);
    }
  };

  // Show configuration prompt if neither ComfyUI nor LemonGrid is connected
  if ((!comfyUI.baseUrl || !comfyUI.isConnected) && !isLemonGridConnected) {
    return (
      <div className="history-page">
        <div className="history-not-configured">
          <h2>未连接</h2>
          <p>请在设置页面配置并连接 ComfyUI 或 LemonGrid 以查看历史记录。</p>
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
        <h2>生成历史</h2>
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
        items={allItems}
        onView={handleView}
        onRerun={handleRerun}
        onReEdit={handleReEdit}
        onDelete={handleDelete}
        isLoading={isLoading}
        directCount={items.length}
        clusterCount={clusterItems.length}
      />
      <PromptReverseFlow />
    </div>
  );
};
