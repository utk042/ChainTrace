import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import TitleBar from './components/Layout/TitleBar';
import MenuBar from './components/Layout/MenuBar';
import Rail from './components/Layout/Rail';
import ConnectionBanner from './components/Layout/ConnectionBanner';
import StatusBar from './components/Layout/StatusBar';
import ShortcutsDialog from './components/Layout/ShortcutsDialog';
import IngestionGate from './components/Layout/IngestionGate';
import UpdatePrompt from './components/Layout/UpdatePrompt';
import ErrorBoundary from './components/ErrorBoundary';
import { SessionProvider, useSession } from './state/SessionProvider';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { Loading } from './components/ui/States';

// Code-split so a page downloads only what it uses
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Alerts = lazy(() => import('./pages/Alerts'));
const GraphExplorer = lazy(() => import('./pages/GraphExplorer'));
const Wallets = lazy(() => import('./pages/Wallets'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Ingest = lazy(() => import('./pages/Ingest'));
const Settings = lazy(() => import('./pages/Settings'));

const VIEW_COMPONENTS = {
  overview: Dashboard,
  alerts: Alerts,
  graph: GraphExplorer,
  wallets: Wallets,
  transactions: Transactions,
  ingest: Ingest,
  settings: Settings,
};

/**
 * The views that read the case tables, and so cannot be shown while an ingest
 * run is rewriting them. Ingest itself stays open — it is where the run is —
 * and so does Settings, which reads nothing from the dataset.
 */
const DATA_VIEWS = new Set(['overview', 'alerts', 'wallets', 'transactions', 'graph']);

const VIEW_LABELS = {
  overview: 'The overview',
  alerts: 'Alerts',
  wallets: 'Wallets',
  transactions: 'Transactions',
  graph: 'The graph',
};

const Router = import.meta.env.VITE_HASH_ROUTER === 'true' ? HashRouter : BrowserRouter;

/**
 * The workstation shell: fixed title bar, menu bar, application rail,
 * and persistent multi-tab workspace.
 *
 * Each open tab remains mounted with display toggle so switching tabs never
 * reloads views or destroys graph state, filters, or selections.
 */
function Shell() {
  const { tabs, activeTabId, ingesting, ingestKnown } = useSession();
  useGlobalShortcuts();

  return (
    <div className="gt-app">
      <TitleBar />
      <MenuBar />
      <div className="gt-body">
        <Rail />
        <main className="gt-workspace">
          <ConnectionBanner />
          <ErrorBoundary>
            <Suspense fallback={<div className="gt-route"><Loading label="Opening view…" /></div>}>
              {tabs.map((tab) => {
                const Component = VIEW_COMPONENTS[tab.key] || Dashboard;
                const isActive = tab.id === activeTabId;
                // Unmounted rather than merely covered: a mounted view keeps
                // polling, and its requests are exactly the reads that queue
                // behind the run's writes. It mounts again — and loads the new
                // dataset from scratch — the moment the run finishes.
                //
                // It also waits out the first status poll. A view mounted
                // before that answer arrives has already fetched and painted
                // by the time the gate could close over it, which is the flash
                // of stale case data the gate exists to prevent.
                const isData = DATA_VIEWS.has(tab.key);
                const gated = isData && ingesting;
                const pending = isData && !ingesting && !ingestKnown;
                return (
                  <div
                    key={tab.id}
                    className="gt-route"
                    style={{
                      display: isActive ? 'flex' : 'none',
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      height: '100%',
                    }}
                  >
                    {gated ? <IngestionGate view={VIEW_LABELS[tab.key]} />
                      : pending ? (
                        <div className="view-pending">
                          <Loading label="Checking for a pipeline run…" />
                        </div>
                      )
                        : <Component tabId={tab.id} />}
                  </div>
                );
              })}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar />
      <ShortcutsDialog />
      <UpdatePrompt />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </Router>
  );
}
