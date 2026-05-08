import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useLemonGridStore } from '../stores/lemongridStore';
import { ComfyUIClient, type ComfyUICapabilities } from '../services/comfyui';
import { DASHSCOPE_MODELS } from '../services/dashscope';
import { sendBridgeMessage } from '../services/upload';
import { ensureValidToken } from '../services/lemongrid-auth';
import { LoginModal } from '../components/LoginModal';
import './Settings.css';

export const Settings = () => {
  const comfyUI = useSettingsStore((state) => state.comfyUI);
  const setComfyUIBaseUrl = useSettingsStore((state) => state.setComfyUIBaseUrl);
  const setComfyUIConnected = useSettingsStore((state) => state.setComfyUIConnected);

  const dashScope = useSettingsStore((state) => state.dashScope);
  const setDashScopeApiKey = useSettingsStore((state) => state.setDashScopeApiKey);
  const setDashScopeModel = useSettingsStore((state) => state.setDashScopeModel);

  const connectionMode = useSettingsStore((state) => state.connectionMode);
  const setConnectionMode = useSettingsStore((state) => state.setConnectionMode);

  const lgIsConnected = useLemonGridStore((state) => state.isConnected);
  const lgServerUrl = useLemonGridStore((state) => state.serverUrl);
  const lgUsername = useLemonGridStore((state) => state.username);
  const lgUserRole = useLemonGridStore((state) => state.userRole);
  const lgAuthProvider = useLemonGridStore((state) => state.authProvider);
  const lgSetServerUrl = useLemonGridStore((state) => state.setServerUrl);
  const lgClearAuth = useLemonGridStore((state) => state.clearAuth);
  const lgSetConnected = useLemonGridStore((state) => state.setConnected);
  const showLoginModal = useLemonGridStore((state) => state.showLoginModal);
  const setShowLoginModal = useLemonGridStore((state) => state.setShowLoginModal);
  const lgTasks = useLemonGridStore((state) => state.tasks);

  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<ComfyUICapabilities | null>(null);

  // Connection status indicator
  const getConnectionStatus = () => {
    if (isProbing) return { text: '连接中...', class: 'connecting' };
    if (!comfyUI.isConnected) return { text: '未连接', class: 'disconnected' };
    return { text: '已连接', class: 'connected' };
  };

  const connectionStatus = getConnectionStatus();

  // Probe connection on mount if we have a saved URL
  useEffect(() => {
    if (connectionMode === 'direct' && comfyUI.baseUrl && comfyUI.isConnected) {
      handleProbeConnection();
    }
  }, []);

  const handleProbeConnection = useCallback(async () => {
    setIsProbing(true);
    setProbeError(null);
    setProbeResult(null);

    try {
      const client = new ComfyUIClient({ baseUrl: comfyUI.baseUrl });
      const capabilities = await client.probeEndpoints();
      setProbeResult(capabilities);

      const successCount = Object.values(capabilities.endpoints).filter(
        (e) => e.status !== 'failed'
      ).length;

      const canGenerate = capabilities.endpoints.prompt?.status !== 'failed';
      const canUpload = capabilities.endpoints.uploadImage?.status !== 'failed';
      const canListWorkflows = capabilities.endpoints.workflowList?.status !== 'failed';
      const canReadWorkflows = capabilities.endpoints.workflowRead?.status !== 'failed';

      setComfyUIConnected(
        successCount > 0,
        capabilities.prefixMode === 'api' ? 'api' : 'oss',
        {
          canGenerate,
          canUpload,
          canListWorkflows,
          canReadWorkflows,
        }
      );

      if (successCount === 0) {
        // 检查是否有 CORS 错误
        const endpoints = Object.values(capabilities.endpoints);
        const corsErrors = endpoints.filter(e => e.error?.type === 'cors');
        const timeoutErrors = endpoints.filter(e => e.error?.type === 'timeout');
        const networkErrors = endpoints.filter(e => e.error?.type === 'network');

        if (corsErrors.length > 0) {
          setProbeError('检测到跨域限制。若在 Photoshop 插件面板中，系统会自动走 Bridge 代理；若在普通浏览器调试，请为 ComfyUI 开启 CORS。');
        } else if (timeoutErrors.length > 0) {
          setProbeError('连接超时。请检查 ComfyUI 是否正在运行。');
        } else if (networkErrors.length > 0) {
          setProbeError('网络错误。请检查 IP 地址和端口是否正确。');
        } else {
          setProbeError('无法连接到ComfyUI服务器。请检查URL是否正确。');
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setProbeError(`连接失败: ${errorMsg}`);
      setComfyUIConnected(false);
    } finally {
      setIsProbing(false);
    }
  }, [comfyUI.baseUrl, setComfyUIConnected]);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setComfyUIBaseUrl(e.target.value);
  };

  // Mode change handler per D-48, D-46, D-75
  const handleModeChange = async (mode: 'direct' | 'cluster') => {
    if (mode === connectionMode) return;

    // D-48: Block mode switching while LemonGrid tasks are running
    if (mode === 'direct') {
      const tasks = Object.values(useLemonGridStore.getState().tasks);
      const runningTasks = tasks.filter(t =>
        ['PENDING', 'QUEUED', 'SYNCING', 'RUNNING'].includes(t.status));
      if (runningTasks.length > 0) {
        alert('有正在运行的集群任务，请等待完成后再切换模式');
        return;
      }
    }

    setConnectionMode(mode);

    if (mode === 'cluster') {
      // D-75: Auto-open login modal if not authenticated
      const lg = useLemonGridStore.getState();
      if (!lg.isConnected || !lg.accessToken) {
        setShowLoginModal(true);
      } else {
        // D-73: Try silent token validation
        try {
          await ensureValidToken();
        } catch {
          setShowLoginModal(true);
        }
      }
    }
  };

  // Logout handler per D-76, D-87
  const handleLogout = async () => {
    // D-87: Cancel all running cluster tasks first (warn user)
    const tasks = Object.values(lgTasks);
    const runningTasks = tasks.filter(t =>
      ['PENDING', 'QUEUED', 'SYNCING', 'RUNNING'].includes(t.status));

    if (runningTasks.length > 0) {
      const confirmed = window.confirm(`有 ${runningTasks.length} 个正在运行的集群任务，确定要登出吗？`);
      if (!confirmed) return;
    }

    // Clear auth but keep serverUrl and username per D-76
    lgClearAuth();

    // Clear Bridge settings
    try {
      await sendBridgeMessage('settings.set', {
        key: 'lemongrid',
        value: null,
      });
    } catch {
      // Bridge may not be available in browser mode
    }

    lgSetConnected(false);
  };

  // LemonGrid connection status
  const getLgConnectionStatus = () => {
    if (!lgIsConnected) return { text: '未连接', class: 'disconnected' };
    return { text: '已连接', class: 'connected' };
  };

  const lgConnectionStatus = getLgConnectionStatus();

  return (
    <div className="settings-page">
      <h1 className="settings-title">设置</h1>

      <div className="settings-grid">
        {/* Mode Toggle - per D-93, D-94 */}
        <div className="settings-card mode-toggle">
          <h2>连接模式</h2>
          <div className="mode-toggle-group">
            <label className="mode-option">
              <input
                type="radio"
                name="connectionMode"
                value="direct"
                checked={connectionMode === 'direct'}
                onChange={() => handleModeChange('direct')}
              />
              <span>直连 (ComfyUI)</span>
            </label>
            <label className="mode-option">
              <input
                type="radio"
                name="connectionMode"
                value="cluster"
                checked={connectionMode === 'cluster'}
                onChange={() => handleModeChange('cluster')}
              />
              <span>集群 (LemonGrid)</span>
            </label>
          </div>
        </div>

        {/* ComfyUI Connection Column - per D-94: visible only in direct mode */}
        {connectionMode === 'direct' && (
          <div className="settings-card comfy-connection">
            <div className="card-header">
              <h2>ComfyUI 连接</h2>
              <span className={`connection-status ${connectionStatus.class}`}>
                {connectionStatus.text}
              </span>
            </div>

            <div className="connection-form">
              <div className="form-group">
                <label htmlFor="comfy-url">服务器地址</label>
                <input
                  id="comfy-url"
                  type="text"
                  value={comfyUI.baseUrl}
                  onChange={handleUrlChange}
                  placeholder="http://localhost:8188"
                  className="text-input"
                />
              </div>

              <button
                onClick={handleProbeConnection}
                disabled={isProbing}
                className="test-connection-btn"
              >
                {isProbing ? '连接中...' : '测试连接'}
              </button>
            </div>

            {probeError && (
              <div className="error-message">
                <span className="error-icon">⚠</span>
                {probeError}
              </div>
            )}

            {/* CORS Help Accordion */}
            <div className="cors-help-section">
              <details className="cors-accordion">
                <summary className="cors-accordion-header">
                  <span className="cors-icon">🔒</span>
                  CORS 配置帮助
                </summary>
                <div className="cors-accordion-content">
                  <p>此应用在浏览器/webview中运行，需要ComfyUI服务器返回 <code>Access-Control-Allow-Origin</code> 头。</p>
                  <h4>启动 ComfyUI 时添加以下参数：</h4>
                  <code className="cors-command">python main.py --enable-cors-header "*"</code>
                  <p className="cors-note">或者限制特定来源: <code>--enable-cors-header "http://192.168.0.50:3000"</code></p>
                </div>
              </details>
            </div>
          </div>
        )}

        {/* LemonGrid Connection Column - per D-94: visible only in cluster mode */}
        {connectionMode === 'cluster' && (
          <div className="settings-card lemongrid-connection">
            <div className="card-header">
              <h2>LemonGrid 连接</h2>
              <span className={`connection-status ${lgConnectionStatus.class}`}>
                {lgConnectionStatus.text}
              </span>
            </div>

            <div className="connection-form">
              <div className="form-group">
                <label htmlFor="lg-url">服务器地址</label>
                <input
                  id="lg-url"
                  type="text"
                  value={lgServerUrl}
                  onChange={(e) => lgSetServerUrl(e.target.value)}
                  placeholder="https://lemongrid.example.com"
                  className="text-input"
                />
              </div>

              {!lgIsConnected ? (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="test-connection-btn"
                >
                  登录
                </button>
              ) : (
                <div className="lg-account-info">
                  <div className="lg-user-info">
                    <span className="lg-username">{lgUsername}</span>
                    {lgUserRole && <span className="lg-role">{lgUserRole}</span>}
                    {lgAuthProvider && (
                      <span className="lg-auth-method">
                        {lgAuthProvider === 'dingtalk' ? '钉钉登录' : '密码登录'}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="lg-logout-btn"
                  >
                    登出
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DashScope Config Column - always visible per D-94 */}
        <div className="settings-card dashscope-config">
          <div className="card-header">
            <h2>提示词反推</h2>
            <span className={`connection-status ${dashScope.apiKey ? 'connected' : 'disconnected'}`}>
              {dashScope.apiKey ? '已配置' : '未配置'}
            </span>
          </div>

          <div className="connection-form">
            <div className="form-group">
              <label htmlFor="dashscope-key">API Key</label>
              <input
                id="dashscope-key"
                type="password"
                value={dashScope.apiKey}
                onChange={(e) => setDashScopeApiKey(e.target.value)}
                placeholder="sk-..."
                className="text-input"
              />
            </div>
            <div className="form-group">
              <label htmlFor="dashscope-model">模型</label>
              <select
                id="dashscope-model"
                value={dashScope.model}
                onChange={(e) => setDashScopeModel(e.target.value)}
                className="text-input"
              >
                {DASHSCOPE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Capabilities Matrix Column - per D-94: visible only in direct mode */}
        {connectionMode === 'direct' && (
          <div className="settings-card capabilities-matrix">
            <h2>能力矩阵</h2>

            {comfyUI.isConnected && probeResult ? (
              <div className="capabilities-list">
                <div className={`capability-item ${probeResult.endpoints.objectInfo?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.objectInfo?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">节点信息</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.workflowList?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.workflowList?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">列出工作流</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.workflowRead?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.workflowRead?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">读取工作流</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.prompt?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.prompt?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">生成图像</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.history?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.history?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">历史记录</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.viewImage?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.viewImage?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">查看图片</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.uploadImage?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.uploadImage?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">上传图片</span>
                </div>
                <div className={`capability-item ${probeResult.endpoints.ws?.status === 'ok' ? 'available' : 'unavailable'}`}>
                  <span className="capability-icon">{probeResult.endpoints.ws?.status === 'ok' ? '✓' : '✗'}</span>
                  <span className="capability-name">WebSocket连接</span>
                </div>
              </div>
            ) : (
              <div className="capabilities-placeholder">
                <span className="placeholder-icon">🔌</span>
                <p>请先连接ComfyUI服务器</p>
              </div>
            )}
          </div>
        )}
      </div>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={() => setShowLoginModal(false)}
      />
    </div>
  );
};
