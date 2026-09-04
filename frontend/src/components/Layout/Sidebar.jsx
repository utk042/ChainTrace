import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import Icon from '../Icon';

const navItems = [
  { path: '/', label: 'Dashboard', icon: 'grid', end: true },
  { path: '/alerts', label: 'Alerts', icon: 'alertTriangle' },
  { path: '/wallets', label: 'Wallets', icon: 'wallet' },
  { path: '/graph', label: 'Graph', icon: 'graph' },
  { path: '/transactions', label: 'Txns', icon: 'swap' },
  { path: '/ingest', label: 'Ingest', icon: 'uploadCloud' },
];

const bottomItems = [
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

const STORAGE_KEY = 'ct-sidebar-collapsed';

function getInitialCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-mark" title="ChainTrace">CT</div>
        <div className="sidebar-wordmark">
          <strong>ChainTrace</strong>
        </div>
      </div>

      <button
        type="button"
        className="sidebar-search"
        onClick={() => window.dispatchEvent(new CustomEvent('ct:open-command-palette'))}
        title="Search"
      >
        <Icon name="search" size={15} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title={item.label}
          >
            <Icon name={item.icon} size={17} />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {bottomItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title={item.label}
          >
            <Icon name={item.icon} size={17} />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name="chevronLeft" size={15} />
          <span>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
