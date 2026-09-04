import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { registerServiceWorker } from './services/offline';
import { preloadSnapshot } from './services/api';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After first paint: the worker install fetches the whole precache list, and
// the snapshot import is 1.6 MB. Neither should delay the interface.
window.addEventListener('load', () => {
  registerServiceWorker();
  preloadSnapshot();
});
