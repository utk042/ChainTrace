import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import StatusBar from './components/Layout/StatusBar';
import ConnectionBanner from './components/Layout/ConnectionBanner';

// Routes are code-split so a page only downloads what it actually uses.
// ECharts (1.1 MB minified) is needed by the Dashboard alone and Sigma by the
// Graph Explorer alone, but a static import of every page pulled both into the
// first load of every route — a second and a half of blank screen on a slow
// link before anything at all appeared.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Alerts = lazy(() => import('./pages/Alerts'));
const GraphExplorer = lazy(() => import('./pages/GraphExplorer'));
const Wallets = lazy(() => import('./pages/Wallets'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Ingest = lazy(() => import('./pages/Ingest'));
const Settings = lazy(() => import('./pages/Settings'));

// The standalone single-file build has no server to map paths onto index.html
// — it is opened from a file:// URL or served as one static page — so it routes
// through the hash instead. Every other build uses real paths.
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
          <StatusBar />
        </div>
      </div>
    </Router>
  );
}
