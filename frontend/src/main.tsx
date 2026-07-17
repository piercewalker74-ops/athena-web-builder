import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './styles/phases2-5.css';
import './styles/pipeline.css';
import './styles/effects.css';
import './styles/muthur-theme.css';   // MU/TH/UR re-skin (imported last — overrides palette)
import './styles/section-intro.css';  // per-section entrance animations
import './styles/walkthrough.css';    // guided tour overlay
import App from './App';

// Register the PWA service worker (installability only — see public/sw.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ }); });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
