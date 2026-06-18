import { Component, useEffect, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import './App.css';
import { Settings } from './pages/Settings';
import { Draw } from './pages/Draw';
import { History } from './pages/History';
import { PromptReverseProvider } from './components/promptReverse/PromptReverseProvider';
import { validateStoredAuth } from './services/lemongrid-auth';

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

function App() {
  // Validate stored auth tokens on startup — refresh if needed
  useEffect(() => {
    validateStoredAuth().catch(() => { /* validation failure is non-fatal */ });
  }, []);

  return (
    <Router>
      <div className="app">
        {/* Minimal topbar — brand + connection status */}
        <div className="topbar">
          <div className="topbar-brand">Lemon<span>Grid</span></div>
          <div className="topbar-mode">
            <span className="topbar-dot" />
          </div>
        </div>

        {/* Main content area */}
        <main className="content">
          <ErrorBoundary>
            <PromptReverseProvider>
              <Routes>
                <Route path="/draw" element={<Draw />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/" element={<Draw />} />
              </Routes>
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
      </div>
    </Router>
  );
}

export default App;
