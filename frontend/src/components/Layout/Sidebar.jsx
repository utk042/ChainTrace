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

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-mark" title="ChainTrace Forensics">CT</div>

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
      </div>
    </aside>
  );
}
