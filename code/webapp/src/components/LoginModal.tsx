import { useState, useEffect } from 'react';
import { useLemonGridStore } from '../stores/lemongridStore';
import { loginToLemonGrid, getUserProfile, syncAuthToBridge, encryptPassword } from '../services/lemongrid-auth';
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

  // Pre-fill from stored values on mount
  useEffect(() => {
    if (isOpen) {
      setInputServerUrl(serverUrl || '');
      setInputUsername(storedUsername || '');
      setInputPassword('');
      setInputRememberMe(false);
      setError(null);
      setIsLoading(false);
    }
  }, [isOpen, serverUrl, storedUsername]);

  // Validate inputs per D-83
  const validateInputs = (): string | null => {
    if (!inputServerUrl.trim()) {
      return '请输入服务器地址';
    }
    let url = inputServerUrl.trim();
    // Auto-prepend http:// if user omits protocol (common for LAN addresses)
    if (/^\d{1,3}(\.\d{1,3}){3}/.test(url) || /^localhost/i.test(url) || /^[a-z][\w-]*$/i.test(url)) {
      url = 'http://' + url;
      setInputServerUrl(url);
    }
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

  const handleSubmit = async () => {
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = inputServerUrl.trim();

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
      onClose();
    }
  };

  if (!isOpen) return null;

  const isSubmitDisabled = isLoading || !inputServerUrl.trim() || !inputUsername.trim() || !inputPassword;

  return (
    <div className="login-modal-overlay" onClick={onClose}>
      <div className="login-modal-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2 className="login-modal-title">LemonGrid 登录</h2>

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
              onClick={onClose}
              disabled={isLoading}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
