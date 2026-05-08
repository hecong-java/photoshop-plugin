import { useState, useEffect } from 'react';
import { useLemonGridStore } from '../stores/lemongridStore';
import { loginToLemonGrid, getUserProfile, syncAuthToBridge, encryptPassword, getDingTalkLoginUrl } from '../services/lemongrid-auth';
import { DingTalkQRView } from './DingTalkQRView';
import { isUXPWebView } from '../services/upload';
import './LoginModal.css';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
}

export const LoginModal = ({ isOpen, onClose, onLoginSuccess }: LoginModalProps) => {
  const serverUrl = useLemonGridStore((state) => state.serverUrl);
  const storedUsername = useLemonGridStore((state) => state.username);
  const setAuth = useLemonGridStore((state) => state.setAuth);
  const setServerUrl = useLemonGridStore((state) => state.setServerUrl);
  const setConnected = useLemonGridStore((state) => state.setConnected);
  const setEncryptedPassword = useLemonGridStore((state) => state.setEncryptedPassword);
  const setRememberMe = useLemonGridStore((state) => state.setRememberMe);

  const [inputServerUrl, setInputServerUrl] = useState('');
  const [inputUsername, setInputUsername] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [inputRememberMe, setInputRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginView, setLoginView] = useState<'password' | 'dingtalk'>('password');
  const authProvider = useLemonGridStore((state) => state.authProvider);
  const tokenExpiresAt = useLemonGridStore((state) => state.tokenExpiresAt);

  // Pre-fill from stored values on mount
  useEffect(() => {
    if (isOpen) {
      setInputServerUrl(serverUrl || '');
      setInputUsername(storedUsername || '');
      setInputPassword('');
      setInputRememberMe(false);
      setError(null);
      setIsLoading(false);

      // Per D-14: If authProvider is dingtalk and token is expired, show QR view directly
      const isTokenValid = tokenExpiresAt && tokenExpiresAt > Date.now() + 120000;
      if (authProvider === 'dingtalk' && !isTokenValid) {
        setLoginView('dingtalk');
      } else {
        setLoginView('password');
      }
    }
  }, [isOpen, serverUrl, storedUsername, authProvider, tokenExpiresAt]);

  // Normalize URL: auto-prepend http:// for bare IP/hostname
  const normalizeUrl = (raw: string): string => {
    const url = raw.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}/.test(url) || /^localhost/i.test(url) || /^[a-z][\w-]*$/i.test(url)) {
      return 'http://' + url;
    }
    return url;
  };

  // Validate inputs per D-83
  const validateInputs = (): string | null => {
    if (!inputServerUrl.trim()) {
      return '请输入服务器地址';
    }
    const url = normalizeUrl(inputServerUrl);
    if (!/^https?:\/\/.+/.test(url)) {
      return '无效的服务器地址';
    }
    if (!inputUsername.trim()) {
      return '请输入用户名';
    }
    if (!inputPassword) {
      return '请输入密码';
    }
    return null;
  };

  const handleDingTalkClick = async () => {
    const url = normalizeUrl(inputServerUrl || serverUrl || '');
    if (!url) {
      setError('请先输入服务器地址');
      return;
    }

    if (!isUXPWebView()) {
      // Per D-20, D-21: Browser mode uses standard redirect OAuth
      try {
        const { auth_url } = await getDingTalkLoginUrl(url, 'redirect');
        window.location.href = auth_url;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError('钉钉登录失败: ' + message);
      }
      return;
    }

    // UXP mode: switch to QR code view per D-07
    setLoginView('dingtalk');
    setError(null);
  };

  const handleClose = () => {
    setLoginView('password');
    onClose();
  };

  const handleDingTalkSuccess = () => {
    setConnected(true);
    onLoginSuccess();
  };

  const handleSubmit = async () => {
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use normalized URL (with protocol) for all API calls
      const url = normalizeUrl(inputServerUrl);
      // Also update input state so user sees the corrected URL
      setInputServerUrl(url);

      // Login per D-85
      const loginResult = await loginToLemonGrid(url, inputUsername.trim(), inputPassword);

      // Store auth in lemongridStore
      setAuth({
        accessToken: loginResult.access_token,
        expiresIn: loginResult.expires_in,
        username: loginResult.user.username,
        role: loginResult.user.role,
      });

      // Update server URL
      setServerUrl(url);

      // Handle Remember Me per D-77
      if (inputRememberMe) {
        setRememberMe(true);
        try {
          const encrypted = await encryptPassword(inputPassword);
          setEncryptedPassword(encrypted);
        } catch {
          // Encryption failed - Remember Me won't work, but login succeeds
          console.warn('[LoginModal] Failed to encrypt password for Remember Me');
          setEncryptedPassword(null);
        }
      } else {
        setRememberMe(false);
        setEncryptedPassword(null);
      }

      // Sync auth to Bridge so main.js handlers can inject JWT
      await syncAuthToBridge();

      // Fetch user profile per D-91
      try {
        await getUserProfile(url, loginResult.access_token);
      } catch {
        // Profile fetch failure should not block login
      }

      setConnected(true);
      onLoginSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Error messages per D-84
      if (message === 'AUTH_INVALID_CREDENTIALS') {
        setError('用户名或密码错误');
      } else if (
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('fetch') ||
        message.includes('Bridge')
      ) {
        setError('无法连接服务器，请检查网络');
      } else if (message.includes('timeout') || message.includes('Timeout')) {
        setError('连接超时，请检查网络');
      } else {
        setError('登录失败: ' + message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  if (!isOpen) return null;

  const isSubmitDisabled = isLoading || !inputServerUrl.trim() || !inputUsername.trim() || !inputPassword;

  return (
    <div className="login-modal-overlay" onClick={handleClose}>
      <div className="login-modal-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2 className="login-modal-title">LemonGrid 登录</h2>

        {loginView === 'password' && (
        <div className="login-modal-form">
          <div className="form-group">
            <label htmlFor="lg-server-url">服务器地址</label>
            <input
              id="lg-server-url"
              type="text"
              value={inputServerUrl}
              onChange={(e) => setInputServerUrl(e.target.value)}
              placeholder="192.168.0.105 或 https://lemongrid.example.com"
              className="text-input"
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="lg-username">用户名</label>
            <input
              id="lg-username"
              type="text"
              value={inputUsername}
              onChange={(e) => setInputUsername(e.target.value)}
              placeholder="请输入用户名"
              className="text-input"
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="lg-password">密码</label>
            <input
              id="lg-password"
              type="password"
              value={inputPassword}
              onChange={(e) => setInputPassword(e.target.value)}
              placeholder="请输入密码"
              className="text-input"
              disabled={isLoading}
            />
          </div>

          <div className="form-group remember-me-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={inputRememberMe}
                onChange={(e) => setInputRememberMe(e.target.checked)}
                disabled={isLoading}
              />
              <span>记住密码</span>
            </label>
          </div>

          {error && (
            <div className="login-modal-error">
              {error}
            </div>
          )}

          <div className="login-modal-actions">
            <button
              className="login-modal-btn login-btn"
              onClick={handleSubmit}
              disabled={isSubmitDisabled}
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
            <button
              className="login-modal-btn cancel-btn"
              onClick={handleClose}
              disabled={isLoading}
            >
              取消
            </button>
          </div>

          <div className="dingtalk-divider">
            <span>或</span>
          </div>
          <button
            className="dingtalk-btn"
            onClick={handleDingTalkClick}
            disabled={isLoading}
            type="button"
          >
            <svg className="dingtalk-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm-2-8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
            </svg>
            钉钉扫码登录
          </button>
        </div>
        )}

        {loginView === 'dingtalk' && (
          <div className="dingtalk-qrcode-view">
            <a
              className="dingtalk-back-link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setLoginView('password');
              }}
            >
              返回密码登录
            </a>
            <DingTalkQRView
              serverUrl={normalizeUrl(inputServerUrl || serverUrl || '')}
              onSuccess={handleDingTalkSuccess}
              onError={(err) => {
                // Errors are displayed inside DingTalkQRView per D-29
                // This callback is for logging only
                console.warn('[LoginModal] DingTalk auth error:', err);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
