import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import './App.css';
import { Settings } from './pages/Settings';
import { Draw } from './pages/Draw';
import { History } from './pages/History';

const navItems = [
  { to: '/draw', label: '绘图', icon: '✨' },
  { to: '/history', label: '历史', icon: '🕘' },
  { to: '/settings', label: '设置', icon: '⚙️' }
];

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
          <Routes>
            <Route path="/draw" element={<Draw />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/" element={<Draw />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
