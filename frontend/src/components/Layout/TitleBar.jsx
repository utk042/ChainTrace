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
 * Each tab is an independent instance. Adding a tab always creates a new tab
 * instance, and switching tabs preserves full state without reloading.
 */
export default function TitleBar() {
  const navigate = useNavigate();
  const { tabs, activeTabId, switchTab, closeTab, openTab } = useSession();
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
    const targetPath = `/graph?q=${encodeURIComponent(q)}`;
    openTab('graph', { forceNew: false, path: targetPath });
    navigate(targetPath);
  };

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
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`ws-tab${active ? ' active' : ''}`}
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(tab.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id); } }}
              tabIndex={0}
            >
              <Icon name={tab.icon} size={12} />
              <span className="ws-tab-label">{tab.label}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 14, height: 14 }}
                  aria-label={`Close ${tab.label}`}
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                >
                  <Icon name="close" size={10} />
                </button>
              )}
            </div>
          );
        })}

        <div className="titlebar-tab-add">
          <Menu
            align="left"
            trigger={({ toggle, open }) => (
              <button
                type="button"
                className={`ws-tab-add-btn${open ? ' active' : ''}`}
                onClick={toggle}
                title="Open a new tab view"
                aria-label="Open a view"
              >
                <Icon name="plus" size={13} />
              </button>
            )}
          >
            {({ close }) => (
              <>
                <MenuHeading>Open a new tab</MenuHeading>
                {VIEWS.map((view) => (
                  <MenuItem
                    key={view.key}
                    close={close}
                    icon={view.icon}
                    label={view.label}
                    hint={tabs.some((t) => t.key === view.key) ? 'open' : undefined}
                    onSelect={() => openTab(view.key, { forceNew: true })}
                  />
                ))}
                <MenuSeparator />
                <MenuItem
                  close={close}
                  icon="close"
                  label="Close current tab"
                  disabled={tabs.length <= 1}
                  onSelect={() => closeTab(activeTabId)}
                />
              </>
            )}
          </Menu>
        </div>
      </div>
    </div>
  );
}
