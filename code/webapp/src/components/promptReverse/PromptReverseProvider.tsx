import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ContextMenu } from './ContextMenu';
import { usePromptReverseStore } from '../../stores/promptReverseStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { imageElementToBase64 } from '../../services/dashscope';

interface PromptReverseProviderProps {
  children: React.ReactNode;
}

export const PromptReverseProvider: React.FC<PromptReverseProviderProps> = ({ children }) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const targetImageRef = useRef<HTMLImageElement | null>(null);
  const startFlow = usePromptReverseStore((state) => state.startFlow);
  const connectionMode = useSettingsStore((s) => s.connectionMode);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const imgElement = target.closest('img[data-prompt-reverse]') as HTMLImageElement | null;
    if (!imgElement) return;

    e.preventDefault();
    targetImageRef.current = imgElement;
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuVisible(true);
  }, []);

  // Dismiss menu on scroll or resize
  useEffect(() => {
    const handleDismiss = () => setMenuVisible(false);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, []);

  // Global contextmenu listener
  useEffect(() => {
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  const handleMenuAction = useCallback(async () => {
    setMenuVisible(false);
    const imgElement = targetImageRef.current;
    if (!imgElement) return;

    try {
      const base64 = await imageElementToBase64(imgElement);
      const previewUrl = imgElement.src;
      if (connectionMode === 'cluster') {
        const assetId = imgElement.getAttribute('data-asset-id');
        startFlow(base64, previewUrl, assetId || undefined);
      } else {
        startFlow(base64, previewUrl);
      }
    } catch (error) {
      console.error('[PromptReverse] Failed to extract image:', error);
    }
    targetImageRef.current = null;
  }, [startFlow, connectionMode]);

  const handleMenuDismiss = useCallback(() => {
    setMenuVisible(false);
    targetImageRef.current = null;
  }, []);

  return (
    <>
      {children}
      <ContextMenu
        x={menuPosition.x}
        y={menuPosition.y}
        visible={menuVisible}
        onAction={handleMenuAction}
        onDismiss={handleMenuDismiss}
      />
    </>
  );
};
