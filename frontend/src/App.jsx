import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import TitleBar from './components/Layout/TitleBar';
import MenuBar from './components/Layout/MenuBar';
import Rail from './components/Layout/Rail';
import ConnectionBanner from './components/Layout/ConnectionBanner';
import UpdatePrompt from './components/Layout/UpdatePrompt';
import ErrorBoundary from './components/ErrorBoundary';
import { SessionProvider, useSession } from './state/SessionProvider';
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

const Router = import.meta.env.VITE_HASH_ROUTER === 'true' ? HashRouter : BrowserRouter;

/**
 * The workstation shell: fixed title bar, menu bar, application rail,
 * and persistent multi-tab workspace.
 *
 * Each open tab remains mounted with display toggle so switching tabs never
 * reloads views or destroys graph state, filters, or selections.
 */
function Shell() {
  const { tabs, activeTabId } = useSession();

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
                    <Component tabId={tab.id} />
                  </div>
                );
              })}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
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
