import React, { useEffect, useState } from 'react';
import { useDownload } from '../../hooks/useDownload';
import './DownloadManager.css';

export interface DownloadManagerProps {
  onDownloadStart?: () => void;
  onDownloadComplete?: (path: string) => void;
  onError?: (error: string) => void;
  imageUrl?: string;
  workflowName?: string;
  showFileList?: boolean;
}

/**
 * Download Manager Component
 * Handles downloading images from ComfyUI, managing downloads, and opening folder
 */
export const DownloadManager: React.FC<DownloadManagerProps> = ({
  onDownloadStart,
  onDownloadComplete,
  onError,
  imageUrl,
  workflowName = 'image',
  showFileList = true
}) => {
  const {
    isDownloading,
    progress,
    downloadedFiles,
    error,
    downloadImage,
    refreshDownloadList,
    deleteFile,
    openFolder,
    clearError
  } = useDownload();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Load download list on mount
  useEffect(() => {
    refreshDownloadList().catch(console.error);
  }, [refreshDownloadList]);

  const handleDownload = async () => {
    if (!imageUrl) {
      onError?.('No image URL provided');
      return;
    }

    onDownloadStart?.();
    
    try {
      const result = await downloadImage(imageUrl, workflowName);
      onDownloadComplete?.(result.savedPath);
      await refreshDownloadList();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    }
  };

  const handleDeleteFile = async (path: string) => {
    if (!window.confirm('确定要删除这个下载吗？')) return;
    
    try {
      await deleteFile(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openFolder();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    }
  };

  return (
    <div className="download-manager">
      {/* Download Section */}
      <div className="download-section">
        <h3>下载图片</h3>
        
        {error && (
          <div className="error-message">
            <span>{error}</span>
            <button onClick={clearError} className="close-btn">&times;</button>
          </div>
        )}
        
        {imageUrl && (
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="download-btn"
          >
            {isDownloading ? '下载中...' : '下载'}
          </button>
        )}

        {/* Progress Bar */}
        {progress && progress.status !== 'complete' && (
          <div className="progress-container">
            <div className="progress-info">
              <span className="filename">{progress.filename}</span>
              <span className="percent">{progress.percentComplete}%</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress.percentComplete}%` }}
              />
            </div>
            <span className="status">{progress.status}</span>
          </div>
        )}

        {progress?.status === 'complete' && (
          <div className="success-message">
            ✓ 已保存到: {progress.savedPath}
          </div>
        )}
      </div>

      {/* File List Section */}
      {showFileList && (
        <div className="downloads-list-section">
          <div className="section-header">
            <h3>已下载文件</h3>
            <button
              onClick={handleOpenFolder}
              className="open-folder-btn"
              title="在文件管理器中打开下载文件夹"
            >
              📁 打开文件夹
            </button>
          </div>

          {downloadedFiles.length === 0 ? (
            <p className="empty-message">暂无下载</p>
          ) : (
            <div className="downloads-list">
              {downloadedFiles.map((file) => (
                <div
                  key={file.path}
                  className={`download-item ${selectedFile === file.path ? 'selected' : ''}`}
                  onClick={() => setSelectedFile(file.path)}
                >
                  <div className="file-info">
                    <span className="file-name">{file.filename}</span>
                    <span className="file-size">{formatFileSize(file.size)}</span>
                    <span className="file-date">
                      {new Date(file.modifiedTime).toLocaleString()}
                    </span>
                  </div>
                  <div className="file-actions">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.path);
                      }}
                      className="delete-btn"
                      title="删除本地文件"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => refreshDownloadList()}
            className="refresh-btn"
          >
            🔄 刷新列表
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Format bytes to human-readable file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
