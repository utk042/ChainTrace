import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import StatusBar from './components/Layout/StatusBar';
import ConnectionBanner from './components/Layout/ConnectionBanner';
import UpdatePrompt from './components/Layout/UpdatePrompt';
import ErrorBoundary from './components/ErrorBoundary';

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

function RouteFallback() {
  return (
    <div className="loading-spinner">
      <div className="spinner" />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <TopBar />
          <ConnectionBanner />
          {/* Keyed per route so a crash on one page clears when you leave it. */}
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/graph" element={<GraphExplorer />} />
                <Route path="/wallets" element={<Wallets />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/ingest" element={<Ingest />} />
                <Route path="/settings" element={<Settings />} />
                {/* A deep link into an installed app can outlive the route
                    it pointed at; land on the dashboard rather than blank. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
          <StatusBar />
        </div>
        <UpdatePrompt />
      </div>
    </Router>
  );
}
