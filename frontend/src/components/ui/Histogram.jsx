import { useState } from 'react';
import Icon from '../Icon';

/**
 * Gotham's summary panel: a collapsible group per facet, one row per value,
 * each row carrying a count and a bar scaled to the largest value in its
 * own group.
 *
 * It is a control, not a chart — clicking a row applies that value as a
 * filter, and the selected row stays lit — so every figure on it comes from
 * the rows actually loaded rather than from anything precomputed.
 */

export function HistogramGroup({ title, total, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="histogram-group">
      <button type="button" className="histogram-group-head" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
        <span className="group-name">{title}</span>
        {total !== undefined && <span className="group-total">{total}</span>}
      </button>
      {open && (children ?? null)}
    </div>
  );
}

export function HistogramRow({ label, color, count, max, selected, onSelect, title }) {
  const pct = max > 0 ? Math.max(2, (count / max) * 100) : 0;
  const Row = onSelect ? 'button' : 'div';
  return (
    <Row
      {...(onSelect ? { type: 'button', onClick: onSelect } : {})}
      className={`histogram-row${selected ? ' selected' : ''}`}
      title={title || `${label}: ${count.toLocaleString()}`}
    >
      <span className="histogram-label">
        {color && <i className="legend-dot" style={{ background: color }} />}
        <span>{label}</span>
      </span>
      <span className="histogram-count">{count.toLocaleString()}</span>
      <span className="histogram-track">
        <span
          className="histogram-fill"
          style={{ width: `${pct}%`, background: color || undefined }}
        />
      </span>
    </Row>
  );
}

/**
 * Convenience wrapper for the common case: one group, rows derived from a
 * `{ label, count, color? }[]`, scaled to the group's own maximum.
 */
export function HistogramFacet({ title, rows, selected, onSelect, emptyNote = 'No values.' }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <HistogramGroup title={title} total={total.toLocaleString()}>
      {rows.length === 0 && <div className="histogram-empty">{emptyNote}</div>}
      {rows.map((row) => (
        <HistogramRow
          key={row.key ?? row.label}
          label={row.label}
          color={row.color}
          count={row.count}
          max={max}
          selected={selected === (row.key ?? row.label)}
          onSelect={onSelect ? () => onSelect(row.key ?? row.label) : undefined}
        />
      ))}
    </HistogramGroup>
  );
}
