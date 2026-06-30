import { Component, useEffect, type ReactNode } from 'react';
import { BrowserRouter as Router, NavLink, useLocation } from 'react-router-dom';
import './App.css';
import { Settings } from './pages/Settings';
import { Draw } from './pages/Draw';
import { History } from './pages/History';
import { PromptReverseProvider } from './components/promptReverse/PromptReverseProvider';
import { TopbarQueueBadge } from './components/TopbarQueueBadge';
import { LoginModal } from './components/LoginModal';
import { validateStoredAuth, loadAuthFromBridge } from './services/lemongrid-auth';
import { pickWorkingUrl, setUserProvidedUrl } from './services/lemongrid-url';
import { useLemonGridStore } from './stores/lemongridStore';
import { LEMONGRID_PRIMARY_URL } from './services/lemongrid-url';

// SVG icons — 20×20, stroke-based
const DrawIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>
  </svg>
);
const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

const navItems = [
  { to: '/draw', label: '绘图', icon: <DrawIcon /> },
  { to: '/history', label: '历史', icon: <HistoryIcon /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: 'var(--danger)', background: 'var(--bg)', height: '100%', overflow: 'auto' }}>
          <h3 style={{ margin: '0 0 8px' }}>渲染错误</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--fg2)' }}>
            {this.state.error.message}
          </pre>
          <button
            style={{ marginTop: 8, padding: '4px 12px', cursor: 'pointer' }}
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Keep-alive page container.
 * All three pages (Draw / History / Settings) stay mounted, only the active one is visible.
 * This preserves Draw page state (uploaded images, prompts, generation progress) across
 * tab switches — switching to History/Settings and back no longer remounts Draw.
 */
const KeepAlivePages = () => {
  const location = useLocation();
  const path = location.pathname === '/' ? '/draw' : location.pathname;

  const pageStyle = (active: boolean): React.CSSProperties => ({
    display: active ? 'block' : 'none',
    height: '100%',
    minHeight: 0,
  });

  return (
    <>
      <div style={pageStyle(path === '/draw')}><Draw /></div>
      <div style={pageStyle(path === '/history')}><History /></div>
      <div style={pageStyle(path === '/settings')}><Settings /></div>
    </>
  );
};

/**
 * Global auth guard — component-level (per agreed design).
 *
 * - Mounts LoginModal at the top of the React tree so every page (Draw / History / Settings)
 *   is covered uniformly. No need for per-page <LoginModal /> instances anymore.
 * - When `isConnected` becomes false (initial state, logout, or token expiry caught by the
 *   global 401 interceptor in lemongridFetch), the modal opens in `force` mode so the user
 *   cannot dismiss it without logging in.
 * - Login success closes the modal; navigation to /draw is handled by callers (e.g. Settings
 *   logout button) — this component does not redirect.
 */
const AuthGuard = () => {
  const isConnected = useLemonGridStore((s) => s.isConnected);
  const showLoginModal = useLemonGridStore((s) => s.showLoginModal);
  const setShowLoginModal = useLemonGridStore((s) => s.setShowLoginModal);
  const isAuthReady = useLemonGridStore((s) => s.isAuthReady);

  // Whenever we lose connection, force the login modal open. This covers:
  //   1. App boot with no stored token → isConnected=false on first render.
  //   2. Boot with expired token → validateStoredAuth() sets isConnected=false.
  //   3. Logout from Settings → clearAuth() flips isConnected to false.
  //   4. Token expiry caught by the 401 interceptor in lemongridFetch.
  //
  // Gate on `isAuthReady` so the very first paint doesn't pop the modal
  // before the async token restore (loadAuthFromBridge + validateStoredAuth)
  // has had a chance to run. Without this, the modal would open in force
  // mode and lock the user out even though their session was about to be
  // restored silently.
  useEffect(() => {
    if (!isAuthReady) return;
    if (!isConnected && !showLoginModal) {
      setShowLoginModal(true);
    }
  }, [isAuthReady, isConnected, showLoginModal, setShowLoginModal]);

  // force=true whenever we are NOT connected AND boot has finished. During
  // the boot window (isAuthReady=false) we still want to render the modal
  // if some other code path opens it, but in non-forced form so the user
  // isn't locked out by a transient disconnect during token restore.
  return (
    <LoginModal
      isOpen={showLoginModal}
      force={isAuthReady && !isConnected}
      onClose={() => {
        // Only reachable when not forced (i.e. manually opened for some reason). When forced,
        // LoginModal intercepts all close paths itself.
        if (isConnected) {
          setShowLoginModal(false);
        }
      }}
      onLoginSuccess={() => {
        setShowLoginModal(false);
      }}
    />
  );
};

function App() {
  // Validate stored auth tokens on startup — refresh if needed
  useEffect(() => {
    // Sync the user-provided server URL (if any) into the failover module
    // BEFORE pickWorkingUrl runs, so the user URL is at the top of the
    // candidate list when we start probing.
    const customUrl = useLemonGridStore.getState().customServerUrl;
    setUserProvidedUrl(customUrl);

    // Probe candidates (user-provided → primary → fallback) and lock the
    // first reachable one. Sets the store's serverUrl so UI immediately
    // reflects the active server. Silent on success; non-fatal on failure.
    (async () => {
      const working = await pickWorkingUrl();
      if (working) {
        useLemonGridStore.getState().setServerUrl(working);
      } else {
        // None reachable — default to primary so login modal has a target.
        useLemonGridStore.getState().setServerUrl(LEMONGRID_PRIMARY_URL);
      }
    })().catch(() => { /* probe failure is non-fatal */ });

    // Restore auth tokens from the Bridge FIRST. The UXP main.js persists
    // tokens to its data folder so they survive PS restarts; without this
    // step, `validateStoredAuth` would see an empty store on every PS boot
    // and bounce the user to the login modal.
    //
    // Chain loadAuthFromBridge → validateStoredAuth so the validation
    // picks up the freshly-restored tokens and either marks the user
    // connected (if still valid) or triggers a silent refresh.
    //
    // The `finally` block flips `isAuthReady` to true so AuthGuard only
    // starts enforcing the "disconnected → show login modal" rule after
    // restoration has had a chance to run. Without this gate, AuthGuard
    // would see `isConnected=false` on first paint and pop the login modal
    // before the async restore completes — and the modal can't be dismissed
    // in `force` mode, so the user gets logged out even though their token
    // was about to be restored.
    loadAuthFromBridge()
      .then(() => validateStoredAuth())
      .catch(() => { /* any failure is non-fatal; AuthGuard handles it */ })
      .finally(() => {
        useLemonGridStore.getState().setAuthReady(true);
      });
  }, []);

  return (
    <Router>
      <div className="app">
        {/* Minimal topbar — brand + always-on queue badge */}
        <div className="topbar">
          <div className="topbar-brand">Lemon<span>Grid</span></div>
          <TopbarQueueBadge />
        </div>

        {/* Main content area */}
        <main className="content">
          <ErrorBoundary>
            <PromptReverseProvider>
              <KeepAlivePages />
            </PromptReverseProvider>
          </ErrorBoundary>
        </main>

        {/* Bottom tab bar — saves vertical space for PS panel */}
        <nav className="tabbar">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `tab-item ${isActive ? 'tab-active' : ''}`}
            >
              <span className="tab-icon">{item.icon}</span>
              <span className="tab-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Global auth guard — covers all pages uniformly. LoginModal uses fixed
            positioning with z-index 1500, so DOM order doesn't matter for stacking. */}
        <AuthGuard />
      </div>
    </Router>
  );
}

export default App;
