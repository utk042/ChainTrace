import { useState } from 'react';
import Icon from '../Icon';

/** A disclosure section with a count badge, as used down the detail panes. */
export default function Collapse({ title, count, defaultOpen = true, children, icon }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapse-section">
      <button type="button" className="collapse-head" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
        {icon && <Icon name={icon} size={12} />}
        <span>{title}</span>
        {count !== undefined && count !== null && <span className="collapse-count">{count}</span>}
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  );
}
