import { useEffect } from 'react';
import Icon from '../Icon';
import { useSession } from '../../state/SessionProvider';
import { shortcut } from '../../services/platform';

/**
 * The keyboard reference, for the whole workstation.
 *
 * It used to live inside the Graph Explorer, and so did the command that
 * opened it: Help → Keyboard shortcuts was greyed out on every other tab,
 * because the page that registered the command was not mounted. A reference
 * that is only reachable from one view is not a reference — it is a feature
 * of that view.
 *
 * Only bindings that actually exist are listed. The File menu used to
 * advertise Ctrl+R for "Reload from backend"; nothing bound it, and Ctrl+R is
 * the browser's own reload, which is not a key an application should take.
 */
const SECTIONS = () => [
  {
    title: 'Anywhere',
    rows: [
      [shortcut('K'), 'Focus global search'],
      [shortcut('E'), 'Export the current view as CSV'],
      ['?', 'Open this reference'],
      ['Esc', 'Close a menu, panel or selection'],
    ],
  },
  {
    title: 'Alerts, Wallets, Transactions',
    rows: [
      ['/', 'Focus the search box'],
      ['Esc', 'Clear the selected record'],
    ],
  },
  {
    title: 'Graph Explorer',
    rows: [
      ['/', 'Focus find'],
      ['F', 'Fit graph to view'],
      ['R', 'Reset view and filters'],
      ['L', 'Re-run force layout'],
      ['E', 'Expand selected node'],
      ['C', 'Centre selected node'],
      ['+ / −', 'Zoom in / out'],
      ['Esc', 'Clear selection'],
    ],
  },
];

export default function ShortcutsDialog() {
  const { shortcutsOpen, closeShortcuts } = useSession();

  useEffect(() => {
    if (!shortcutsOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeShortcuts(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [shortcutsOpen, closeShortcuts]);

  if (!shortcutsOpen) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) closeShortcuts(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="panel-header">
          <span className="panel-title"><Icon name="info" size={12} /> Keyboard shortcuts</span>
          <span className="panel-header-actions">
            <button className="icon-btn" onClick={closeShortcuts} aria-label="Close">
              <Icon name="close" size={12} />
            </button>
          </span>
        </header>
        <div className="modal-body">
          {SECTIONS().map((section) => (
            <div key={section.title} className="shortcut-section">
              <div className="section-label">{section.title}</div>
              <div className="shortcut-list">
                {section.rows.map(([key, description]) => (
                  <div key={`${section.title}-${key}-${description}`}>
                    <kbd>{key}</kbd><span>{description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
