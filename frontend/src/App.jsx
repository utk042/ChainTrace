import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import TitleBar from './components/Layout/TitleBar';
import MenuBar from './components/Layout/MenuBar';
import Rail from './components/Layout/Rail';
import StatusBar from './components/Layout/StatusBar';
import ConnectionBanner from './components/Layout/ConnectionBanner';
import UpdatePrompt from './components/Layout/UpdatePrompt';
import ErrorBoundary from './components/ErrorBoundary';
import { SessionProvider } from './state/SessionProvider';
import { Loading } from './components/ui/States';

// Code-split so a page downloads only what it uses: ECharts (1.1 MB) is
// needed by the Dashboard alone, Sigma by the Graph Explorer alone. The
// service worker precaches every chunk regardless, so an offline start
// still reaches every route.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Alerts = lazy(() => import('./pages/Alerts'));
const GraphExplorer = lazy(() => import('./pages/GraphExplorer'));
const Wallets = lazy(() => import('./pages/Wallets'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Ingest = lazy(() => import('./pages/Ingest'));
const Settings = lazy(() => import('./pages/Settings'));

// The standalone single-file build has no server to map paths onto
// index.html, so it routes through the hash. Every other build uses paths.
const Router = import.meta.env.VITE_HASH_ROUTER === 'true' ? HashRouter : BrowserRouter;

/**
 * The workstation shell: a fixed title bar, menu bar, application rail and
 * status bar around one scrolling workspace.
 *
 * Only the workspace ever scrolls. The chrome is laid out as grid rows of a
 * full-height frame rather than as sticky elements, so a long table cannot
 * push the status bar off the bottom of the window or slide under the menu.
 */
function Shell() {
  return (
    <div className="gt-app">
      <TitleBar />
      <MenuBar />
      <div className="gt-body">
        <Rail />
        <main className="gt-workspace">
          <ConnectionBanner />
          {/* Keyed per route so a crash on one page clears when you leave it. */}
          <ErrorBoundary>
            <Suspense fallback={<div className="gt-route"><Loading label="Opening view…" /></div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/graph" element={<GraphExplorer />} />
                <Route path="/wallets" element={<Wallets />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/ingest" element={<Ingest />} />
                <Route path="/settings" element={<Settings />} />
                {/* A deep link into an installed app can outlive the route
                    it pointed at; land on the overview rather than blank. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar />
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
