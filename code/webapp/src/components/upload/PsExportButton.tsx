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
}

export const PsExportButton: React.FC<PsExportButtonProps> = ({
  onExport,
  onError,
  mode = 'layer',
  label,
  iconOnly = false,
  compact = false
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
      
      await Promise.resolve(onExport?.(blob));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to export layer:', err);
      onError?.(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="ps-export-button-container">
      <button
        className={`ps-export-button ${iconOnly ? 'icon-only' : ''} ${compact ? 'compact' : ''}`.trim()}
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
