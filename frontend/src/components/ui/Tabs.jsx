/**
 * The tab strip Gotham puts under an object header: a label, an optional
 * count badge, and an underline on the active one.
 *
 * `tabs` entries are `{ key, label, count?, disabled? }`. The strip scrolls
 * horizontally rather than wrapping onto a second row, so the panel below it
 * never shifts down when a tab is added.
 */
export default function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          disabled={tab.disabled}
          className={`tab${active === tab.key ? ' active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && (
            <span className="tab-count">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
