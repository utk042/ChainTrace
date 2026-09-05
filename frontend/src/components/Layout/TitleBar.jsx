import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import Menu, { MenuItem, MenuSeparator, MenuHeading } from '../ui/Menu';
import { useSession } from '../../state/SessionProvider';
import { VIEWS } from '../../state/views';

/**
 * The window's title bar: the application mark, global search, and one tab
 * per open view.
 *
 * The tabs are the workstation's own — navigating opens a view and leaves it
 * open, so moving between a wallet list and the graph does not throw away
 * where you were. Closing a tab lands on its neighbour.
 */
export default function TitleBar() {
  const navigate = useNavigate();
  const { openKeys, activeView, closeView } = useSession();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  // Ctrl/Cmd+K focuses global search from anywhere in the workstation.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The graph explorer is the one view that resolves an arbitrary identifier
  // — address, txid or IP — so global search hands off to it.
  const submit = (event) => {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    navigate(`/graph?q=${encodeURIComponent(q)}`);
  };

  const openTabs = VIEWS.filter((v) => openKeys.includes(v.key));

  return (
    <div className="titlebar">
      <div className="titlebar-mark" title="ChainTrace Forensics">
        <Icon name="graph" size={16} />
      </div>

      <form className="titlebar-search" onSubmit={submit} role="search">
        <Icon name="search" size={12} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search address, txid or IP"
          aria-label="Search the entity graph"
        />
        <kbd>⌘K</kbd>
      </form>

      <div className="titlebar-tabs" role="tablist" aria-label="Open views">
        {openTabs.map((view) => {
          const active = view.key === activeView.key;
          return (
            <div
              key={view.key}
              className={`ws-tab${active ? ' active' : ''}`}
              role="tab"
              aria-selected={active}
              title={view.hint}
              onClick={() => navigate(view.path)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(view.path); } }}
              tabIndex={0}
            >
              <Icon name={view.icon} size={12} />
              <span className="ws-tab-label">{view.label}</span>
              {openTabs.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 14, height: 14 }}
                  aria-label={`Close ${view.label}`}
                  onClick={(e) => { e.stopPropagation(); closeView(view.key); }}
                >
                  <Icon name="close" size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="titlebar-right">
        <Menu
          align="right"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              className={`icon-btn${open ? ' active' : ''}`}
              onClick={toggle}
              title="Open a view"
              aria-label="Open a view"
            >
              <Icon name="plus" size={14} />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuHeading>Open a view</MenuHeading>
              {VIEWS.map((view) => (
                <MenuItem
                  key={view.key}
                  close={close}
                  icon={view.icon}
                  label={view.label}
                  hint={openKeys.includes(view.key) ? 'open' : undefined}
                  onSelect={() => navigate(view.path)}
                />
              ))}
              <MenuSeparator />
              <MenuItem
                close={close}
                icon="close"
                label="Close this view"
                disabled={openKeys.length <= 1}
                onSelect={() => closeView(activeView.key)}
              />
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}
