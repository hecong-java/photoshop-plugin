import { useEffect } from 'react';
import { sendBridgeMessage } from './usePSBridge';
import { isUXPWebView } from '../services/upload';

/**
 * Valid shortcut key combinations that should be forwarded to Photoshop.
 * Format: Ctrl+Shift+Alt+Key (modifier parts only present when held).
 */
const SHORTCUT_ACTIONS: Record<string, boolean> = {
  'Delete': true,
  'Backspace': true,
  'Ctrl+z': true,
  'Ctrl+Shift+z': true,
  'Ctrl+s': true,
  'Ctrl+c': true,
  'Ctrl+v': true,
  'Ctrl+a': true,
  'Ctrl+d': true,
  'Ctrl+t': true,
  'ArrowUp': true,
  'ArrowDown': true,
  'ArrowLeft': true,
  'ArrowRight': true,
  'BracketLeft': true,
  'BracketRight': true,
};

/**
 * React hook that intercepts recognized Photoshop keyboard shortcuts
 * from the webview and forwards them to Photoshop via the Bridge layer.
 *
 * Only active when running inside the UXP WebView environment.
 * Does NOT intercept events when the user is typing in an input field.
 */
export function useKeyboardPassthrough(): void {
  useEffect(() => {
    if (!isUXPWebView()) return;

    const handleKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      // Do not intercept when user is typing in an input field
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Build shortcut key string
      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
      if (event.shiftKey) parts.push('Shift');
      if (event.altKey) parts.push('Alt');
      parts.push(event.key);
      const shortcutKey = parts.join('+');

      // Only forward whitelisted shortcuts
      if (!SHORTCUT_ACTIONS[shortcutKey]) return;

      event.preventDefault();
      event.stopPropagation();

      sendBridgeMessage('ps.executeShortcut', {
        key: event.key,
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      }).catch(() => {
        // Shortcut execution is best-effort; silently ignore errors
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);
}
