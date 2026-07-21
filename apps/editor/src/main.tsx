import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Sitewright brand type, self-hosted via @fontsource (no runtime font CDN):
// Space Grotesk (display/wordmark) + Inter (UI/body).
import '@fontsource-variable/space-grotesk';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import { App } from './App';
import { ToastProvider } from './views/ui/Toast';
import { recordRunningBuild } from './buildId';
import { initColorMode } from './lib/color-mode';

// Record this bundle's build hash (from its own asset URL) so the UpdateBanner can detect a stale tab
// after a redeploy and prompt a reload. Runs before any component renders.
recordRunningBuild(import.meta.url);

// Apply the persisted color mode (light/dark/auto) and wire the `auto`→OS listener. The inline FOUC
// script in index.html already stamped `data-theme` before paint; this re-affirms it (idempotent) and
// attaches the runtime OS-change listener the static script can't.
initColorMode();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
