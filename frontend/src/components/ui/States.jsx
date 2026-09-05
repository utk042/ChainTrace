import Icon from '../Icon';

/**
 * The three things a pane can be showing instead of data, kept in one place
 * so they never blur into each other.
 *
 * A forensic tool must not let "the request failed" render the same as
 * "there is nothing here" — a blank table reads as a finding. `Failed`
 * always names what could not be loaded; `Empty` says only that the query
 * matched nothing.
 */

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-spinner">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ icon = 'search', title, children, actions }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={24} />
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

export function Failed({ title = 'Could not load', children, actions }) {
  return (
    <div className="empty-state">
      <Icon name="alertTriangle" size={24} style={{ color: 'var(--risk-critical)' }} />
      <h3 style={{ color: 'var(--risk-critical)' }}>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', icon, children, actions }) {
  const defaultIcon = { warn: 'alertTriangle', error: 'alertTriangle', ok: 'check', info: 'info' }[kind];
  return (
    <div className={`notice ${kind}`}>
      <Icon name={icon || defaultIcon} size={13} />
      <span className="grow">{children}</span>
      {actions && <span className="notice-actions">{actions}</span>}
    </div>
  );
}
