import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import ConnectionBanner from './components/Layout/ConnectionBanner';
import CommandPalette from './components/CommandPalette';

// Code-split so a page downloads only what it uses: ECharts (1.1 MB) is
// needed by the Dashboard alone, Sigma by the Graph Explorer alone.
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
          <ConnectionBanner />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/graph" element={<GraphExplorer />} />
              <Route path="/wallets" element={<Wallets />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/ingest" element={<Ingest />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </div>
        <CommandPalette />
      </div>
    </Router>
  );
}
