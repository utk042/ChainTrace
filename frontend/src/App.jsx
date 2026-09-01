import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import StatusBar from './components/Layout/StatusBar';
import Dashboard from './pages/Dashboard';
import Alerts from './pages/Alerts';
import GraphExplorer from './pages/GraphExplorer';
import Wallets from './pages/Wallets';
import Transactions from './pages/Transactions';
import Ingest from './pages/Ingest';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <div className="main-content">
          <TopBar />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/graph" element={<GraphExplorer />} />
            <Route path="/wallets" element={<Wallets />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/ingest" element={<Ingest />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          <StatusBar />
        </div>
      </div>
    </BrowserRouter>
  );
}
