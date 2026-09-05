import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Icon from '../Icon';

/**
 * The dropdown used by the menu bar, the Actions buttons and the table
 * column menus.
 *
 * It positions itself against its trigger and then clamps to the viewport,
 * because the same menu opens from the far right of the title bar and from
 * the middle of a panel — an unclamped popover is how a menu ends up half
 * off-screen with no way to reach its last item.
 */

export function MenuItem({ icon, label, hint, onSelect, disabled, close }) {
  return (
    <button
      type="button"
      className="menu-item"
      disabled={disabled}
      onClick={() => { close?.(); onSelect?.(); }}
    >
      <span className="menu-item-icon">{icon && <Icon name={icon} size={13} />}</span>
      <span className="menu-item-label">{label}</span>
      {hint && <span className="menu-item-hint">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />;
}

export function MenuHeading({ children }) {
  return <div className="menu-heading">{children}</div>;
}

/**
 * `align` picks which edge of the trigger the menu hangs from. `below`
 * anchors under the trigger (menu bar, Actions buttons).
 */
export default function Menu({ trigger, align = 'left', children, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const surfaceRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (surfaceRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    // `true` so a click inside a scroll container still closes the menu.
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  // Measured after paint, so the clamp uses the menu's real size.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !surfaceRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const s = surfaceRef.current.getBoundingClientRect();
    const margin = 6;

    let left = align === 'right' ? a.right - s.width : a.left;
    left = Math.min(left, window.innerWidth - s.width - margin);
    left = Math.max(margin, left);

    let top = a.bottom + 2;
    // Not enough room below: flip above the trigger rather than clip.
    if (top + s.height > window.innerHeight - margin) {
      top = Math.max(margin, a.top - s.height - 2);
    }
    setPos({ left, top });
  }, [open, align]);

  return (
    <>
      <span ref={anchorRef} style={{ display: 'inline-flex', minWidth: 0 }}>
        {trigger({ open, toggle: () => setOpen((v) => !v), close })}
      </span>
      {open && (
        <div
          ref={surfaceRef}
          className={`menu-surface ${className}`}
          role="menu"
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </>
  );
}
