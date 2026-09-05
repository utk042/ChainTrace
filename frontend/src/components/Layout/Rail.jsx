import { NavLink } from 'react-router-dom';
import Icon from '../Icon';
import { useSession } from '../../state/SessionProvider';
import { VIEWS } from '../../state/views';

/**
 * The application rail down the left edge — one icon per view, the way the
 * Gotham workstation stacks its applications.
 *
 * The alert icon carries a live count, because the number of open findings
 * is the one thing worth interrupting whatever else is on screen.
 */
export default function Rail() {
  const { stats } = useSession();

  const badgeFor = (view) => {
    if (view.badge !== 'alerts') return null;
    const count = stats?.total_alerts;
    if (!count) return null;
    return count > 99 ? '99+' : String(count);
  };

  const main = VIEWS.filter((v) => v.key !== 'settings');
  const settings = VIEWS.find((v) => v.key === 'settings');

  const item = (view) => {
    const badge = badgeFor(view);
    return (
      <NavLink
        key={view.key}
        to={view.path}
        end={view.path === '/'}
        className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`}
        aria-label={view.label}
      >
        <Icon name={view.icon} size={15} />
        {badge && <span className="rail-badge" aria-hidden="true">{badge}</span>}
        <span className="rail-tip">
          {view.label}
          {badge && ` · ${badge}`}
        </span>
      </NavLink>
    );
  };

  return (
    <nav className="rail" aria-label="Applications">
      {main.map(item)}
      <span className="rail-spacer" />
      {settings && item(settings)}
    </nav>
  );
}
