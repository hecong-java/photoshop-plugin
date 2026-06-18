// MiniTaskList: Cluster mode task list per D-55 through D-68
// Shows all LemonGrid tasks below the Generate button with state badges,
// expand/collapse, cancel/retry/dismiss actions.

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLemonGridStore, type LemonGridTaskState } from '../stores/lemongridStore';
import { LemonGridClient, LEMONGRID_ERROR_SUGGESTIONS } from '../services/lemongrid';
import './MiniTaskList.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MiniTaskListProps {
  onRetry: (taskId: string) => void;
  onImportResult: (taskId: string, assetId: string) => void;
}

// ---------------------------------------------------------------------------
// Badge helpers per D-57
// ---------------------------------------------------------------------------

function badgeColor(status: LemonGridTaskState['status']): string {
  switch (status) {
    case 'PENDING': return 'pending';
    case 'QUEUED': return 'queued';
    case 'SYNCING': return 'syncing';
    case 'RUNNING': return 'running';
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'CANCELLED': return 'cancelled';
    default: return 'pending';
  }
}

function badgeText(status: LemonGridTaskState['status']): string {
  switch (status) {
    case 'PENDING': return '等待中';
    case 'QUEUED': return '排队中';
    case 'SYNCING': return '同步中';
    case 'RUNNING': return '生成中';
    case 'COMPLETED': return '已完成';
    case 'FAILED': return '失败';
    case 'CANCELLED': return '已取消';
    default: return '未知';
  }
}

// ---------------------------------------------------------------------------
// Duration formatter per D-30
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

// ---------------------------------------------------------------------------
// Active states check
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: LemonGridTaskState['status'][] = ['PENDING', 'QUEUED', 'SYNCING', 'RUNNING'];

