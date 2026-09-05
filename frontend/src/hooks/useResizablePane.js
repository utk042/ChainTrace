import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-resize for a side pane, with the width persisted per pane id.
 *
 * An analyst reading 64-character addresses in a 300px column will widen it;
 * having to do that again on every navigation is the kind of small friction
 * that makes a tool feel like a demo. The width is stored in localStorage
 * and clamped on read, so a stale value from a wider screen cannot leave a
 * pane occupying the whole window.
 */
export function useResizablePane(id, { initial, min, max, edge = 'right' }) {
  const storageKey = `CT_PANE_${id}`;
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) return Math.min(max, Math.max(min, stored));
    } catch { /* storage unavailable — fall through to the default */ }
    return initial;
  });
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(width)); } catch { /* ignore */ }
  }, [storageKey, width]);

  // Re-clamp when the window shrinks: a 520px pane on a 480px viewport
  // hides the content it was widened to reveal.
  useEffect(() => {
    const onResize = () => {
      const ceiling = Math.min(max, Math.max(min, window.innerWidth - 320));
      setWidth((w) => Math.min(w, ceiling));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [min, max]);

  const onPointerDown = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setDragging(true);

    const move = (e) => {
      // One update per frame: a pointermove per pixel re-lays out the whole
      // three-pane grid and drops frames on a large table.
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const delta = edge === 'right' ? startX - e.clientX : e.clientX - startX;
        const ceiling = Math.min(max, Math.max(min, window.innerWidth - 320));
        setWidth(Math.min(ceiling, Math.max(min, startWidth + delta)));
      });
    };
    const up = () => {
      cancelAnimationFrame(frame.current);
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width, min, max, edge]);

  // Keyboard resize, so the splitter is not a mouse-only control.
  const onKeyDown = useCallback((event) => {
    const step = event.shiftKey ? 40 : 12;
    const sign = edge === 'right' ? -1 : 1;
    if (event.key === 'ArrowLeft') setWidth((w) => Math.max(min, Math.min(max, w + sign * step)));
    else if (event.key === 'ArrowRight') setWidth((w) => Math.max(min, Math.min(max, w - sign * step)));
    else return;
    event.preventDefault();
  }, [min, max, edge]);

  const splitterProps = {
    className: `splitter${dragging ? ' dragging' : ''}`,
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuenow': width,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-label': 'Resize panel',
    onPointerDown,
    onKeyDown,
  };

  return { width, setWidth, dragging, splitterProps };
}

export default useResizablePane;
