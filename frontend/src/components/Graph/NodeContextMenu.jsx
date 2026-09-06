import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { shortId } from '../../services/format';

/**
 * The actions for one node, where the pointer already is.
 *
 * Every action here exists in the selection panel too. The panel is on the
 * far side of the window from the node you just right-clicked, which for a
 * canvas you navigate by pointer is the whole distance — a menu at the
 * cursor is the difference between four actions being available and being
 * used.
 *
 * Rendered into <body>, for the same reason the menu bar's dropdowns are:
 * the canvas and its overlays carry z-indexes of their own, and inside a
 * stacking context a z-index only competes with its siblings.
 */
export default function NodeContextMenu({ info, actions, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    // A menu anchored to a canvas coordinate is wrong the moment the camera
    // moves, so a wheel closes it rather than leaving it pointing at nothing.
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(info.x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(info.y, window.innerHeight - rect.height - margin)),
    });
  }, [info.x, info.y]);

  return createPortal(
    <div
      ref={ref}
      className="menu-surface node-context-menu"
      role="menu"
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="menu-heading mono">{shortId(info.node, 12, 8)}</div>
      {actions.map((action, i) => (
        action.separator
          ? <div key={`sep-${i}`} className="menu-sep" role="separator" />
          : (
            <button
              key={action.label}
              type="button"
              className="menu-item"
              disabled={action.disabled}
              onClick={() => { onClose(); action.run(); }}
            >
              <span className="menu-item-icon"><Icon name={action.icon} size={13} /></span>
              <span className="menu-item-label">{action.label}</span>
            </button>
          )
      ))}
    </div>,
    document.body,
  );
}
