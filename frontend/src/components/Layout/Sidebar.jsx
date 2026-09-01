import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/', label: 'Dashboard', key: 'D', end: true },
  { path: '/alerts', label: 'Alerts', key: 'A' },
  { path: '/wallets', label: 'Wallets', key: 'W' },
  { path: '/graph', label: 'Graph', key: 'G' },
  { path: '/transactions', label: 'Txns', key: 'T' },
  { path: '/ingest', label: 'Ingest', key: 'I' },
];

const bottomItems = [
  { path: '/settings', label: 'Settings', key: 'S' },
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
            <span className="nav-key">{item.key}</span>
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
            <span className="nav-key">{item.key}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
