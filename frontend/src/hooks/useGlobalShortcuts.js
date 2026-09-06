import { useEffect } from 'react';
import { useSession } from '../state/SessionProvider';
import { runCommand, hasCommand } from '../services/commands';

/**
 * The shortcuts that belong to the workstation rather than to a page.
 *
 * Pages bind their own bare keys (`/`, `F`, `E` in the graph). These are the
 * accelerated ones, and they live at the shell so they work on every tab.
 *
 * Ctrl+E was listed in the File menu long before anything bound it, so the
 * menu advertised a shortcut that did nothing. It dispatches through the
 * command registry, which means it does nothing *visible* on a view with no
 * CSV to export rather than exporting the wrong tab's rows.
 */
export function useGlobalShortcuts() {
  const { toggleShortcuts } = useSession();

  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)
        || e.target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'e') {
        if (!hasCommand('export.csv')) return;
        e.preventDefault();
        runCommand('export.csv');
        return;
      }

      // `?` is Shift+/ on most layouts, so it must not fire mid-search.
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
        e.preventDefault();
        toggleShortcuts();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleShortcuts]);
}
