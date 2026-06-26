import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  getDingTalkLoginUrl,
  pollDingTalkAuth,
  loginWithDingTalk,
} from '../services/lemongrid-auth';

type QRPhase = 'loading' | 'iframe' | 'qrcode' | 'error' | 'success';

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

  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    let cancelled = false;

    const startAuth = async () => {
      try {
        setPhase('loading');
        setErrorMessage(null);

        // Per D-20: UXP mode uses poll
        const result = await getDingTalkLoginUrl(serverUrl, 'poll');

        if (cancelled) return;

        setAuthUrl(result.auth_url);
        setAuthState(result.state);

        // Skip iframe — DingTalk blocks iframe embedding (X-Frame-Options).
        // Go straight to QR code rendering via qrcode.react.
        setPhase('qrcode');

        // Start polling in background regardless of iframe vs QR display
        pollDingTalkAuth(serverUrl, result.state, {
          signal: abortController.signal,
        })
          .then(async (pollResult) => {
            if (cancelled) return;
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
            if (cancelled) return;
            if (abortController.signal.aborted) return;

            const msg = pollErr instanceof Error ? pollErr.message : 'Unknown error';

            // Per D-28: Poll timeout keeps its dedicated copy.
            if (msg === 'POLL_TIMEOUT') {
              setErrorMessage('登录超时，请重试');
            } else {
              // Everything else (network failures, JSON-shaped bridge errors,
              // service errors) collapses to a user-friendly line via
              // classifyError. Avoids surfacing `{"code":"FETCH_ERROR",...}`
              // verbatim to the user.
              setErrorMessage(classifyError(msg));
            }
            setPhase('error');
            onError(classifyError(msg));
          });

        // Per D-10: Auto-refresh after 3 minutes (180000ms)
        refreshTimerRef.current = setTimeout(() => {
          if (!cancelled) {
            abortController.abort();
            setRefreshKey((k) => k + 1);
          }
        }, 180000);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        const friendly = classifyError(msg);
        setErrorMessage(friendly);
        setPhase('error');
        onError(friendly);
      }
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
    // inside the same 256x312 box.
    return (
      <div className="dingtalk-qr-placeholder" aria-busy="true" aria-live="polite">
        <div className="dingtalk-qr-spinner" />
        <div className="dingtalk-qr-placeholder-text">正在获取登录二维码...</div>
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
    return (
      <div className="dingtalk-qr-placeholder">
        <QRCodeSVG value={authUrl} size={256} level="H" bgColor="#ffffff" fgColor="#1a1a22" />
        <div className="dingtalk-qr-hint">
          请使用钉钉扫描二维码登录
        </div>
      </div>
    );
  }

  return null;
};
