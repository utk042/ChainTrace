import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '◈' },
  { path: '/alerts', label: 'Alerts', icon: '⚠' },
  { path: '/graph', label: 'Graph Explorer', icon: '◎' },
  { path: '/wallets', label: 'Wallets', icon: '◆' },
  { path: '/transactions', label: 'Transactions', icon: '⇄' },
  { path: '/ingest', label: 'Ingest', icon: '↓' },
];

const bottomItems = [
  { path: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Sidebar({ isOpen, onClose }) {
  return (
    <aside className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>CHAINTRACE</h1>
            <div className="brand-sub">Forensics v1.0</div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {bottomItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
