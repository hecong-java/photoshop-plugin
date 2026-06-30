import { useState, useEffect, useRef } from 'react';
import { useLemonGridStore } from '../stores/lemongridStore';
import {
  verifyServerUrl,
  setUserProvidedUrl,
  setLockedUrl,
  pickWorkingUrl,
  getEffectiveCandidates,
  LEMONGRID_PRIMARY_URL,
} from '../services/lemongrid-url';
import './ServerUrlSettingsModal.css';

interface ServerUrlSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ProbeStatus = 'idle' | 'probing' | 'success' | 'failure';

/**
 * Normalize a user-typed server URL for storage / probing.
 *
 * Rules:
 * - Trim whitespace.
 * - Strip trailing slashes.
 * - Empty input → null (caller interprets as "clear override").
 *
 * Note: bare-IP / hostname auto-prepending (e.g. "8.163.4.73" → "http://...")
 * is intentionally NOT done here. The format-validator already rejects inputs
 * without a scheme, so the user has to type "http://" themselves. This avoids
 * silently turning "8.163.4.73:8080" into "http://8.163.4.73:8080" for cases
 * where the user actually meant something else.
 */
const normalizeInput = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
};

/**
 * Strict URL-format check. Accepts:
 *   - http://host[:port]
 *   - https://host[:port]
 * Rejects bare IPs/hostnames (the user must include the scheme).
 */
const isValidUrlFormat = (raw: string): boolean => {
  if (!raw) return false;
  return /^https?:\/\/[\w.\-]+(?::\d+)?(?:\/.*)?$/.test(raw.trim());
};

