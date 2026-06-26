import { useState, useEffect } from 'react';
import { useLemonGridStore } from '../stores/lemongridStore';
import { loginToLemonGrid, getUserProfile, syncAuthToBridge, encryptPassword, decryptPassword, getDingTalkLoginUrl } from '../services/lemongrid-auth';
import { DingTalkQRView } from './DingTalkQRView';
import { ServerUrlSettingsModal } from './ServerUrlSettingsModal';
import { isUXPWebView } from '../services/upload';
import './LoginModal.css';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
  /**
   * 强制模式：禁止任何关闭途径（×/ESC/遮罩点击/取消按钮）。
   * 仅在登录成功后才允许关闭。用于插件启动 / token 失效场景。
   */
  force?: boolean;
}

export const LoginModal = ({ isOpen, onClose, onLoginSuccess, force = false }: LoginModalProps) => {
  const serverUrl = useLemonGridStore((state) => state.serverUrl);
  const storedUsername = useLemonGridStore((state) => state.username);
  const storedRememberMe = useLemonGridStore((state) => state.rememberMe);
  const storedEncryptedPassword = useLemonGridStore((state) => state.encryptedPassword);
  const setAuth = useLemonGridStore((state) => state.setAuth);
  const setConnected = useLemonGridStore((state) => state.setConnected);
  const setEncryptedPassword = useLemonGridStore((state) => state.setEncryptedPassword);
  const setRememberMe = useLemonGridStore((state) => state.setRememberMe);

  const [inputUsername, setInputUsername] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [inputRememberMe, setInputRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginView, setLoginView] = useState<'password' | 'dingtalk'>('password');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const authProvider = useLemonGridStore((state) => state.authProvider);
  const tokenExpiresAt = useLemonGridStore((state) => state.tokenExpiresAt);

  // Normalize URL: auto-prepend http:// for bare IP/hostname
  const normalizeUrl = (raw: string): string => {
    const url = raw.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}/.test(url) || /^localhost/i.test(url) || /^[a-z][\w-]*$/i.test(url)) {
      return 'http://' + url;
    }
    return url;
  };

  // 集群服务器地址由后台注入到 store，这里取标准化后的值用于 API 调用
  const effectiveServerUrl = normalizeUrl(serverUrl);

  // Pre-fill from stored values on mount / when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    setInputUsername(storedUsername || '');
    setInputPassword('');
    // Restore the previous "remember me" state so the checkbox reflects
    // what was persisted. Hard-coding false here would overwrite the
    // persisted rememberMe/encryptedPassword on the next login submit
    // (because handleSubmit calls setRememberMe(false) + setEncryptedPassword(null)
    // when inputRememberMe is false).
    setInputRememberMe(storedRememberMe);
    setError(null);
    setIsLoading(false);

    // If a password was previously saved ("记住密码" + encryptedPassword present),
    // decrypt it and pre-fill the input so the user can just click "登录".
    // If decryption fails (e.g. the encryption key rotated, or the payload is
    // corrupted by a bad store migration), drop the checkbox too so we don't
    // leave the UI in a state where rememberMe=true but encryptedPassword is
    // un-decryptable.
    if (storedRememberMe && storedEncryptedPassword) {
      decryptPassword(storedEncryptedPassword)
        .then((pwd) => {
          if (!cancelled) setInputPassword(pwd);
        })
        .catch((err) => {
          console.warn('[LoginModal] Failed to decrypt stored password:', err);
          if (!cancelled) setInputRememberMe(false);
        });
    }

    // Per D-14: If authProvider is dingtalk and token is expired, show QR view directly
    const isTokenValid = tokenExpiresAt && tokenExpiresAt > Date.now() + 120000;
    if (authProvider === 'dingtalk' && !isTokenValid) {
      setLoginView('dingtalk');
    } else {
      setLoginView('password');
    }

    return () => { cancelled = true; };
  }, [isOpen, storedUsername, storedRememberMe, storedEncryptedPassword, authProvider, tokenExpiresAt]);

  // Validate inputs per D-83
  const validateInputs = (): string | null => {
    if (!effectiveServerUrl || !/^https?:\/\/.+/.test(effectiveServerUrl)) {
      return '集群服务器地址未配置，请联系管理员';
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
    const url = effectiveServerUrl;
    if (!url || !/^https?:\/\/.+/.test(url)) {
      setError('集群服务器地址未配置，请联系管理员');
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
    // 强制模式下：禁止关闭，仅重置视图状态以便重新输入
    if (force) {
      setLoginView('password');
      return;
    }
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
      const url = effectiveServerUrl;

      // Login per D-85
      const loginResult = await loginToLemonGrid(url, inputUsername.trim(), inputPassword);

      // Store auth in lemongridStore
      setAuth({
        accessToken: loginResult.access_token,
        expiresIn: loginResult.expires_in,
        username: loginResult.user.username,
        role: loginResult.user.role,
      });

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
      // 强制模式下吞掉 ESC，避免误关弹窗
      if (force) {
        e.stopPropagation();
        return;
      }
      handleClose();
    }
  };

  if (!isOpen) return null;

  const isSubmitDisabled = isLoading || !effectiveServerUrl || !inputUsername.trim() || !inputPassword;

  return (
    <div
      className="login-modal-overlay"
      onClick={(e) => {
        // 强制模式下禁用遮罩点击关闭，且阻止冒泡避免触发路由/外层组件
        if (force) {
          e.stopPropagation();
          return;
        }
        handleClose();
      }}
    >
      <div className="login-modal-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h2 className="login-modal-title">
          LemonGrid 登录
          {/* Top-right settings button — opens the ServerUrlSettingsModal
              for manually configuring the server URL override. Only shown
              on the password view. */}
          {loginView === 'password' && (
            <button
              type="button"
              className="login-modal-settings-btn"
              onClick={() => setShowServerSettings(true)}
              aria-label="服务器地址设置"
            >
              设置
            </button>
          )}
          {/* DingTalk QR view needs a close affordance to switch back to the
              password view. Force mode just resets the view; non-force closes
              the entire modal. */}
          {loginView === 'dingtalk' && (
            <button
              type="button"
              className="login-modal-close-btn"
              onClick={() => {
                if (force) {
                  setLoginView('password');
                } else {
                  handleClose();
                }
              }}
              aria-label={force ? '返回密码登录' : '关闭'}
            >
              ×
            </button>
          )}
        </h2>

        {loginView === 'password' && (
        <div className="login-modal-form">
          <div className="form-group">
            <label htmlFor="lg-username">账号</label>
            <input
              id="lg-username"
              type="text"
              value={inputUsername}
              onChange={(e) => setInputUsername(e.target.value)}
              placeholder="请输入账号"
              className="text-input"
              disabled={isLoading}
              autoFocus
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
            {!force && (
              <button
                className="login-modal-btn cancel-btn"
                onClick={handleClose}
                disabled={isLoading}
              >
                取消
              </button>
            )}
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
            <DingTalkQRView
              serverUrl={effectiveServerUrl}
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

      {/* Server URL override dialog — opens from the title-bar "设置" button.
          Renders at z-index 1600 (above this modal's 1500) so users can edit
          the server URL even when this modal is forced open (token-expired /
          first-boot scenarios). Closing it returns the user to this modal so
          they can resume logging in. */}
      <ServerUrlSettingsModal
        isOpen={showServerSettings}
        onClose={() => setShowServerSettings(false)}
      />
    </div>
  );
};
