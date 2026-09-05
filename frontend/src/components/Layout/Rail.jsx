import Icon from '../Icon';
import { useSession } from '../../state/SessionProvider';
import { VIEWS } from '../../state/views';

/**
 * The application rail down the left edge — one icon per view.
 * Clicking switches to an open tab of that view or opens it.
 */
export default function Rail() {
  const { stats, tabs, activeTab, switchTab, openTab } = useSession();

  const badgeFor = (view) => {
    if (view.badge !== 'alerts') return null;
    const count = stats?.total_alerts;
    if (!count) return null;
    return count > 99 ? '99+' : String(count);
  };

  const handleClick = (e, view) => {
    e.preventDefault();
    const existing = tabs.find((t) => t.key === view.key);
    if (existing) {
      switchTab(existing.id);
    } else {
      openTab(view.key);
    }
  };

  const main = VIEWS.filter((v) => v.key !== 'settings');
  const settings = VIEWS.find((v) => v.key === 'settings');

  const item = (view) => {
    const badge = badgeFor(view);
    const isActive = activeTab?.key === view.key;
    return (
      <button
        key={view.key}
        type="button"
        onClick={(e) => handleClick(e, view)}
        className={`rail-item${isActive ? ' active' : ''}`}
        aria-label={view.label}
        title={view.label}
      >
        <span className="rail-item-icon">
          <Icon name={view.icon} size={15} />
          {badge && <span className="rail-badge rail-badge-corner" aria-hidden="true">{badge}</span>}
        </span>
        <span className="rail-item-label">{view.label}</span>
        {badge && <span className="rail-item-badge" aria-hidden="true">{badge}</span>}
      </button>
    );
  };

  return (
    <div className="rail-wrapper">
      <nav className="rail" aria-label="Applications">
        {main.map(item)}
        <span className="rail-spacer" />
        {settings && item(settings)}
      </nav>
    </div>
  );
}
