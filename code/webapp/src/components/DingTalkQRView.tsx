import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  getDingTalkLoginUrl,
  getDingTalkOrgs,
  pollDingTalkAuth,
  loginWithDingTalk,
  type DingTalkOrg,
} from '../services/lemongrid-auth';

type QRPhase = 'loading' | 'org-select' | 'iframe' | 'qrcode' | 'error' | 'success';

interface DingTalkQRViewProps {
  serverUrl: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

/**
 * Map a raw error message coming back from the auth/bridge layer to a
 * user-friendly Chinese message. The bridge often returns noisy JSON like
 * `{"code":"FETCH_ERROR","message":"Already read","url":"..."}` for
 * infrastructure failures — we don't want that surfaced verbatim to the
 * user, just a clean "服务器连接失败".
 */
const classifyError = (raw: string): string => {
  if (!raw) return '服务器连接失败';
  // Network / fetch / DNS / TLS / connection-reset / "Already read" (bridge
  // body-stream re-read on error) all collapse to one user-friendly line.
  if (
    raw.includes('FETCH_ERROR') ||
    raw.includes('Failed to fetch') ||
    raw.includes('NetworkError') ||
    raw.includes('Network request failed') ||
    raw.includes('Already read') ||
    raw.includes('net::') ||
    /^\s*\{/.test(raw) // any JSON-shaped error string
  ) {
    return '服务器连接失败';
  }
  return raw;
};

export const DingTalkQRView = ({ serverUrl, onSuccess, onError }: DingTalkQRViewProps) => {
  const [phase, setPhase] = useState<QRPhase>('loading');
  const [authUrl, setAuthUrl] = useState('');
  const [, setAuthState] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // 多活跃组织（后端 261022 多组织改造）时先让用户选组织再拿 login-url。
  // 单组织/老后端（接口 404 → 空数组）不出现选择页，保持原扫码体验。
  const [pendingOrgs, setPendingOrgs] = useState<DingTalkOrg[] | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 组织选择页的点击处理由 effect 内部注入（那里才有 cancelled/signal 作用域）
  const orgPickRef = useRef<(orgCode: string) => void>(() => {});

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setPhase('loading');
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!serverUrl) return;

    // Create fresh AbortController for this cycle
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    let cancelled = false;

    const reportError = (err: unknown) => {
      if (cancelled || signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const friendly = classifyError(msg);
      setErrorMessage(friendly);
      setPhase('error');
      onError(friendly);
    };

    // Fetch login-url with the given org, render QR, and start background
    // polling. Rejects only on the login-url fetch itself (poll/timer handle
    // their own errors below).
    const runQr = async (orgCode?: string) => {
      // Per D-20: UXP mode uses poll; orgCode disambiguates multi-org backends
      const result = await getDingTalkLoginUrl(serverUrl, 'poll', orgCode);

      if (cancelled || signal.aborted) return;

      setAuthUrl(result.auth_url);
      setAuthState(result.state);

      // Skip iframe — DingTalk blocks iframe embedding (X-Frame-Options).
      // Go straight to QR code rendering via qrcode.react.
      setPhase('qrcode');

      // Start polling in background regardless of iframe vs QR display
      pollDingTalkAuth(serverUrl, result.state, { signal })
        .then(async (pollResult) => {
          if (cancelled || signal.aborted) return;
          setPhase('success');
          try {
            await loginWithDingTalk(serverUrl, pollResult.data);
            onSuccess();
          } catch (loginErr) {
            const msg = loginErr instanceof Error ? loginErr.message : 'Login failed';
            setErrorMessage(msg);
            setPhase('error');
            onError(msg);
          }
        })
        .catch((pollErr) => {
          if (cancelled || signal.aborted) return;

          const msg = pollErr instanceof Error ? pollErr.message : 'Unknown error';

          // Per D-28: Poll timeout keeps its dedicated copy.
          if (msg === 'POLL_TIMEOUT') {
            setErrorMessage('登录超时，请重试');
            setPhase('error');
            onError('登录超时，请重试');
          } else {
            // Everything else (network failures, JSON-shaped bridge errors,
            // service errors) collapses to a user-friendly line via
            // classifyError. Avoids surfacing `{"code":"FETCH_ERROR",...}`
            // verbatim to the user.
            const friendly = classifyError(msg);
            setErrorMessage(friendly);
            setPhase('error');
            onError(friendly);
          }
        });

      // Per D-10: Auto-refresh after 3 minutes (180000ms)
      refreshTimerRef.current = setTimeout(() => {
        if (!cancelled) {
          abortController.abort();
          setRefreshKey((k) => k + 1);
        }
      }, 180000);
    };

    const startAuth = async () => {
      try {
        setPhase('loading');
        setErrorMessage(null);

        // 多组织后端要求 login-url 必带 org_code（否则 400"存在多个接入组织"）。
        // /orgs 拉取失败或返回空（老后端）→ 不带 org_code 直取，后端按唯一
        // 活跃组织兜底；多个活跃组织 → 出组织选择页。
        const orgs = await getDingTalkOrgs(serverUrl);
        if (cancelled || signal.aborted) return;

        if (orgs.length > 1) {
          setPendingOrgs(orgs);
          setPhase('org-select');
          return;
        }

        await runQr(orgs.length === 1 ? orgs[0].org_code : undefined);
      } catch (err) {
        reportError(err);
      }
    };

    orgPickRef.current = (orgCode: string) => {
      setPendingOrgs(null);
      setPhase('loading');
      runQr(orgCode).catch(reportError);
    };

    startAuth();

    return () => {
      cancelled = true;
      abortController.abort();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (iframeTimeoutRef.current) {
        clearTimeout(iframeTimeoutRef.current);
        iframeTimeoutRef.current = null;
      }
    };
  }, [serverUrl, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIframeLoad = useCallback(() => {
    if (iframeTimeoutRef.current) {
      clearTimeout(iframeTimeoutRef.current);
      iframeTimeoutRef.current = null;
    }
    // iframe loaded successfully, stay on iframe phase
  }, []);

  const handleIframeError = useCallback(() => {
    if (iframeTimeoutRef.current) {
      clearTimeout(iframeTimeoutRef.current);
      iframeTimeoutRef.current = null;
    }
    // Per D-04: iframe failed, fallback to QR code
    setPhase('qrcode');
  }, []);

  // Set iframe timeout when phase becomes 'iframe'
  useEffect(() => {
    if (phase === 'iframe' && authUrl) {
      // Per plan: 5-second timeout for iframe load
      iframeTimeoutRef.current = setTimeout(() => {
        setPhase('qrcode');
      }, 5000);
      return () => {
        if (iframeTimeoutRef.current) {
          clearTimeout(iframeTimeoutRef.current);
          iframeTimeoutRef.current = null;
        }
      };
    }
  }, [phase, authUrl]);

  if (phase === 'loading') {
    // Same outer dimensions as the QR phase below so the LoginModal card
    // doesn't jump height when the QR arrives. Just renders a spinner
    // inside the same 256x286 box.
    return (
      <div className="dingtalk-qr-placeholder" aria-busy="true" aria-live="polite">
        <div className="dingtalk-qr-spinner" />
        <div className="dingtalk-qr-placeholder-text">正在获取登录二维码...</div>
      </div>
    );
  }

  if (phase === 'org-select' && pendingOrgs) {
    return (
      <div className="dingtalk-qr-placeholder dingtalk-org-select" aria-live="polite">
        <div className="dingtalk-org-select-title">请选择要登录的组织</div>
        {pendingOrgs.map((org) => (
          <button
            key={org.org_code}
            type="button"
            className="dingtalk-btn dingtalk-org-btn"
            onClick={() => orgPickRef.current(org.org_code)}
          >
            {org.name}
          </button>
        ))}
      </div>
    );
  }

  if (phase === 'success') {
    return (
      <div className="dingtalk-qr-container" style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ fontSize: '14px', color: '#27ae60' }}>
          登录成功
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    // Dedicated error container — does NOT use .dingtalk-qr-container
    // because that one has a hard white background meant for the QR code
    // surface. On the error path we want a clean dark-themed card with
    // the retry button visually centered.
    return (
      <div className="dingtalk-qr-error">
        <div className="dingtalk-qr-error-message">
          {errorMessage || '服务器连接失败'}
        </div>
        <button
          className="dingtalk-btn dingtalk-btn-inline"
          onClick={handleRetry}
          type="button"
        >
          重新获取
        </button>
      </div>
    );
  }

  if (phase === 'iframe' && authUrl) {
    return (
      <div className="dingtalk-qr-container">
        <iframe
          src={authUrl}
          width="100%"
          height="320px"
          frameBorder="0"
          sandbox="allow-scripts allow-forms allow-popups"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          title="DingTalk QR Login"
          style={{ border: 'none', borderRadius: '6px' }}
        />
      </div>
    );
  }

  // phase === 'qrcode' -- fallback or primary
  if (authUrl) {
    // Identical outer dimensions to the loading placeholder so swapping
    // in the QR doesn't resize the LoginModal.
    // dingtalk-qr-card：二维码+提示整卡白底（方案A 2026-10-07），
    // loading 占位不加此类、保持暗色。
    return (
      <div className="dingtalk-qr-placeholder dingtalk-qr-card">
        {/* 224 而非 256：卡片宽 256，码撑满会左右贴边没有 quiet zone；224 → 左右各留 16px 白边 */}
        <QRCodeSVG value={authUrl} size={224} level="H" bgColor="#ffffff" fgColor="#1a1a22" />
        <div className="dingtalk-qr-hint">
          请使用钉钉扫描二维码登录
        </div>
      </div>
    );
  }

  return null;
};
