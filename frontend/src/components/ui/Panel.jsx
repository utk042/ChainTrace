import Icon from '../Icon';

/**
 * A framed region with a fixed header and a scrolling body — the unit every
 * Gotham workspace is assembled from.
 *
 * The body is the only part that scrolls, so a header never drifts out of
 * view and a long table never widens the page.
 */
export default function Panel({
  icon, title, meta, actions, children,
  pad = false, className = '', bodyClassName = '', style,
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || actions) && (
        <header className="panel-header">
          <span className="panel-title">
            {icon && <Icon name={icon} size={13} />}
            {title}
          </span>
          {meta && <span className="panel-meta">{meta}</span>}
          {actions && <span className="panel-header-actions">{actions}</span>}
        </header>
      )}
      <div className={`panel-body${pad ? ' pad' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** A titled band inside a panel body: "OBJECT TYPES", "PROPERTY VALUES". */
export function SectionLabel({ children, count }) {
  return (
    <div className="section-label">
      <span className="truncate">{children}</span>
      {count !== undefined && <span className="section-label-count">{count}</span>}
    </div>
  );
}
