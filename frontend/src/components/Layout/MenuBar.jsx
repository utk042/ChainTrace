import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import Menu, { MenuItem, MenuSeparator, MenuHeading } from '../ui/Menu';
import { useSession } from '../../state/SessionProvider';
import { VIEWS } from '../../state/views';
import { runCommand, useAvailableCommands } from '../../services/commands';
import { fmtRelative } from '../../services/format';

/** "localhost:8000" from a configured API URL; null when it is this origin. */
function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url, window.location.origin).host;
  } catch {
    return url;
  }
}

/**
 * The application menu bar.
 *
 * Every item here is wired to something. Items the current view cannot
 * service are rendered disabled rather than silently doing nothing: the page
 * registers the commands it implements (see services/commands.js) and this
 * bar subscribes to that registry, so "Fit to view" is live on the graph and
 * greyed out on a table.
 */

const MENUS = [
  {
    label: 'File',
    items: [
      { label: 'Ingest data…', icon: 'uploadCloud', go: '/ingest' },
      { separator: true },
      { label: 'Export view as CSV', icon: 'download', command: 'export.csv', hint: 'Ctrl+E' },
      { label: 'Export view as JSON', icon: 'boxDown', command: 'export.json' },
      { label: 'Export graph as PNG', icon: 'image', command: 'export.png' },
      { separator: true },
      { label: 'Reload from backend', icon: 'refresh', command: 'reload', hint: 'Ctrl+R' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Focus search', icon: 'search', command: 'find.focus', hint: '/' },
      { label: 'Copy identifier', icon: 'copy', command: 'selection.copy' },
      { separator: true },
      { label: 'Clear selection', icon: 'close', command: 'selection.clear', hint: 'Esc' },
      { label: 'Clear filters', icon: 'filter', command: 'filters.clear' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Filters panel', icon: 'filter', command: 'panel.filters' },
      { label: 'Summary panel', icon: 'barChart', command: 'panel.summary' },
      { label: 'Detail panel', icon: 'panelRight', command: 'panel.detail' },
      { separator: true },
      { label: 'Fit graph to view', icon: 'crosshair', command: 'graph.fit', hint: 'F' },
      { label: 'Re-run layout', icon: 'layers', command: 'graph.relayout', hint: 'L' },
    ],
  },
  {
    label: 'Investigate',
    items: [
      { label: 'Open in graph', icon: 'graph', command: 'open.graph' },
      { label: 'Expand selection', icon: 'expand', command: 'graph.expand', hint: 'E' },
      { label: 'Trace connection…', icon: 'route', command: 'graph.path' },
      { separator: true },
      { label: 'Prioritised alerts', icon: 'alertTriangle', go: '/alerts' },
      { label: 'Watchlist seeds', icon: 'flag', go: '/settings' },
    ],
  },
];

export default function MenuBar() {
  const navigate = useNavigate();
  const { stats, provenance, demo, backend, activeView, openKeys, closeView } = useSession();
  // Subscribing keeps enablement honest as pages mount and unmount.
  const available = useAvailableCommands();

  const enabled = (item) => (item.go ? true : available.includes(item.command));

  const activate = (item) => {
    if (item.go) navigate(item.go);
    else runCommand(item.command);
  };

  const source = demo ? 'snapshot' : provenance.source;
  const sourceLabel = {
    live: 'LIVE',
    cache: 'STORED',
    snapshot: 'SNAPSHOT',
    unknown: 'NO DATA',
  }[source] || 'NO DATA';

  const sourceTitle = {
    live: 'Everything on screen came straight from the backend.',
    cache: `Served from the offline store${provenance.cachedAt ? `, fetched ${fmtRelative(provenance.cachedAt)}` : ''}. It is real backend output, but not live.`,
    snapshot: 'A bundled snapshot of a completed pipeline run. Nothing here is live.',
    unknown: 'No data has been loaded in this session yet.',
  }[source];

  // The chip in the middle names what this window is attached to, the way
  // Gotham's names the document you have open. For us that is the backend
  // the session is talking to — the thing an operator most often needs to
  // confirm before trusting a figure.
  const caseName = demo
    ? 'Bundled snapshot'
    : (hostOf(backend.apiUrl) || 'Backend on this origin');
  const caseMeta = stats?.total_transactions != null
    ? `${stats.total_transactions.toLocaleString()} transactions`
    : null;

  return (
    <div className="menubar">
      <div className="menubar-menus">
        {MENUS.map((menu) => (
          <Menu
            key={menu.label}
            trigger={({ toggle, open }) => (
              <button
                type="button"
                className={`menubar-trigger${open ? ' open' : ''}`}
                onClick={toggle}
              >
                {menu.label}
              </button>
            )}
          >
            {({ close }) => menu.items.map((item, i) => (
              item.separator
                ? <MenuSeparator key={`sep-${i}`} />
                : (
                  <MenuItem
                    key={item.label}
                    close={close}
                    icon={item.icon}
                    label={item.label}
                    hint={item.hint}
                    disabled={!enabled(item)}
                    onSelect={() => activate(item)}
                  />
                )
            ))}
          </Menu>
        ))}

        <Menu
          trigger={({ toggle, open }) => (
            <button type="button" className={`menubar-trigger${open ? ' open' : ''}`} onClick={toggle}>
              Window
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuHeading>Views</MenuHeading>
              {VIEWS.map((view) => (
                <MenuItem
                  key={view.key}
                  close={close}
                  icon={view.icon}
                  label={view.label}
                  hint={view.key === activeView.key ? 'current' : openKeys.includes(view.key) ? 'open' : undefined}
                  onSelect={() => navigate(view.path)}
                />
              ))}
              <MenuSeparator />
              <MenuItem
                close={close}
                icon="close"
                label={`Close ${activeView.label}`}
                disabled={openKeys.length <= 1}
                onSelect={() => closeView(activeView.key)}
              />
            </>
          )}
        </Menu>

        <Menu
          trigger={({ toggle, open }) => (
            <button type="button" className={`menubar-trigger${open ? ' open' : ''}`} onClick={toggle}>
              Help
            </button>
          )}
        >
          {({ close }) => (
            <>
              <MenuItem
                close={close}
                icon="info"
                label="Keyboard shortcuts"
                disabled={!available.includes('help.shortcuts')}
                onSelect={() => runCommand('help.shortcuts')}
              />
              <MenuItem
                close={close}
                icon="shieldCheck"
                label="Backend health & settings"
                onSelect={() => navigate('/settings')}
              />
              <MenuSeparator />
              <MenuHeading>Session</MenuHeading>
              <MenuItem close={close} icon="database" label={caseName} disabled />
              <MenuItem
                close={close}
                icon="zap"
                label={backend.health?.ml_backend
                  ? `Scoring backend: ${backend.health.ml_backend}${backend.health.light_mode ? ' (light mode)' : ''}`
                  : 'Scoring backend unknown'}
                disabled
              />
              <MenuItem
                close={close}
                icon="clock"
                label={backend.health?.started_at
                  ? `Backend up since ${backend.health.started_at.replace('T', ' ').slice(0, 19)}`
                  : 'Backend uptime unknown'}
                disabled
              />
            </>
          )}
        </Menu>
      </div>

      <div className="menubar-doc" title={caseName}>
        <Icon name="briefcase" size={12} />
        <span className="menubar-doc-name">{caseName}</span>
        {caseMeta && <span className="muted menubar-doc-meta">· {caseMeta}</span>}
      </div>

      <div className="menubar-right">
        <span className={`provenance-chip ${source}`} title={sourceTitle}>
          <Icon name={source === 'live' ? 'zap' : source === 'snapshot' ? 'layers' : 'boxDown'} size={10} />
          {sourceLabel}
        </span>
        <button
          type="button"
          className="icon-btn"
          title="Reload this view from the backend"
          aria-label="Reload this view"
          disabled={!available.includes('reload')}
          onClick={() => runCommand('reload')}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
    </div>
  );
}
