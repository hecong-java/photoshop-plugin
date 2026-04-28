import { Component, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import './App.css';
import { Settings } from './pages/Settings';
import { Draw } from './pages/Draw';
import { History } from './pages/History';
import { PromptReverseProvider } from './components/promptReverse/PromptReverseProvider';

const navItems = [
  { to: '/draw', label: '绘图', icon: '✨' },
  { to: '/history', label: '历史', icon: '🕘' },
  { to: '/settings', label: '设置', icon: '⚙️' }
];

// ErrorBoundary to catch render errors and show the actual error message
// instead of a black screen
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
        <div style={{ padding: 16, color: '#fc8181', background: '#1a1a2e', height: '100%', overflow: 'auto' }}>
          <h3 style={{ margin: '0 0 8px' }}>渲染错误</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#e0e0e0' }}>
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
  return (
    <Router>
      <div className="app">
        <nav className="navbar">
          <div className="navbar-brand">NingleAI</div>
          <ul className="navbar-nav">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? 'nav-link nav-link-active' : 'nav-link'
                  }
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

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
      </div>
    </Router>
  );
}

export default App;
