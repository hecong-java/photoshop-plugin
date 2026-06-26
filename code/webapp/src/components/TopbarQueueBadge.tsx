import { useSettingsStore } from '../stores/settingsStore';
import { useComfyUIStore } from '../stores/comfyui';
import { useLemonGridStore } from '../stores/lemongridStore';

/**
 * Always-visible queue badge for the topbar.
 * Shows queue/connection status for both Direct and Cluster modes.
 * Never hides — displays "空闲" when idle, "未连接" when disconnected.
 */
export const TopbarQueueBadge = () => {
  const connectionMode = useSettingsStore((s) => s.connectionMode);
  const comfyConnected = useSettingsStore((s) => s.comfyUI.isConnected);
  const queueRunning = useComfyUIStore((s) => s.queueRunning);
  const queuePending = useComfyUIStore((s) => s.queuePending);

  const lgConnected = useLemonGridStore((s) => s.isConnected);
  const queueSummary = useLemonGridStore((s) => s.queueSummary);

  const isDirect = connectionMode !== 'cluster';

  // Direct mode
  if (isDirect) {
    if (!comfyConnected) {
      return (
        <div className="topbar-queue-badge">
          <span className="topbar-queue-dot off" />
          <span className="topbar-queue-label">未连接</span>
        </div>
      );
    }
    const hasQueue = queueRunning.length > 0 || queuePending.length > 0;
    return (
      <div className="topbar-queue-badge">
        <span className={`topbar-queue-dot ${hasQueue ? 'busy' : 'idle'}`} />
        <span className="topbar-queue-label">
          {hasQueue
            ? `${queueRunning.length > 0 ? `${queueRunning.length} 运行中` : ''}${queueRunning.length > 0 && queuePending.length > 0 ? ' · ' : ''}${queuePending.length > 0 ? `${queuePending.length} 排队` : ''}`
            : '空闲'}
        </span>
      </div>
    );
  }

  // Cluster mode
  if (!lgConnected) {
    return (
      <div className="topbar-queue-badge">
        <span className="topbar-queue-dot off" />
        <span className="topbar-queue-label">未连接</span>
      </div>
    );
  }
  const hasQueue = queueSummary && (queueSummary.running_count > 0 || queueSummary.queued_count > 0);
  return (
    <div className="topbar-queue-badge">
      <span className={`topbar-queue-dot ${hasQueue ? 'busy' : 'idle'}`} />
      <span className="topbar-queue-label">
        {hasQueue && queueSummary
          ? `${queueSummary.running_count > 0 ? `${queueSummary.running_count} 运行中` : ''}${queueSummary.running_count > 0 && queueSummary.queued_count > 0 ? ' · ' : ''}${queueSummary.queued_count > 0 ? `${queueSummary.queued_count} 排队` : ''}`
          : '就绪'}
      </span>
    </div>
  );
};