export const ServerUrlSettingsModal = ({ isOpen, onClose }: ServerUrlSettingsModalProps) => {
  const customServerUrl = useLemonGridStore((state) => state.customServerUrl);
  const setCustomServerUrl = useLemonGridStore((state) => state.setCustomServerUrl);
  const setServerUrl = useLemonGridStore((state) => state.setServerUrl);

  const [draft, setDraft] = useState('');
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const isProbingRef = useRef(false);

  // Reset state when the modal opens. We deliberately do NOT depend on
  // `customServerUrl` here — `handleSave` calls `setCustomServerUrl`, and
  // if this effect re-ran on that change it would clobber the 'success' /
  // 'failure' status the save handler just set, making the UI look frozen
  // on the first click. `customServerUrl` is only consumed on open.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(customServerUrl || '');
    setProbeStatus('idle');
    setStatusMessage(null);
    setFormatError(null);
    isProbingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  /**
   * Clear the user-provided URL override (in both the store and the
   * failover module) and re-probe [PRIMARY, FALLBACK] to re-lock a
   * working default. Without the explicit re-probe, lockedUrl and
   * store.serverUrl would still point at the now-cleared user URL,
   * so subsequent login requests would keep hitting a dead server
   * instead of falling back to the default candidates.
   */
  const restoreDefaultAndProbe = async () => {
    setCustomServerUrl(null);
    setUserProvidedUrl(null);
    setProbeStatus('probing');
    setStatusMessage('正在恢复默认地址...');
    try {
      const working = await pickWorkingUrl();
      if (working) {
        // pickWorkingUrl already setLockedUrl internally; sync the
        // store so LoginModal.effectiveServerUrl reflects it.
        setServerUrl(working);
        setProbeStatus('success');
        setStatusMessage('已恢复默认服务器地址');
      } else {
        // Neither PRIMARY nor FALLBACK reachable — leave the existing
        // lockedUrl/store.serverUrl untouched and surface a warning.
        setProbeStatus('failure');
        setStatusMessage('默认地址均不可达，请检查网络');
      }
    } catch {
      setProbeStatus('failure');
      setStatusMessage('恢复默认地址失败');
    }
  };

  const handleDraftChange = (next: string) => {
    setDraft(next);
    // Clear transient status when the user edits the field again.
    if (probeStatus !== 'idle') {
      setProbeStatus('idle');
      setStatusMessage(null);
    }
    // Live format check so the save button can be disabled on bad input.
    if (next.trim() && !isValidUrlFormat(next)) {
      setFormatError('地址格式无效，需以 http:// 或 https:// 开头');
    } else {
      setFormatError(null);
    }
  };

  const handleClear = async () => {
    // Clear = restore default (PRIMARY/FALLBACK) and re-probe to re-lock.
    // Just nulling out customServerUrl/userProvidedUrl leaves lockedUrl and
    // store.serverUrl still pointing at the now-removed override, which
    // would silently break login. restoreDefaultAndProbe handles all of it.
    setDraft('');
    isProbingRef.current = true;
    try {
      await restoreDefaultAndProbe();
    } finally {
      isProbingRef.current = false;
    }
  };

  const handleSave = async () => {
    if (isProbingRef.current) return;
    const normalized = normalizeInput(draft);
    if (normalized && !isValidUrlFormat(draft)) {
      setFormatError('地址格式无效，需以 http:// 或 https:// 开头');
      return;
    }

    isProbingRef.current = true;
    setProbeStatus('probing');
    setStatusMessage('正在验证服务器...');
    setFormatError(null);

    try {
      if (!normalized) {
        // Empty input → treat as "clear". Re-probe defaults and re-lock
        // so subsequent login requests fall back to [PRIMARY, FALLBACK]
        // instead of staying pinned at the now-removed override.
        await restoreDefaultAndProbe();
        return;
      }

      const reachable = await verifyServerUrl(normalized);
      if (reachable) {
        // Persist + push into failover module + lock immediately so the
        // very next request goes to the user-provided server.
        setCustomServerUrl(normalized);
        setUserProvidedUrl(normalized);
        setLockedUrl(normalized);
        setProbeStatus('success');
        setStatusMessage('服务器地址已配置');
      } else {
        // Persist anyway so the user's choice isn't lost, but DON'T lock
        // it — leave failover to fall through to PRIMARY/FALLBACK.
        setCustomServerUrl(normalized);
        setUserProvidedUrl(normalized);
        setProbeStatus('failure');
        const candidates = getEffectiveCandidates();
        const hasFallback = candidates.length > 1;
        setStatusMessage(
          hasFallback
            ? '无法连接该服务器，将自动降级到默认地址'
            : '无法连接该服务器',
        );
      }
    } catch (err) {
      // verifyServerUrl swallows its own errors and returns false, so
      // reaching here would be unexpected; surface it just in case.
      console.warn('[ServerUrlSettingsModal] Unexpected probe error:', err);
      setProbeStatus('failure');
      setStatusMessage('验证过程出现异常');
    } finally {
      isProbingRef.current = false;
    }
  };

  // Save is enabled when:
  //   - Not currently probing, AND
  //   - No format error, AND
  //   - Draft is either empty OR a valid-format URL.
  const canSave =
    !isProbingRef.current &&
    probeStatus !== 'probing' &&
    !formatError &&
    (!draft.trim() || isValidUrlFormat(draft));

  // Show a one-liner about the active default candidates so the user
  // understands what "默认地址" means in the failure message.
  const candidateSummary = (() => {
    const list = getEffectiveCandidates();
    if (list.length === 0) return LEMONGRID_PRIMARY_URL;
    return list.join(' → ');
  })();

  return (
    <div
      className="server-url-settings-overlay"
      onClick={(e) => {
        // Click outside the card closes the settings dialog but leaves
        // the LoginModal open behind it — user can resume logging in.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="server-url-settings-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && canSave) handleSave();
        }}
      >
        <h3 className="server-url-settings-title">
          服务器地址
          <button
            type="button"
            className="server-url-settings-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </h3>

        <div className="server-url-settings-form">
          <div className="form-group">
            <label htmlFor="server-url-input">自定义地址</label>
            <input
              id="server-url-input"
              type="text"
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder="http://your-server:port"
              className="text-input"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
            <div className="server-url-hint">
              留空将恢复默认地址（{candidateSummary}）
            </div>
          </div>

          {formatError && (
            <div className="server-url-error">{formatError}</div>
          )}

          {statusMessage && (
            <div
              className={
                probeStatus === 'success'
                  ? 'server-url-status server-url-status-success'
                  : probeStatus === 'failure'
                  ? 'server-url-status server-url-status-failure'
                  : 'server-url-status server-url-status-info'
              }
            >
              {statusMessage}
            </div>
          )}

          <div className="server-url-actions">
            <button
              type="button"
              className="server-url-btn server-url-btn-primary"
              onClick={handleSave}
              disabled={!canSave}
            >
              {probeStatus === 'probing' ? '验证中...' : '保存'}
            </button>
            <button
              type="button"
              className="server-url-btn server-url-btn-secondary"
              onClick={handleClear}
              disabled={probeStatus === 'probing'}
            >
              清空
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};