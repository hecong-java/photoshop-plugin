import React, { useEffect, useRef } from 'react';
import './ContextMenu.css';

interface ContextMenuProps {
  x: number;
  y: number;
  visible: boolean;
  onAction: () => void;
  onDismiss: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  visible,
  onAction,
  onDismiss,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp position to viewport
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const adjustedX = Math.min(x, window.innerWidth - rect.width - 8);
    const adjustedY = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [x, y, visible]);

  // Dismiss on Escape
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className="prompt-reverse-menu-overlay"
      onClick={onDismiss}
      onContextMenu={(e) => { e.preventDefault(); onDismiss(); }}
    >
      <div
        ref={menuRef}
        className="prompt-reverse-menu"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        style={{ left: x, top: y }}
      >
        <button
          className="prompt-reverse-menu-item"
          onClick={() => onAction()}
        >
          反推提示词
        </button>
      </div>
    </div>
  );
};
