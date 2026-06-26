import React, { useState } from 'react';
import { exportSelectionPng, exportActiveLayerPng } from '../../services/upload';

import './PsExportButton.css';

export interface PsExportButtonProps {
  onExport?: (blob: Blob) => void | Promise<void>;
  onError?: (error: Error) => void;
  mode?: 'selection' | 'layer';
  label?: string;
  iconOnly?: boolean;
  compact?: boolean;
  fullWidth?: boolean;
}

export const PsExportButton: React.FC<PsExportButtonProps> = ({
  onExport,
  onError,
  mode = 'layer',
  label,
  iconOnly = false,
  compact = false,
  fullWidth = false
}) => {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const exportLabel = mode === 'selection' ? 'selection' : 'layer';
      console.log(`Starting PS ${exportLabel} export...`);

      const blob = mode === 'selection'
        ? await exportSelectionPng()
        : await exportActiveLayerPng();
      console.log(`Successfully exported ${exportLabel}, size:`, blob.size);
      
      await Promise.resolve(onExport?.(blob)).catch(() => {});
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const msg = err.message || '';
      // Translate known bridge error codes to user-friendly Chinese messages
      let friendlyMsg = msg;
      if (msg.includes('ACTIVE_LAYER_HIDDEN')) {
        friendlyMsg = '当前图层已隐藏，请先在图层面板中取消隐藏再导出';
      } else if (msg.includes('NO_ACTIVE_LAYER')) {
        friendlyMsg = '没有选中的图层，请先选择一个图层';
      } else if (msg.includes('NO_ACTIVE_DOCUMENT')) {
        friendlyMsg = '没有打开的文档，请先打开一个文件';
      }
      const friendlyErr = new Error(friendlyMsg);
      friendlyErr.name = err.name;
      console.error('Failed to export layer:', friendlyMsg);
      onError?.(friendlyErr);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`ps-export-button-container ${fullWidth ? 'full-width' : ''}`.trim()}>
      <button
        className={`ps-export-button ${iconOnly ? 'icon-only' : ''} ${compact ? 'compact' : ''} ${fullWidth ? 'full-width' : ''}`.trim()}
        onClick={handleExport}
        disabled={isExporting}
        title={mode === 'selection' ? '从 Photoshop 加载选区' : '从 Photoshop 加载当前选中图层'}
        aria-label={label || (mode === 'selection' ? '从 PS 选区加载' : '从 PS 图层加载')}
      >
        {isExporting ? (
          <>
            <div className="spinner-small"></div>
            {!iconOnly && <span>加载中...</span>}
          </>
        ) : (
          <>
            <svg className="ps-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <path d="M7 8h10M7 12h10M7 16h6"></path>
            </svg>
            {!iconOnly && <span>{label || (mode === 'selection' ? '从 PS 选区加载' : '从 PS 图层加载')}</span>}
          </>
        )}
      </button>
    </div>
  );
};