function isActiveStatus(status: LemonGridTaskState['status']): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MiniTaskList: React.FC<MiniTaskListProps> = ({ onRetry, onImportResult }) => {
  const tasks = useLemonGridStore((s) => s.tasks);
  const removeTask = useLemonGridStore((s) => s.removeTask);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Per D-59: Sort tasks by submittedAt descending (newest first)
  const sortedTasks = useMemo(() => {
    return Object.values(tasks).sort((a, b) => b.submittedAt - a.submittedAt);
  }, [tasks]);

  // Per-task ETA polling: fetch ETA for QUEUED tasks every 30 seconds
  useEffect(() => {
    const queuedTasks = sortedTasks.filter(t => t.status === 'QUEUED');
    if (queuedTasks.length === 0) return;

    const serverUrl = useLemonGridStore.getState().serverUrl;
    if (!serverUrl) return;

    let cancelled = false;

    const fetchETAs = async () => {
      const client = new LemonGridClient({ serverUrl });
      for (const task of queuedTasks) {
        if (cancelled) break;
        try {
          const eta = await client.getTaskETA(task.taskId);
          if (!cancelled) {
            const waitMin = Math.ceil(eta.estimated_wait_seconds / 60);
            useLemonGridStore.getState().updateTask(task.taskId, {
              etaMinutes: waitMin > 0 ? waitMin : null,
              queuePosition: eta.queue_position,
            });
          }
        } catch {
          // ETA not available (task may have left queue) -- ignore silently
        }
      }
    };

    fetchETAs();
    const interval = setInterval(fetchETAs, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sortedTasks]);

  // Poll active task status every 5 seconds to recover from WS drops / navigation
  const refreshActiveTasks = useCallback(() => {
    const serverUrl = useLemonGridStore.getState().serverUrl;
    if (!serverUrl) return;
    const activeTasks = Object.values(useLemonGridStore.getState().tasks)
      .filter(t => isActiveStatus(t.status));
    if (activeTasks.length === 0) return;

    const client = new LemonGridClient({ serverUrl });
    for (const task of activeTasks) {
      client.getTaskStatus(task.taskId).then((status) => {
        useLemonGridStore.getState().updateTask(task.taskId, {
          status: status.status,
          progress: status.progress,
          progressDetail: status.progress_detail,
          queuePosition: status.queue_position,
          errorCode: status.error_code,
          errorMessage: status.error_message,
          outputAssetIds: status.output_file_ids ?? [],
          durationSeconds: status.duration_seconds,
          completedAt: status.completed_at ? new Date(status.completed_at).getTime() : null,
        });
      }).catch(() => { /* task may not exist on server yet */ });
    }
  }, []);

  useEffect(() => {
    refreshActiveTasks();
    const interval = setInterval(refreshActiveTasks, 5000);
    return () => clearInterval(interval);
  }, [refreshActiveTasks, sortedTasks]);

  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    refreshActiveTasks();
    refreshTimerRef.current = setTimeout(() => setRefreshing(false), 1000);
  };

  useEffect(() => () => clearTimeout(refreshTimerRef.current), []);

  // Per D-60: Summary bar with counts by status
  const summaryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of sortedTasks) {
      const key = task.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [sortedTasks]);

  // Per D-65: Cancel action from collapsed item
  const handleCancel = async (taskId: string) => {
    try {
      const serverUrl = useLemonGridStore.getState().serverUrl;
      const client = new LemonGridClient({ serverUrl });
      await client.cancelTask(taskId);
      useLemonGridStore.getState().updateTask(taskId, { status: 'CANCELLED' });
    } catch (e) {
      console.error('[MiniTaskList] Cancel failed:', e);
    }
  };

  if (sortedTasks.length === 0) return null;

  // Build summary text per D-60
  const summaryParts: string[] = [];
  const runningCount = (summaryCounts['PENDING'] || 0) + (summaryCounts['QUEUED'] || 0) + (summaryCounts['SYNCING'] || 0) + (summaryCounts['RUNNING'] || 0);
  const completedCount = summaryCounts['COMPLETED'] || 0;
  const failedCount = summaryCounts['FAILED'] || 0;
  if (runningCount > 0) summaryParts.push(`${runningCount} 运行中`);
  if (completedCount > 0) summaryParts.push(`${completedCount} 已完成`);
  if (failedCount > 0) summaryParts.push(`${failedCount} 失败`);

  return (
    <div className="mini-task-list">
      {summaryParts.length > 0 && (
        <div className="mini-task-summary">
          <span>{summaryParts.join(', ')}</span>
          <button
            className={`task-refresh-btn ${refreshing ? 'spinning' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
            title="刷新任务状态"
          >
            &#x21bb;
          </button>
        </div>
      )}

      {sortedTasks.map((task) => {
        const isExpanded = expandedTaskId === task.taskId;
        const badge = badgeColor(task.status);

        return (
          <div
            key={task.taskId}
            className={`mini-task-item ${isExpanded ? 'expanded' : 'collapsed'}`}
            onClick={() => setExpandedTaskId(isExpanded ? null : task.taskId)}
          >
            {/* Header row (always visible) per D-58, D-65, D-66, D-68 */}
            <div className="task-header-row">
              <span className="task-template-name">{task.templateName}</span>

              <div className="task-progress-mini">
                {isActiveStatus(task.status) && (
                  <div className="progress-bar-mini">
                    <div
                      className="progress-fill-mini"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                )}
              </div>

              <span className={`task-badge badge-${badge}`}>
                {task.status === 'COMPLETED' ? '\u2713 ' : ''}
                {badgeText(task.status)}
              </span>

              {task.status === 'QUEUED' && task.queuePosition && (
                <span className="queue-position">#{task.queuePosition}</span>
              )}

              {task.status === 'QUEUED' && task.etaMinutes != null && task.etaMinutes > 0 && (
                <span className="eta-text">~{task.etaMinutes}分钟</span>
              )}

              {isActiveStatus(task.status) && (
                <button
                  className="task-cancel-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancel(task.taskId);
                  }}
                  title="取消任务"
                >
                  X
                </button>
              )}
            </div>

            {/* Expanded details per D-56, D-61, D-62, D-63, D-64, D-67 */}
            {isExpanded && (
              <div className="task-details" onClick={(e) => e.stopPropagation()}>
                {task.status === 'QUEUED' && task.queuePosition && (
                  <div className="task-detail-row">排队位置: #{task.queuePosition}</div>
                )}

                {task.status === 'QUEUED' && task.etaMinutes != null && task.etaMinutes > 0 && (
                  <div className="task-detail-row eta-detail">预计等待: ~{task.etaMinutes}分钟</div>
                )}

                {task.status === 'RUNNING' && task.progressDetail && (
                  <div className="task-detail-row">{task.progressDetail}</div>
                )}

                {task.status === 'RUNNING' && (
                  <div className="task-detail-row">{task.progress}%</div>
                )}

                {task.status === 'COMPLETED' && task.durationSeconds != null && (
                  <div className="task-detail-row">用时: {formatDuration(task.durationSeconds)}</div>
                )}

                {task.status === 'COMPLETED' && task.outputAssetIds.length > 0 && (
                  <div className="task-results">
                    {task.outputAssetIds.map((assetId) => (
                      <button
                        key={assetId}
                        className="task-import-btn"
                        onClick={() => onImportResult(task.taskId, assetId)}
                      >
                        导入到 PS
                      </button>
                    ))}
                  </div>
                )}

                {task.status === 'FAILED' && (
                  <div className="task-error">
                    {task.errorCode && (
                      <div className="error-code">错误码: {task.errorCode}</div>
                    )}
                    {task.errorMessage && (
                      <div className="error-message">{task.errorMessage}</div>
                    )}
                    <div className="error-suggestion">
                      {LEMONGRID_ERROR_SUGGESTIONS[task.errorCode || ''] || '请重试'}
                    </div>
                    <div className="error-actions">
                      <button
                        className="retry-btn"
                        onClick={() => onRetry(task.taskId)}
                      >
                        重试
                      </button>
                      <button
                        className="dismiss-btn"
                        onClick={() => removeTask(task.taskId)}
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                )}

                {task.status === 'CANCELLED' && (
                  <div className="task-cancelled-details">
                    <button
                      className="dismiss-btn"
                      onClick={() => removeTask(task.taskId)}
                    >
                      关闭
                    </button>
                  </div>
                )}

                {task.thumbnail && (
                  <img
                    className="task-thumbnail"
                    src={task.thumbnail}
                    alt="preview"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
