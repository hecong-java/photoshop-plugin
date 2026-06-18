import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ContextMenu } from './ContextMenu';
import { usePromptReverseStore } from '../../stores/promptReverseStore';
import { imageElementToBase64 } from '../../services/dashscope';

interface PromptReverseProviderProps {
  children: React.ReactNode;
}

export const PromptReverseProvider: React.FC<PromptReverseProviderProps> = ({ children }) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const targetImageRef = useRef<HTMLImageElement | null>(null);
  const startFlow = usePromptReverseStore((state) => state.startFlow);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const imgElement = target.closest('img[data-prompt-reverse]') as HTMLImageElement | null;
    console.log('[PromptReverse] contextmenu event, target:', target.tagName, 'found img:', !!imgElement);
    if (!imgElement) return;

    e.preventDefault();
    targetImageRef.current = imgElement;
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuVisible(true);
    console.log('[PromptReverse] context menu shown');
  }, []);

  useEffect(() => {
    const handleDismiss = () => setMenuVisible(false);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  const handleMenuAction = useCallback(async () => {
    setMenuVisible(false);
    const imgElement = targetImageRef.current;
    console.log('[PromptReverse] handleMenuAction called, imgElement:', !!imgElement);
    if (!imgElement) return;

    const previewUrl = imgElement.src;
    const assetId = imgElement.getAttribute('data-asset-id');
    console.log('[PromptReverse] previewUrl:', previewUrl?.substring(0, 80), 'assetId:', assetId);

    try {
      const base64 = await imageElementToBase64(imgElement);
      console.log('[PromptReverse] base64 extracted, length:', base64?.length);
      startFlow(base64, previewUrl, assetId || undefined);
    } catch (error) {
      console.log('[PromptReverse] base64 extraction failed:', error);
      // CORS failure on cross-origin images — if we have an assetId, skip base64
      if (assetId) {
        startFlow(null, previewUrl, assetId);
        console.log('[PromptReverse] started flow with assetId fallback');
      } else {
        console.error('[PromptReverse] Failed to extract image and no assetId:', error);
      }
    }
    targetImageRef.current = null;
  }, [startFlow]);

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
