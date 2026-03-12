import React, { useState } from 'react';
import type { HistoryItem } from '../../stores/historyStore';
import './HistoryItem.css';

interface HistoryItemProps {
  item: HistoryItem;
  onView: (item: HistoryItem) => Promise<void>;
  onRerun: (item: HistoryItem) => void;
  onReEdit: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}

export const HistoryItemComponent: React.FC<HistoryItemProps> = ({
  item,
  onView,
  onRerun,
  onReEdit,
  onDelete: _onDelete,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#4caf50';
      case 'failed':
        return '#f44336';
      case 'pending':
        return '#ff9800';
      default:
        return '#999';
    }
  };

  const handleDownload = async () => {
    setDownloadError(null);
    setIsDownloading(true);
    try {
      await onView(item);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setDownloadError(msg);
    } finally {
      setIsDownloading(false);
    }
  };

  const previewImages = (item.images || []).filter((image) => image.thumbnailUrl || image.imageUrl);
  const activePreview = previewImages[activePreviewIndex] || null;

  const openViewer = (index: number) => {
    setActivePreviewIndex(index);
    setIsViewerOpen(true);
  };

  const closeViewer = () => {
    setIsViewerOpen(false);
  };

  const showPrevious = () => {
    if (previewImages.length === 0) return;
    setActivePreviewIndex((prev) => (prev - 1 + previewImages.length) % previewImages.length);
  };

  const showNext = () => {
    if (previewImages.length === 0) return;
    setActivePreviewIndex((prev) => (prev + 1) % previewImages.length);
  };

  return (
    <div className="history-item">
      <div className="history-item-thumbnail">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.imageName} onClick={() => openViewer(0)} />
        ) : (
          <div className="thumbnail-placeholder">无图片</div>
        )}
      </div>

      {previewImages.length > 1 && (
        <div className="history-item-thumbnail-strip">
          {previewImages.map((image, index) => (
            <button
              key={`${item.id}-${image.filename}-${index}`}
              type="button"
              className={`history-item-mini-thumb ${index === activePreviewIndex ? 'active' : ''}`}
              onClick={() => openViewer(index)}
              title={`预览第 ${index + 1} 张`}
            >
              {image.thumbnailUrl ? (
                <img src={image.thumbnailUrl} alt={`${item.imageName}-${index + 1}`} />
              ) : (
                <span>{index + 1}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="history-item-content">
        <h3>{item.imageName}</h3>
        <p className="history-item-time">{formatDate(item.timestamp)}</p>
        <div className="history-item-status">
          <span
            className="status-badge"
            style={{ backgroundColor: getStatusColor(item.status) }}
          >
            {item.status === 'completed' ? '成功' : item.status === 'failed' ? '失败' : '等待中'}
          </span>
        </div>
        {downloadError && (
          <p className="error-text">{downloadError}</p>
        )}
      </div>

      <div className="history-item-actions">
        <button onClick={handleDownload} className="btn btn-primary" disabled={isDownloading}>
          {isDownloading ? '下载中...' : '下载'}
        </button>
        <button onClick={() => onRerun(item)} className="btn btn-info">
          重新运行
        </button>
        <button onClick={() => onReEdit(item)} className="btn btn-warning">
          重新编辑
        </button>
      </div>

      {isViewerOpen && activePreview?.imageUrl && (
        <div className="history-viewer-overlay" onClick={closeViewer}>
          <div className="history-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="history-viewer-header">
              <span>
                {activePreviewIndex + 1} / {previewImages.length} · {activePreview.filename}
              </span>
              <button type="button" className="btn btn-danger" onClick={closeViewer}>
                关闭
              </button>
            </div>
            <div className="history-viewer-body">
              <img src={activePreview.imageUrl} alt={activePreview.filename} />
            </div>
            {previewImages.length > 1 && (
              <div className="history-viewer-controls">
                <button type="button" className="btn btn-info" onClick={showPrevious}>
                  上一张
                </button>
                <button type="button" className="btn btn-info" onClick={showNext}>
                  下一张
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
