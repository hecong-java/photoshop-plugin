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

export const DingTalkQRView = ({ serverUrl, onSuccess, onError }: DingTalkQRViewProps) => {
  const [phase, setPhase] = useState<QRPhase>('loading');
  const [authUrl, setAuthUrl] = useState('');
  const [authState, setAuthState] = useState('');
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

        // Per D-04: Try iframe first
        setPhase('iframe');

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

            // Per D-28: Poll timeout
            if (msg === 'POLL_TIMEOUT') {
              setErrorMessage('登录超时，请重试');
            }
            // Per D-27: Network errors
            else if (
              msg.includes('NetworkError') ||
              msg.includes('Failed to fetch') ||
              msg.includes('fetch')
            ) {
              setErrorMessage('网络连接失败');
            }
            // Per D-25: DingTalk service errors; Per D-26: Authorization cancelled
            else {
              setErrorMessage(msg);
            }
            setPhase('error');
            onError(msg);
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
        setErrorMessage(msg);
        setPhase('error');
        onError(msg);
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
    return (
      <div className="dingtalk-qr-container" style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ fontSize: '14px', color: 'var(--color-text-secondary, #999)' }}>
          正在获取登录二维码...
        </div>
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
    return (
      <div className="dingtalk-qr-container" style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: '13px', color: '#e74c3c', marginBottom: '12px' }}>
          {errorMessage || '未知错误'}
        </div>
        <button
          className="dingtalk-btn"
          onClick={handleRetry}
          type="button"
          style={{ width: 'auto', padding: '8px 24px' }}
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
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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
    return (
      <div className="dingtalk-qr-container" style={{ textAlign: 'center', padding: '8px 0' }}>
        <QRCodeSVG value={authUrl} size={200} level="M" />
        <div style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary, #999)',
          marginTop: '12px',
        }}>
          请使用钉钉扫描二维码登录
        </div>
      </div>
    );
  }

  return null;
};
