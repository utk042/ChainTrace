import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { isDemoMode, setDemoMode } from '../services/api';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'grid' },
  { id: 'alerts', label: 'Alerts', path: '/alerts', icon: 'alertTriangle' },
  { id: 'wallets', label: 'Wallets', path: '/wallets', icon: 'wallet' },
  { id: 'graph', label: 'Graph Explorer', path: '/graph', icon: 'graph' },
  { id: 'transactions', label: 'Transactions', path: '/transactions', icon: 'swap' },
  { id: 'ingest', label: 'Data Ingestion', path: '/ingest', icon: 'uploadCloud' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];

/**
 * Cmd/Ctrl+K quick-action search. Keyboard-first: type to filter, arrow
 * keys to move the highlight, enter to commit, escape to dismiss.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const actions = useMemo(() => [
    {
      id: 'toggle-demo',
      label: isDemoMode() ? 'Exit snapshot mode' : 'Use offline snapshot',
      icon: 'layers',
      run: () => { setDemoMode(!isDemoMode()); window.location.reload(); },
    },
  ], [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nav = PAGES.map((p) => ({ ...p, group: 'Go to', run: () => navigate(p.path) }));
    const all = [...nav, ...actions.map((a) => ({ ...a, group: 'Actions' }))];
    if (!q) return all;
    return all.filter((item) => item.label.toLowerCase().includes(q));
  }, [query, actions, navigate]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const isK = e.key === 'k' || e.key === 'K';
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    };
    const onOpenRequest = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('ct:open-command-palette', onOpenRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('ct:open-command-palette', onOpenRequest);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
      // Wait a tick so the modal is mounted before focusing.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commit = (item) => {
    if (!item) return;
    item.run();
    close();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(items[highlight]);
    }
  };

  if (!open) return null;

  let lastGroup = null;

  return (
    <div className="cmdk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmdk-modal">
        <div className="cmdk-input-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Jump to a page or run an action..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={handleKeyDown}
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-list">
          {items.length === 0 && <div className="cmdk-empty">No matches for "{query}"</div>}
          {items.map((item, i) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="cmdk-group-label">{item.group}</div>}
                <button
                  type="button"
                  className={`cmdk-item ${i === highlight ? 'active' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commit(item)}
                >
                  <Icon name={item.icon} size={15} />
                  {item.label}
                  {item.path && <span className="cmdk-item-hint">↵</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
